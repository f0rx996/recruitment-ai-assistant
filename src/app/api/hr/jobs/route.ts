import { NextResponse } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { jobInputSchema, fieldErrors } from "@/lib/validation";
import { uniqueSlug } from "@/lib/jobs";
import { checkSameOrigin, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.ctx.supabase
    .from("jobs")
    .select("*, applications(count)")
    .order("created_at", { ascending: false });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ jobs: data });
}

export async function POST(request: Request) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;

  const parsed = jobInputSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    return jsonError(Object.values(fe)[0] ?? "Invalid input", 400, { fieldErrors: fe });
  }
  const { supabase, user } = auth.ctx;

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await uniqueSlug(supabase, parsed.data.title);
    const { data, error } = await supabase
      .from("jobs")
      .insert({ ...parsed.data, slug, created_by: user.id })
      .select("id, slug")
      .single();
    if (!error) return NextResponse.json({ job: data }, { status: 201 });
    if (error.code !== "23505") return jsonError(`Could not create job: ${error.message}`, 500);
  }
  return jsonError("Could not allocate a unique link for this job. Try a different title.", 409);
}
