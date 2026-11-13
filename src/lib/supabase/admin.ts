import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig, serviceRoleKey } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES RLS — only use on the server after performing
 * explicit validation/authorization (public uploads, CV processing, signed URLs).
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const { url } = publicSupabaseConfig();
  cached = createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

export const CV_BUCKET = "cvs";
