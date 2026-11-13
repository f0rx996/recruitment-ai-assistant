import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteApplicationData } from "@/lib/applications/delete";
import { deletionDeps } from "@/lib/server/stores";
import { retentionDays } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deletes applications older than DATA_RETENTION_DAYS (files, text, AI index, chat evidence). */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cutoff = new Date(Date.now() - retentionDays() * 86_400_000).toISOString();
  const db = createAdminClient();
  const { data, error } = await db.from("applications").select("id").lt("created_at", cutoff).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deps = deletionDeps(null);
  let deleted = 0;
  const failures: string[] = [];
  for (const row of data ?? []) {
    try {
      const r = await deleteApplicationData(row.id, deps);
      if (r.deleted) deleted++;
    } catch (e) {
      failures.push(`${row.id}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ cutoff, deleted, failures, more: (data?.length ?? 0) === 200 });
}
