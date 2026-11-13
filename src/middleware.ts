import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie and blocks unauthenticated access to
 * every /hr page and /api/hr endpoint. (Pages and API routes ALSO verify that
 * the user is an active HR member — this is only the first gate.)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isHrPage = pathname.startsWith("/hr") && pathname !== "/hr/login";
  const isHrApi = pathname.startsWith("/api/hr");

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (isHrApi) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    if (isHrPage) return redirectToLogin(request, "not_configured");
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }

  if (!userId) {
    if (isHrApi) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (isHrPage) return redirectToLogin(request);
  }

  if (userId && pathname === "/hr/login") {
    const dest = request.nextUrl.clone();
    dest.pathname = "/hr/dashboard";
    dest.search = "";
    return NextResponse.redirect(dest);
  }

  return response;
}

function redirectToLogin(request: NextRequest, error?: string) {
  const dest = request.nextUrl.clone();
  dest.pathname = "/hr/login";
  dest.search = "";
  if (error) dest.searchParams.set("error", error);
  return NextResponse.redirect(dest);
}

export const config = {
  matcher: ["/hr/:path*", "/api/hr/:path*"],
};
