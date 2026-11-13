/**
 * Public submission, CV processing pipeline and deletion — using in-memory
 * storage/DB fakes and a MOCKED LLM, with REAL PDF/DOCX parsing.
 */
import { describe, expect, it } from "vitest";
import { submitApplication, type SubmitDeps } from "@/lib/applications/submit";
import { processApplication, type ProcessingStore } from "@/lib/cv/process";
import { deleteApplicationData, type DeleteDeps } from "@/lib/applications/delete";
import type { CvKind } from "@/lib/files/validate";
import type { EvidenceRef } from "@/lib/types";
import { ScriptedLlm } from "../helpers/fakes";
import { makeDocx, makePdf, SARA_CV } from "../helpers/fixtures";

const OPEN_JOB = { id: "00000000-0000-4000-8000-000000000001", title: "Data Analyst", status: "open" as const };
const CLOSED_JOB = { id: "00000000-0000-4000-8000-000000000002", title: "Old Role", status: "closed" as const };

function submitHarness(opts: { rateOk?: boolean; failInsert?: boolean } = {}) {
  const storage = new Map<string, { bytes: Uint8Array; mime: string }>();
  const rows: Record<string, unknown>[] = [];
  const scheduled: { id: string; kind: CvKind }[] = [];
  let n = 0;
  const deps: SubmitDeps = {
    maxBytes: 2 * 1024 * 1024,
    consentVersion: "test-v1",
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`,
    allowUpload: async () => opts.rateOk ?? true,
    getJob: async (id) => [OPEN_JOB, CLOSED_JOB].find((j) => j.id === id) ?? null,
    uploadCv: async (path, bytes, mime) => void storage.set(path, { bytes, mime }),
    removeCv: async (path) => void storage.delete(path),
    insertApplication: async (row) => {
      if (opts.failInsert) throw new Error("db down");
      rows.push(row);
    },
    scheduleProcessing: (id, _b, kind) => void scheduled.push({ id, kind }),
  };
  return { deps, storage, rows, scheduled };
}

const validFields = { fullName: "Sara Khan", email: "sara.khan@example.test", phone: "+1 555 0100 123", consent: "on", ipHash: "h" };

describe("public application submission", () => {
  it("stores the CV privately, links the application to the correct job, and schedules processing", async () => {
    const h = submitHarness();
    const pdf = await makePdf(SARA_CV);
    const res = await submitApplication({ ...validFields, jobId: OPEN_JOB.id, file: { name: "../Sara CV.pdf", bytes: pdf } }, h.deps);
    expect(res.ok).toBe(true);
    expect(h.rows).toHaveLength(1);
    const row = h.rows[0];
    expect(row.job_id).toBe(OPEN_JOB.id);
    expect(row.candidate_name).toBe("Sara Khan");
    expect(row.email).toBe("sara.khan@example.test");
    expect(row.cv_original_filename).toBe("Sara CV.pdf");
    expect(row.cv_storage_path).toBe(`${OPEN_JOB.id}/${row.id}.pdf`); // no user-controlled path segments
    expect(row.consent_version).toBe("test-v1");
    expect(row.processing_status).toBe("pending");
    expect(h.storage.get(row.cv_storage_path as string)?.mime).toBe("application/pdf");
    expect(h.scheduled).toEqual([{ id: row.id, kind: "pdf" }]);
  });

  it("accepts DOCX", async () => {
    const h = submitHarness();
    const res = await submitApplication({ ...validFields, jobId: OPEN_JOB.id, file: { name: "cv.docx", bytes: await makeDocx(SARA_CV) } }, h.deps);
    expect(res.ok).toBe(true);
    expect(h.scheduled[0].kind).toBe("docx");
  });

  it("rejects closed jobs, unknown jobs, missing consent, missing/invalid/oversized files", async () => {
    const pdf = await makePdf(SARA_CV);
    const cases: [Parameters<typeof submitApplication>[0], number, RegExp][] = [
      [{ ...validFields, jobId: CLOSED_JOB.id, file: { name: "cv.pdf", bytes: pdf } }, 409, /no longer accepting/],
      [{ ...validFields, jobId: "00000000-0000-4000-8000-00000000ffff", file: { name: "cv.pdf", bytes: pdf } }, 404, /does not exist/],
      [{ ...validFields, consent: null, jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: pdf } }, 400, /privacy notice/],
      [{ ...validFields, jobId: OPEN_JOB.id, file: null }, 400, /attach your CV/],
      [{ ...validFields, jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: new TextEncoder().encode("hello") } }, 400, /not a valid PDF/],
      [{ ...validFields, jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: new Uint8Array(3 * 1024 * 1024) } }, 400, /too large/],
      [{ ...validFields, email: "nope", jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: pdf } }, 400, /valid email/],
    ];
    for (const [input, status, msg] of cases) {
      const h = submitHarness();
      const res = await submitApplication(input, h.deps);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(status);
        expect(res.error).toMatch(msg);
      }
      expect(h.rows).toHaveLength(0);
      expect(h.storage.size).toBe(0);
    }
  });

  it("enforces the upload rate limit and the bot honeypot", async () => {
    const pdf = await makePdf(SARA_CV);
    const limited = await submitApplication({ ...validFields, jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: pdf } }, submitHarness({ rateOk: false }).deps);
    expect(limited).toMatchObject({ ok: false, status: 429 });
    const bot = await submitApplication({ ...validFields, honeypot: "http://spam", jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: pdf } }, submitHarness().deps);
    expect(bot).toMatchObject({ ok: false, status: 400 });
  });

  it("removes the uploaded file if the DB insert fails (no orphaned CVs)", async () => {
    const h = submitHarness({ failInsert: true });
    await expect(
      submitApplication({ ...validFields, jobId: OPEN_JOB.id, file: { name: "cv.pdf", bytes: await makePdf(SARA_CV) } }, h.deps),
    ).rejects.toThrow("db down");
    expect(h.storage.size).toBe(0);
  });
});

function processingHarness(bytes: Uint8Array, mime: string) {
  const app = {
    id: "app1",
    job_id: "job1",
    candidate_name: "Sara Khan",
    cv_storage_path: "job1/app1.pdf",
    cv_mime_type: mime,
  };
  const state: Record<string, unknown> = {};
  let chunks: { chunk_index: number; content: string; embedding: number[] | null }[] = [];
  const store: ProcessingStore = {
    getApplication: async (id) => (id === "app1" ? app : null),
    downloadCv: async () => bytes,
    updateApplication: async (_id, patch) => void Object.assign(state, patch),
    replaceChunks: async (_a, _j, c) => void (chunks = c),
  };
  return { store, state, getChunks: () => chunks };
}

const PROFILE = {
  headline: "Data Analyst",
  summary: "Data analyst with Power BI and SQL experience.",
  skills: ["SQL", "Python"],
  tools_and_technologies: ["Power BI", "PostgreSQL"],
  education: [{ degree: "BSc", field: "Computer Science", institution: "University of Leeds", year: "2019" }],
  experience: [{ title: "Senior Data Analyst", organization: "Northwind Analytics", start: "2020", end: "2024", highlights: [] }],
  certifications: [{ name: "Microsoft Certified: Power BI Data Analyst Associate", issuer: "Microsoft", year: "2022" }],
  languages: [],
  documented_years_of_experience: { value: 4, basis: "2020–2024" },
};

describe("CV processing pipeline", () => {
  it("extracts text, stores it, chunks it, extracts a profile and embeddings → ready", async () => {
    const h = processingHarness(await makePdf(SARA_CV), "application/pdf");
    const llm = new ScriptedLlm((params) => {
      expect(params.jsonSchema?.name).toBe("candidate_profile");
      const user = params.messages.find((m) => m.role === "user")!.content as string;
      expect(user).toContain("<cv_document");
      expect(user).toContain("Northwind Analytics");
      return { content: JSON.stringify(PROFILE), toolCalls: [] };
    });
    const res = await processApplication("app1", { store: h.store, llm });
    expect(res.status).toBe("ready");
    expect(h.state.processing_status).toBe("ready");
    expect(h.state.cv_text).toContain("Power BI dashboards");
    expect(h.state.candidate_profile).toEqual(PROFILE);
    expect(h.getChunks().length).toBeGreaterThan(0);
    expect(h.getChunks().every((c) => Array.isArray(c.embedding) && c.embedding.length === 1536)).toBe(true);
  });

  it("marks image-only / empty CVs as failed WITHOUT calling the AI (no invented qualifications)", async () => {
    const h = processingHarness(await makePdf([" "]), "application/pdf");
    const llm = new ScriptedLlm(() => {
      throw new Error("must not be called");
    });
    const res = await processApplication("app1", { store: h.store, llm });
    expect(res.status).toBe("failed");
    expect(h.state.processing_error).toMatch(/No readable text/);
    expect(h.state.candidate_profile).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
    expect(h.getChunks()).toEqual([]);
  });

  it("reports corrupt files as extraction failures", async () => {
    const h = processingHarness(new TextEncoder().encode("%PDF-1.4 garbage %%EOF"), "application/pdf");
    const res = await processApplication("app1", { store: h.store, llm: null });
    expect(res.status).toBe("failed");
    expect(h.state.processing_error).toMatch(/Text extraction failed/);
  });

  it("keeps extracted text and keyword chunks when OpenAI is not configured, and says so", async () => {
    const h = processingHarness(await makeDocx(SARA_CV), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const res = await processApplication("app1", { store: h.store, llm: null });
    expect(res.status).toBe("failed");
    expect(h.state.cv_text).toContain("Sara Khan");
    expect(h.getChunks().length).toBeGreaterThan(0);
    expect(h.state.processing_error).toMatch(/OPENAI_API_KEY/);
  });

  it("reports AI failures during indexing", async () => {
    const h = processingHarness(await makePdf(SARA_CV), "application/pdf");
    const llm = new ScriptedLlm(() => ({ content: "not json", toolCalls: [] }));
    const res = await processApplication("app1", { store: h.store, llm });
    expect(res.status).toBe("failed");
    expect(h.state.processing_error).toMatch(/AI indexing failed/);
    expect(h.state.cv_text).toContain("Sara Khan");
  });
});

describe("application deletion & cleanup", () => {
  it("removes the CV file, the row (chunks cascade) and CV excerpts from chat evidence", async () => {
    const files = new Set(["job1/app1.pdf", "job1/app2.pdf"]);
    const rows = new Set(["app1", "app2"]);
    const ev = (application_id: string, ref: string): EvidenceRef => ({
      ref,
      application_id,
      candidate_name: application_id,
      chunk_id: null,
      chunk_index: 0,
      excerpt: `secret CV text of ${application_id}`,
    });
    const messages = [
      { id: "m1", evidence: [ev("app1", "E1"), ev("app2", "E2")], metadata: {} as Record<string, unknown> },
      { id: "m2", evidence: [ev("app2", "E1")], metadata: {} as Record<string, unknown> },
    ];
    const deps: DeleteDeps = {
      getApplication: async (id) => (rows.has(id) ? { id, cv_storage_path: `job1/${id}.pdf` } : null),
      removeCv: async (p) => void files.delete(p),
      deleteApplicationRow: async (id) => void rows.delete(id),
      findMessagesWithEvidence: async (id) => messages.filter((m) => m.evidence.some((e) => e.application_id === id)),
      updateMessage: async (id, patch) => {
        const m = messages.find((x) => x.id === id)!;
        m.evidence = patch.evidence;
        m.metadata = patch.metadata;
      },
    };
    const res = await deleteApplicationData("app1", deps);
    expect(res).toEqual({ deleted: true, scrubbedMessages: 1 });
    expect(files.has("job1/app1.pdf")).toBe(false);
    expect(rows.has("app1")).toBe(false);
    expect(JSON.stringify(messages)).not.toContain("secret CV text of app1");
    expect(messages[0].metadata.redacted_application_ids).toEqual(["app1"]);
    // other applicant untouched
    expect(files.has("job1/app2.pdf")).toBe(true);
    expect(messages[1].evidence).toHaveLength(1);
  });

  it("returns deleted=false for unknown applications", async () => {
    const res = await deleteApplicationData("nope", {
      getApplication: async () => null,
      removeCv: async () => {},
      deleteApplicationRow: async () => {},
      findMessagesWithEvidence: async () => [],
      updateMessage: async () => {},
    });
    expect(res.deleted).toBe(false);
  });
});
