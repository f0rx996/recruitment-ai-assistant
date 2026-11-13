import "server-only";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicSupabaseConfig } from "@/lib/env";
import type { Job } from "@/lib/types";

/** Anonymous client: RLS only exposes OPEN jobs to it. */
function anonClient() {
  const { url, anonKey } = publicSupabaseConfig();
  return createSupabase(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type PublicJob = Pick<
  Job,
  "id" | "title" | "slug" | "summary" | "description" | "required_skills" | "preferred_skills" | "other_requirements" | "location" | "status" | "created_at"
>;

const PUBLIC_COLUMNS =
  "id, title, slug, summary, description, required_skills, preferred_skills, other_requirements, location, status, created_at";

export async function listOpenJobs(): Promise<{ jobs: PublicJob[]; error: string | null }> {
  if (!isSupabaseConfigured()) return { jobs: [], error: "not_configured" };
  const { data, error } = await anonClient()
    .from("jobs")
    .select(PUBLIC_COLUMNS)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) return { jobs: [], error: error.message };
  return { jobs: (data ?? []) as PublicJob[], error: null };
}

/**
 * Looks up a job by slug. Open jobs come from the anon client; closed jobs are
 * looked up server-side (service role) only to show a "closed" notice.
 */
export async function getPublicJob(slug: string): Promise<PublicJob | null> {
  if (!isSupabaseConfigured() || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const { data } = await anonClient().from("jobs").select(PUBLIC_COLUMNS).eq("slug", slug).maybeSingle();
  if (data) return data as PublicJob;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: closed } = await createAdminClient()
      .from("jobs")
      .select(PUBLIC_COLUMNS)
      .eq("slug", slug)
      .eq("status", "closed")
      .maybeSingle();
    return (closed as PublicJob) ?? null;
  } catch {
    return null;
  }
}
