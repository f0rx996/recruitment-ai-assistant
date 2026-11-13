import { NextResponse, after } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { isUuid } from "@/lib/utils";
import { processApplication } from "@/lib/cv/process";
import { adminProcessingStore, llmOrNull, rateLimit } from "@/lib/server/stores";
import { checkSameOrigin, jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Re-runs text extraction + AI indexing for one application (e.g. after a failure). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Not found", 404);

  // Visibility check through RLS before using the service role.
  const { data: app } = await auth.ctx.supabase.from("applications").select("id").eq("id", id).maybeSingle();
  if (!app) return jsonError("Not found", 404);

  if (!(await rateLimit(`reprocess:${auth.ctx.user.id}`, 300, 20))) {
    return jsonError("Too many retries. Please wait a few minutes.", 429);
  }

  const store = adminProcessingStore();
  await store.updateApplication(id, { processing_status: "pending", processing_error: null });
  after(async () => {
    try {
      await processApplication(id, { store, llm: llmOrNull() });
    } catch (e) {
      await store.updateApplication(id, {
        processing_status: "failed",
        processing_error: `Processing crashed: ${(e as Error).message.slice(0, 200)}`,
      });
    }
  });
  return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
}
