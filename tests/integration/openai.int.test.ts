/**
 * REAL OpenAI API tests (costs a few cents). Run with:
 *   RUN_INTEGRATION=1 OPENAI_API_KEY=... npm run test:integration
 * Skipped automatically when not configured.
 */
import { describe, expect, it } from "vitest";
import { OpenAiLlm } from "@/lib/ai/openai";
import { AiServiceError } from "@/lib/ai/llm";
import { runAssistantTurn } from "@/lib/ai/assistant";
import { processApplication, type ProcessingStore } from "@/lib/cv/process";
import { FakeRepo, makeJob, type FakeApplicant } from "../helpers/fakes";
import { AHMED_CV, MOHAMMED_CV, SARA_CV, makePdf } from "../helpers/fixtures";

const enabled = process.env.RUN_INTEGRATION === "1" && !!process.env.OPENAI_API_KEY;
const d = enabled ? describe : describe.skip;

const JOB = makeJob();
const DATA: FakeApplicant[] = [
  { id: "11111111-1111-4111-8111-111111111111", job_id: JOB.id, name: "Sara Khan", cv_text: SARA_CV.join("\n") },
  { id: "22222222-2222-4222-8222-222222222222", job_id: JOB.id, name: "Ahmed Ali", cv_text: AHMED_CV.join("\n") },
  { id: "33333333-3333-4333-8333-333333333333", job_id: JOB.id, name: "Mohammed Hassan", cv_text: MOHAMMED_CV.join("\n") },
];

d("OpenAI (real API)", () => {
  it("creates 1536-dim embeddings", async () => {
    const [v] = await new OpenAiLlm().embed(["Python and SQL data analyst"]);
    expect(v).toHaveLength(1536);
  });

  it("extracts a factual structured profile from a real PDF CV", async () => {
    const state: Record<string, unknown> = {};
    const store: ProcessingStore = {
      getApplication: async () => ({ id: "a", job_id: "j", candidate_name: "Sara Khan", cv_storage_path: "x", cv_mime_type: "application/pdf" }),
      downloadCv: async () => makePdf(SARA_CV),
      updateApplication: async (_i, p) => void Object.assign(state, p),
      replaceChunks: async () => {},
    };
    const res = await processApplication("a", { store, llm: new OpenAiLlm() });
    expect(res.status).toBe("ready");
    const profile = JSON.stringify(state.candidate_profile).toLowerCase();
    expect(profile).toContain("power bi");
    expect(profile).toContain("computer science");
    expect(profile).not.toContain("aws"); // not in Sara's CV — must not be invented
  });

  it("compares all three candidates with grounded citations, then answers a follow-up in context", async () => {
    const llm = new OpenAiLlm();
    const repo = new FakeRepo(JOB.id, DATA);
    const first = await runAssistantTurn(
      { job: JOB, history: [], userMessage: "Compare all three candidates and recommend who we should interview first." },
      { repo, llm },
    );
    console.log("\n--- REAL comparison answer ---\n", first.content);
    for (const name of ["Sara", "Ahmed", "Mohammed"]) expect(first.content).toContain(name);
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.metadata.coverage).toMatchObject({ total: 3, assessed: 3 });

    const second = await runAssistantTurn(
      {
        job: JOB,
        history: [
          { role: "user", content: "Compare all three candidates and recommend who we should interview first." },
          { role: "assistant", content: first.content, metadata: { candidate_ids: first.metadata.candidate_ids } },
        ],
        userMessage: "Generate interview questions for the strongest candidate.",
      },
      { repo, llm },
    );
    console.log("\n--- REAL follow-up answer ---\n", second.content);
    expect(second.content).toMatch(/Sara/);
    expect(second.content).toMatch(/\?/);
    expect(second.metadata.coverage).toBeUndefined(); // referential follow-up, not a pool review
    // The prompt forbids gendered pronouns, but model compliance is best-effort (not deterministic).
    const gendered = (first.content + second.content).match(/\b(he|she|his|her|him)\b/gi);
    if (gendered) console.warn(`[pronoun check] model used gendered pronouns: ${[...new Set(gendered)].join(", ")}`);
  });

  it("maps an invalid API key to a clear AiServiceError", async () => {
    const bad = new OpenAiLlm({ apiKey: "sk-invalid-key-for-test" });
    await expect(bad.embed(["x"])).rejects.toBeInstanceOf(AiServiceError);
    await expect(bad.embed(["x"])).rejects.toThrow(/401|API key/);
  });
});
