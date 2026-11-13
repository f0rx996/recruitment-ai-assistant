/** Chat persistence & error handling (in-memory store, MOCKED LLM). */
import { describe, expect, it } from "vitest";
import { handleChatTurn, type ChatEvent, type ChatStore } from "@/lib/chat/turn";
import { AiServiceError } from "@/lib/ai/llm";
import type { ChatMessage, ChatSession } from "@/lib/types";
import { FakeRepo, ScriptedLlm, makeJob, type FakeApplicant } from "../helpers/fakes";
import { SARA_CV } from "../helpers/fixtures";

const JOB = makeJob();
const OTHER_JOB = makeJob({ id: "00000000-0000-4000-8000-0000000000bb", title: "Other" });
const DATA: FakeApplicant[] = [{ id: "11111111-1111-4111-8111-111111111111", job_id: JOB.id, name: "Sara Khan", cv_text: SARA_CV.join("\n") }];

function memoryStore() {
  const sessions: ChatSession[] = [];
  const messages: ChatMessage[] = [];
  let n = 0;
  const store: ChatStore = {
    async getJob(id) {
      return [JOB, OTHER_JOB].find((j) => j.id === id) ?? null;
    },
    async getSession(id, jobId) {
      return sessions.find((s) => s.id === id && s.job_id === jobId) ?? null;
    },
    async createSession(jobId, title) {
      const s: ChatSession = { id: `s${++n}`, job_id: jobId, hr_user_id: "u1", title, created_at: "", updated_at: "" };
      sessions.push(s);
      return s;
    },
    async listMessages(sessionId, limit) {
      return messages.filter((m) => m.session_id === sessionId).slice(-limit);
    },
    async addMessage(sessionId, msg) {
      const m: ChatMessage = {
        id: `m${++n}`,
        session_id: sessionId,
        role: msg.role,
        content: msg.content,
        evidence: msg.evidence ?? [],
        metadata: (msg.metadata ?? {}) as ChatMessage["metadata"],
        created_at: new Date(Date.now() + n).toISOString(),
      };
      messages.push(m);
      return m;
    },
    async touchSession() {},
  };
  return { store, sessions, messages };
}

describe("chat turns: persistence", () => {
  it("creates a job-scoped session, saves both messages, and feeds history into follow-ups", async () => {
    const { store, sessions, messages } = memoryStore();
    const events: ChatEvent[] = [];
    const llm = new ScriptedLlm((params, i) => ({ content: i === 0 ? "Sara is strongest." : "Questions for Sara…", toolCalls: [] }));
    const deps = { store, makeRepo: (id: string) => new FakeRepo(id, DATA), llm, emit: (e: ChatEvent) => events.push(e) };

    await handleChatTurn({ jobId: JOB.id, sessionId: null, message: "Compare all candidates" }, deps);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].job_id).toBe(JOB.id);
    expect(sessions[0].title).toBe("Compare all candidates");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["session", "user_message", "status", "message"]));

    await handleChatTurn({ jobId: JOB.id, sessionId: sessions[0].id, message: "Generate interview questions for the strongest candidate." }, deps);
    expect(messages).toHaveLength(4);
    const second = llm.requests[llm.requests.length - 1];
    const contents = second.messages.map((m) => ("content" in m ? m.content : ""));
    expect(contents).toContain("Compare all candidates");
    expect(contents.some((c) => c?.startsWith("Sara is strongest."))).toBe(true);
  });

  it("does not allow continuing a session under a different job", async () => {
    const { store, sessions, messages } = memoryStore();
    const events: ChatEvent[] = [];
    const llm = new ScriptedLlm(() => ({ content: "ok", toolCalls: [] }));
    const deps = { store, makeRepo: (id: string) => new FakeRepo(id, DATA), llm, emit: (e: ChatEvent) => events.push(e) };
    await handleChatTurn({ jobId: JOB.id, sessionId: null, message: "hello" }, deps);
    events.length = 0;
    await handleChatTurn({ jobId: OTHER_JOB.id, sessionId: sessions[0].id, message: "hello" }, deps);
    expect(events).toEqual([{ type: "error", error: "Conversation not found for this job." }]);
    expect(messages).toHaveLength(2);
  });
});

describe("chat turns: error handling", () => {
  it("persists a visible error message when the AI request fails", async () => {
    const { store, messages } = memoryStore();
    const events: ChatEvent[] = [];
    const llm = new ScriptedLlm(() => {
      throw new AiServiceError("OpenAI service error (503). Try again shortly.", true);
    });
    await handleChatTurn(
      { jobId: JOB.id, sessionId: null, message: "Evaluate Sara" },
      { store, makeRepo: (id) => new FakeRepo(id, DATA), llm, emit: (e) => events.push(e) },
    );
    expect(messages).toHaveLength(2);
    expect(messages[1].metadata.error).toBe(true);
    expect(messages[1].content).toMatch(/AI request failed: OpenAI service error \(503\)/);
    expect(events.at(-1)?.type).toBe("error");
  });

  it("reports missing OpenAI configuration clearly", async () => {
    const { store, messages } = memoryStore();
    await handleChatTurn(
      { jobId: JOB.id, sessionId: null, message: "hello" },
      { store, makeRepo: (id) => new FakeRepo(id, DATA), llm: null, emit: () => {} },
    );
    expect(messages[1].content).toMatch(/OPENAI_API_KEY is missing/);
    expect(messages[1].metadata.error).toBe(true);
  });

  it("returns an error for an unknown job", async () => {
    const { store } = memoryStore();
    const events: ChatEvent[] = [];
    await handleChatTurn(
      { jobId: "00000000-0000-4000-8000-00000000dead", sessionId: null, message: "x" },
      { store, makeRepo: (id) => new FakeRepo(id, DATA), llm: null, emit: (e) => events.push(e) },
    );
    expect(events).toEqual([{ type: "error", error: "Job not found." }]);
  });
});
