import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function signOutAndRedirect(request: Request, reason?: string) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Even if Supabase is unreachable, send the user to the login page.
  }
  const dest = new URL("/hr/login", request.url);
  if (reason === "not_authorized") dest.searchParams.set("error", "not_authorized");
  return NextResponse.redirect(dest, 303);
}

export async function POST(request: Request) {
  return signOutAndRedirect(request);
}

/** Used when a signed-in account has no active HR access. */
export async function GET(request: Request) {
  return signOutAndRedirect(request, new URL(request.url).searchParams.get("reason") ?? undefined);
}
