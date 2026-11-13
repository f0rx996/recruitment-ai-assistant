/**
 * Unauthorized access prevention. The Supabase auth client is MOCKED to
 * simulate (a) no session and (b) a signed-in user without HR access; the
 * real route handlers and middleware are exercised.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Mode = "anonymous" | "not_hr" | "recruiter";
let mode: Mode = "anonymous";
const dbTouched: string[] = [];

function chain(table: string) {
  const result =
    table === "hr_users" && mode === "recruiter"
      ? { data: { user_id: "u1", email: "r@example.test", full_name: null, role: "recruiter", is_active: true }, error: null }
      : { data: null, error: null };
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "maybeSingle" || prop === "single") return async () => result;
        if (prop === "then") return undefined;
        return () => proxy;
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () =>
        mode === "anonymous" ? { data: { user: null }, error: null } : { data: { user: { id: "u1", email: "x@example.test" } }, error: null },
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => {
      dbTouched.push(table);
      return chain(table);
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

// The service-role client must never be reached by unauthorized requests.
vi.mock("@/lib/supabase/admin", () => ({
  CV_BUCKET: "cvs",
  createAdminClient: () => {
    throw new Error("admin client must not be used for unauthorized requests");
  },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const JOB = "00000000-0000-4000-8000-000000000001";
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function allHrEndpoints() {
  const jobs = await import("@/app/api/hr/jobs/route");
  const job = await import("@/app/api/hr/jobs/[jobId]/route");
  const app = await import("@/app/api/hr/applications/[id]/route");
  const cv = await import("@/app/api/hr/applications/[id]/cv/route");
  const reprocess = await import("@/app/api/hr/applications/[id]/reprocess/route");
  const chat = await import("@/app/api/hr/jobs/[jobId]/chat/route");
  const session = await import("@/app/api/hr/chat/sessions/[sessionId]/route");
  const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
  return {
    "GET /api/hr/jobs": () => jobs.GET(),
    "POST /api/hr/jobs": () => jobs.POST(json({ title: "Data Analyst", description: "x".repeat(30), required_skills: "SQL" })),
    "GET /api/hr/jobs/:id": () => job.GET(new Request("http://localhost/x"), p({ jobId: JOB })),
    "PATCH /api/hr/jobs/:id": () => job.PATCH(json({ status: "closed" }, "PATCH"), p({ jobId: JOB })),
    "PATCH /api/hr/applications/:id": () => app.PATCH(json({ review_status: "shortlisted" }, "PATCH"), p({ id: ID })),
    "DELETE /api/hr/applications/:id": () => app.DELETE(new Request("http://localhost/x", { method: "DELETE" }), p({ id: ID })),
    "GET /api/hr/applications/:id/cv": () => cv.GET(new Request("http://localhost/x"), p({ id: ID })),
    "POST /api/hr/applications/:id/reprocess": () => reprocess.POST(new Request("http://localhost/x", { method: "POST" }), p({ id: ID })),
    "POST /api/hr/jobs/:id/chat": () => chat.POST(json({ message: "Compare all candidates" }), p({ jobId: JOB })),
    "GET /api/hr/chat/sessions/:id": () => session.GET(new Request("http://localhost/x"), p({ sessionId: ID })),
    "DELETE /api/hr/chat/sessions/:id": () => session.DELETE(new Request("http://localhost/x", { method: "DELETE" }), p({ sessionId: ID })),
  };
}

beforeEach(() => {
  dbTouched.length = 0;
});

describe("HR API authorization", () => {
  it("returns 401 for every HR endpoint without a session, without touching data", async () => {
    mode = "anonymous";
    for (const [name, call] of Object.entries(await allHrEndpoints())) {
      const res = await call();
      expect(res.status, name).toBe(401);
    }
    expect(dbTouched).toEqual([]);
  });

  it("returns 403 for signed-in users who are not active HR members", async () => {
    mode = "not_hr";
    for (const [name, call] of Object.entries(await allHrEndpoints())) {
      const res = await call();
      expect(res.status, name).toBe(403);
    }
    expect(new Set(dbTouched)).toEqual(new Set(["hr_users"]));
  });

  it("only admins may delete applications", async () => {
    mode = "recruiter";
    const app = await import("@/app/api/hr/applications/[id]/route");
    const res = await app.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Administrator/);
  });

  it("rejects cross-origin state-changing requests", async () => {
    mode = "recruiter";
    const jobs = await import("@/app/api/hr/jobs/route");
    const res = await jobs.POST(
      new Request("http://localhost/api/hr/jobs", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "localhost", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("middleware", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("redirects unauthenticated users from HR pages to /hr/login", async () => {
    const { middleware } = await import("@/middleware");
    for (const path of ["/hr/dashboard", "/hr/jobs", "/hr/jobs/new", `/hr/jobs/${JOB}`, `/hr/jobs/${JOB}/chat`]) {
      const res = await middleware(new NextRequest(`http://localhost${path}`));
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/hr/login");
    }
  });

  it("returns 401 JSON for HR API calls without a session", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest(`http://localhost/api/hr/applications/${ID}/cv`));
    expect(res.status).toBe(401);
  });

  it("lets the login page through", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(new NextRequest("http://localhost/hr/login"));
    expect(res.headers.get("location")).toBeNull();
  });
});
