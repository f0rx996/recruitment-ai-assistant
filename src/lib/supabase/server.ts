import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "@/lib/env";

/**
 * Supabase client bound to the current request's auth cookies. All queries
 * run as the signed-in user (or anon) and are subject to Row-Level Security.
 */
export async function createClient() {
  const { url, anonKey } = publicSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
