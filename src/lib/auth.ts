import "server-only";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { HrUser } from "@/lib/types";

export interface HrContext {
  user: User;
  hr: HrUser;
  supabase: SupabaseClient;
}

type Lookup =
  | { state: "anonymous" }
  | { state: "not_hr"; user: User; supabase: SupabaseClient }
  | { state: "ok"; ctx: HrContext };

/**
 * Resolves the signed-in user AND verifies an active row in hr_users.
 * getUser() validates the JWT with Supabase Auth (not just the cookie).
 */
export async function lookupHr(): Promise<Lookup> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return { state: "anonymous" };

  const { data: hr } = await supabase
    .from("hr_users")
    .select("user_id, email, full_name, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!hr || !hr.is_active) return { state: "not_hr", user, supabase };
  return { state: "ok", ctx: { user, hr: hr as HrUser, supabase } };
}

/** For Server Components / pages under /hr. Redirects when not authorized. */
export async function requireHrPage(): Promise<HrContext> {
  const r = await lookupHr();
  if (r.state === "anonymous") redirect("/hr/login");
  if (r.state === "not_hr") {
    // Server Components cannot clear cookies, so sign out via a route handler.
    redirect("/api/auth/logout?reason=not_authorized");
  }
  return r.ctx;
}

/** For API route handlers. Returns a ready-made error response when not authorized. */
export async function requireHrApi(
  opts: { admin?: boolean } = {},
): Promise<{ ok: true; ctx: HrContext } | { ok: false; response: NextResponse }> {
  let r: Lookup;
  try {
    r = await lookupHr();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 }) };
  }
  if (r.state === "anonymous") {
    return { ok: false, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  if (r.state === "not_hr") {
    return { ok: false, response: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  if (opts.admin && r.ctx.hr.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Administrator role required" }, { status: 403 }) };
  }
  return { ok: true, ctx: r.ctx };
}
