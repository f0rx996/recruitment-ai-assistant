import { NextResponse } from "next/server";
import { requireHrApi } from "@/lib/auth";
import { createAdminClient, CV_BUCKET } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Authorized CV access: verifies the HR user, confirms the application is
 * visible to them under RLS, then redirects to a 60-second signed URL.
 * ?download=1 forces a download; otherwise PDFs open inline.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError("Not found", 404);

  const { data: app, error } = await auth.ctx.supabase
    .from("applications")
    .select("id, cv_storage_path, cv_original_filename")
    .eq("id", id)
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!app) return jsonError("Not found", 404);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data, error: sErr } = await createAdminClient()
    .storage.from(CV_BUCKET)
    .createSignedUrl(app.cv_storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: app.cv_original_filename } : undefined);
  if (sErr || !data?.signedUrl) return jsonError("Could not create a secure download link.", 500);

  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
