import type { ChatMessage, ChatSession, EvidenceRef, Job } from "@/lib/types";
import { runAssistantTurn } from "@/lib/ai/assistant";
import { AiServiceError, type LlmClient } from "@/lib/ai/llm";
import type { RecruitmentRepo } from "@/lib/ai/repo";

export interface ChatStore {
  getJob(jobId: string): Promise<Job | null>;
  /** Must only return a session owned by the current HR user AND belonging to jobId. */
  getSession(sessionId: string, jobId: string): Promise<ChatSession | null>;
  createSession(jobId: string, title: string): Promise<ChatSession>;
  /** Most recent `limit` messages in chronological order. */
  listMessages(sessionId: string, limit: number): Promise<ChatMessage[]>;
  addMessage(
    sessionId: string,
    msg: { role: "user" | "assistant"; content: string; evidence?: EvidenceRef[]; metadata?: Record<string, unknown> },
  ): Promise<ChatMessage>;
  touchSession(sessionId: string): Promise<void>;
}

export type ChatEvent =
  | { type: "session"; session: ChatSession }
  | { type: "user_message"; message: ChatMessage }
  | { type: "status"; text: string }
  | { type: "message"; message: ChatMessage }
  | { type: "error"; error: string; message?: ChatMessage };

export function sessionTitle(message: string): string {
  const t = message.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New conversation";
}

/**
 * One chat turn: resolves/creates the job-scoped session, persists the HR
 * message, runs the assistant with prior history, persists the answer (or a
 * visible error message), and emits progress events.
 */
export async function handleChatTurn(
  input: { jobId: string; sessionId: string | null | undefined; message: string },
  deps: { store: ChatStore; makeRepo: (jobId: string) => RecruitmentRepo; llm: LlmClient | null; emit: (e: ChatEvent) => void },
): Promise<void> {
  const { store, emit } = deps;
  const job = await store.getJob(input.jobId);
  if (!job) {
    emit({ type: "error", error: "Job not found." });
    return;
  }

  let session: ChatSession | null = null;
  if (input.sessionId) {
    session = await store.getSession(input.sessionId, job.id);
    if (!session) {
      emit({ type: "error", error: "Conversation not found for this job." });
      return;
    }
  } else {
    session = await store.createSession(job.id, sessionTitle(input.message));
  }
  emit({ type: "session", session });

  const history = await store.listMessages(session.id, 40);
  const userMsg = await store.addMessage(session.id, { role: "user", content: input.message });
  emit({ type: "user_message", message: userMsg });

  const saveError = async (text: string) => {
    const m = await store.addMessage(session!.id, {
      role: "assistant",
      content: text,
      metadata: { error: true },
    });
    await store.touchSession(session!.id);
    emit({ type: "error", error: text, message: m });
  };

  if (!deps.llm) {
    await saveError("The AI assistant is not configured: OPENAI_API_KEY is missing on the server. Ask your administrator to configure OpenAI.");
    return;
  }

  try {
    const result = await runAssistantTurn(
      {
        job,
        history: history.map((m) => ({ role: m.role, content: m.content, metadata: m.metadata })),
        userMessage: input.message,
      },
      { repo: deps.makeRepo(job.id), llm: deps.llm, onStatus: (text) => emit({ type: "status", text }) },
    );
    const saved = await store.addMessage(session.id, {
      role: "assistant",
      content: result.content,
      evidence: result.evidence,
      metadata: result.metadata,
    });
    await store.touchSession(session.id);
    emit({ type: "message", message: saved });
  } catch (e) {
    const reason =
      e instanceof AiServiceError ? e.message : "An unexpected error occurred while generating the answer.";
    if (!(e instanceof AiServiceError)) console.error("assistant turn failed", (e as Error).message);
    await saveError(`⚠️ The AI request failed: ${reason} Your message was saved — you can send it again.`);
  }
}
