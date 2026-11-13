import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/validation";
import { siteUrl } from "@/lib/env";

/** Generates a unique public slug (e.g. data-analyst, data-analyst-2). */
export async function uniqueSlug(db: SupabaseClient, title: string): Promise<string> {
  const base = slugify(title);
  const { data, error } = await db.from("jobs").select("slug").like("slug", `${base}%`);
  if (error) throw new Error(error.message);
  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function publicJobUrl(slug: string): string {
  return `${siteUrl()}/jobs/${slug}`;
}
