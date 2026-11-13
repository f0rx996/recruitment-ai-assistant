import { requireHrApi } from "@/lib/auth";
import { chatRequestSchema } from "@/lib/validation";
import { isUuid } from "@/lib/utils";
import { handleChatTurn, type ChatEvent } from "@/lib/chat/turn";
import { supabaseChatStore } from "@/lib/chat/supabase-store";
import { SupabaseRecruitmentRepo } from "@/lib/ai/repo";
import { llmOrNull, rateLimit } from "@/lib/server/stores";
import { checkSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { AiServiceError } from "@/lib/ai/llm";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sends one HR message to the job's AI assistant. Responds with NDJSON events:
 * session → user_message → status* → message | error.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { jobId } = await params;
  if (!isUuid(jobId)) return jsonError("Not found", 404);

  const parsed = chatRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid message", 400);

  if (!(await rateLimit(`chat:${auth.ctx.user.id}`, 300, 30))) {
    return jsonError("You are sending messages too quickly. Please wait a few minutes.", 429);
  }

  const { supabase, user } = auth.ctx;
  let llm;
  try {
    llm = llmOrNull();
  } catch (e) {
    llm = null;
    if (!(e instanceof AiServiceError)) throw e;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await handleChatTurn(
          { jobId, sessionId: parsed.data.sessionId, message: parsed.data.message },
          {
            store: supabaseChatStore(supabase, user.id),
            makeRepo: (id) => new SupabaseRecruitmentRepo(supabase, id),
            llm,
            emit,
          },
        );
      } catch (e) {
        console.error("chat route failed", (e as Error).message);
        emit({ type: "error", error: "The conversation could not be saved or loaded. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
