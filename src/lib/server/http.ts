import "server-only";
import { NextResponse } from "next/server";

/** Rejects cross-origin state-changing requests (defence in depth on top of SameSite cookies). */
export function checkSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin fetches from older browsers / server-to-server
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return null;
  } catch {
    // fall through
  }
  return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
