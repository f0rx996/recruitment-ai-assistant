import { NextResponse } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { reviewStatusSchema } from "@/lib/validation";
import { isUuid } from "@/lib/utils";
import { deleteApplicationData } from "@/lib/applications/delete";
import { deletionDeps } from "@/lib/server/stores";
import { checkSameOrigin, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** HR-controlled manual review status (New / Reviewed / Shortlisted / Rejected). */
export async function PATCH(request: Request, { params }: Params) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Not found", 404);

  const parsed = reviewStatusSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid review status", 400);

  const { data, error } = await auth.ctx.supabase
    .from("applications")
    .update({ review_status: parsed.data.review_status })
    .eq("id", id)
    .select("id, review_status")
    .maybeSingle();
  if (error) return jsonError(`Could not update status: ${error.message}`, 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json({ application: data });
}

/** Deletes the application, original CV file, extracted text, AI index and chat evidence. HR admins only. */
export async function DELETE(request: Request, { params }: Params) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi({ admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Not found", 404);

  try {
    const result = await deleteApplicationData(id, deletionDeps(auth.ctx.supabase));
    if (!result.deleted) return jsonError("Not found", 404);
    return NextResponse.json({ ok: true, scrubbedMessages: result.scrubbedMessages });
  } catch (e) {
    return jsonError(`Deletion failed: ${(e as Error).message}`, 500);
  }
}
