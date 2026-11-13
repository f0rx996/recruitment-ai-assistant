import { NextResponse } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { isUuid } from "@/lib/utils";
import { checkSameOrigin, jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ sessionId: string }> };

/** Messages of one of the current HR user's conversations. */
export async function GET(_req: Request, { params }: Params) {
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return jsonError("Not found", 404);
  const { supabase, user } = auth.ctx;

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("hr_user_id", user.id)
    .maybeSingle();
  if (!session) return jsonError("Not found", 404);

  const { data: messages, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ session, messages });
}

export async function DELETE(request: Request, { params }: Params) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return jsonError("Not found", 404);
  const { error, count } = await auth.ctx.supabase
    .from("chat_sessions")
    .delete({ count: "exact" })
    .eq("id", sessionId)
    .eq("hr_user_id", auth.ctx.user.id);
  if (error) return jsonError(error.message, 500);
  if (!count) return jsonError("Not found", 404);
  return NextResponse.json({ ok: true });
}
