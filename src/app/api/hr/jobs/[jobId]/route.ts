import { NextResponse } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { jobPatchSchema, fieldErrors } from "@/lib/validation";
import { isUuid } from "@/lib/utils";
import { checkSameOrigin, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { jobId } = await params;
  if (!isUuid(jobId)) return jsonError("Not found", 404);
  const { data, error } = await auth.ctx.supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json({ job: data });
}

/** Edit job fields and/or open/close applications. The public slug never changes, so shared links keep working. */
export async function PATCH(request: Request, { params }: Params) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { jobId } = await params;
  if (!isUuid(jobId)) return jsonError("Not found", 404);

  const body = await readJson(request);
  const parsed = jobPatchSchema.safeParse(body);
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    return jsonError(Object.values(fe)[0] ?? "Invalid input", 400, { fieldErrors: fe });
  }
  // Only apply fields the client actually sent (zod defaults would otherwise overwrite).
  const sent = body && typeof body === "object" ? Object.keys(body as object) : [];
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => sent.includes(k)));
  if (Object.keys(patch).length === 0) return jsonError("Nothing to update", 400);

  const { data, error } = await auth.ctx.supabase.from("jobs").update(patch).eq("id", jobId).select("*").maybeSingle();
  if (error) return jsonError(`Could not update job: ${error.message}`, 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json({ job: data });
}
