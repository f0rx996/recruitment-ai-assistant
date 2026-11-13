/**
 * MOCKS — in-memory stand-ins for the database and the LLM. Tests using these
 * verify our orchestration/authorization logic; they do NOT exercise the real
 * OpenAI API or Supabase (see tests/integration for those).
 */
import type { LlmChatParams, LlmChatResult, LlmClient } from "@/lib/ai/llm";
import type { CandidateDocument, ChunkHit, RecruitmentRepo, RosterCandidate } from "@/lib/ai/repo";
import { chunkCvText } from "@/lib/cv/chunk";
import type { Job } from "@/lib/types";

export interface FakeApplicant {
  id: string;
  job_id: string;
  name: string;
  cv_text: string | null;
  processing_status?: RosterCandidate["processing_status"];
}

export function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Data Analyst",
    slug: "data-analyst",
    summary: "",
    description: "Analyse business data and build dashboards for decision makers.",
    required_skills: ["Python", "SQL", "Power BI", "Data analysis experience"],
    preferred_skills: [],
    other_requirements: "",
    location: "",
    status: "open",
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

/** Job-scoped in-memory repo over a shared multi-job dataset (mirrors SQL job_id filters). */
export class FakeRepo implements RecruitmentRepo {
  public calls: { method: string; args: unknown }[] = [];
  constructor(
    public readonly jobId: string,
    private data: FakeApplicant[],
  ) {}

  private mine() {
    return this.data.filter((a) => a.job_id === this.jobId);
  }

  async listCandidates(): Promise<RosterCandidate[]> {
    this.calls.push({ method: "listCandidates", args: null });
    return this.mine().map((a) => ({
      id: a.id,
      name: a.name,
      processing_status: a.processing_status ?? (a.cv_text ? "ready" : "failed"),
      processing_error: a.cv_text ? null : "No readable text",
      review_status: "new",
      profile: null,
      has_text: !!a.cv_text,
      created_at: new Date().toISOString(),
    }));
  }

  async getDocuments(ids: string[]): Promise<CandidateDocument[]> {
    this.calls.push({ method: "getDocuments", args: ids });
    return this.mine()
      .filter((a) => ids.includes(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        cv_text: a.cv_text,
        chunks: a.cv_text ? chunkCvText(a.cv_text).map((c) => ({ id: `${a.id}-c${c.index}`, chunk_index: c.index, content: c.content })) : [],
      }));
  }

  async searchChunks(args: { query: string; limit: number; applicationIds?: string[] }): Promise<ChunkHit[]> {
    this.calls.push({ method: "searchChunks", args });
    const words = args.query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const hits: ChunkHit[] = [];
    for (const a of this.mine()) {
      if (args.applicationIds && !args.applicationIds.includes(a.id)) continue;
      for (const c of chunkCvText(a.cv_text ?? "")) {
        if (words.some((w) => c.content.toLowerCase().includes(w))) {
          hits.push({ chunk_id: `${a.id}-c${c.index}`, application_id: a.id, chunk_index: c.index, content: c.content });
        }
      }
    }
    return hits.slice(0, args.limit);
  }
}

export type Script = (params: LlmChatParams, callIndex: number) => LlmChatResult | Promise<LlmChatResult>;

/** Scripted LLM. Records every request so tests can assert on prompts. */
export class ScriptedLlm implements LlmClient {
  public requests: LlmChatParams[] = [];
  public embedCalls: string[][] = [];
  constructor(private script: Script) {}
  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    this.requests.push(JSON.parse(JSON.stringify(params)));
    return this.script(params, this.requests.length - 1);
  }
  async embed(texts: string[]): Promise<number[][]> {
    this.embedCalls.push(texts);
    return texts.map(() => new Array(1536).fill(0.01));
  }
}

export function toolCall(name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2, 8)}`) {
  return { id, name, arguments: JSON.stringify(args) };
}

/** Collects all text the model was shown (system/user/tool content). */
export function allPromptText(params: LlmChatParams): string {
  return params.messages.map((m) => ("content" in m && m.content ? m.content : "")).join("\n");
}
