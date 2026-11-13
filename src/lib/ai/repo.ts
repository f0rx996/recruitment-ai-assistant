import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateProfile, ProcessingStatus, ReviewStatus } from "@/lib/types";

export interface RosterCandidate {
  id: string;
  name: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  review_status: ReviewStatus;
  profile: CandidateProfile | null;
  has_text: boolean;
  created_at: string;
}

export interface CandidateDocument {
  id: string;
  name: string;
  cv_text: string | null;
  chunks: { id: string | null; chunk_index: number; content: string }[];
}

export interface ChunkHit {
  chunk_id: string;
  application_id: string;
  chunk_index: number;
  content: string;
}

/**
 * Data access for the assistant. Every implementation is bound to ONE job and
 * must filter every query by that job ID.
 */
export interface RecruitmentRepo {
  readonly jobId: string;
  /** Complete applicant roster for the job (all pages). */
  listCandidates(): Promise<RosterCandidate[]>;
  getDocuments(applicationIds: string[]): Promise<CandidateDocument[]>;
  searchChunks(args: {
    query: string;
    embedding: number[] | null;
    limit: number;
    applicationIds?: string[];
  }): Promise<ChunkHit[]>;
}

/** Supabase implementation. Uses the HR user's client, so RLS applies as well. */
export class SupabaseRecruitmentRepo implements RecruitmentRepo {
  constructor(
    private db: SupabaseClient,
    public readonly jobId: string,
  ) {}

  async listCandidates(): Promise<RosterCandidate[]> {
    const out: RosterCandidate[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await this.db
        .from("applications")
        .select("id, candidate_name, processing_status, processing_error, review_status, candidate_profile, cv_text, created_at")
        .eq("job_id", this.jobId)
        .order("created_at", { ascending: true })
        .range(from, from + page - 1);
      if (error) throw new Error(`Could not load applicants: ${error.message}`);
      for (const r of data ?? []) {
        out.push({
          id: r.id,
          name: r.candidate_name,
          processing_status: r.processing_status,
          processing_error: r.processing_error,
          review_status: r.review_status,
          profile: r.candidate_profile,
          has_text: typeof r.cv_text === "string" && r.cv_text.trim().length > 0,
          created_at: r.created_at,
        });
      }
      if (!data || data.length < page) break;
    }
    return out;
  }

  async getDocuments(applicationIds: string[]): Promise<CandidateDocument[]> {
    if (applicationIds.length === 0) return [];
    const { data: apps, error } = await this.db
      .from("applications")
      .select("id, candidate_name, cv_text")
      .eq("job_id", this.jobId)
      .in("id", applicationIds);
    if (error) throw new Error(`Could not load CVs: ${error.message}`);
    const { data: chunks, error: cErr } = await this.db
      .from("cv_chunks")
      .select("id, application_id, chunk_index, content")
      .eq("job_id", this.jobId)
      .in("application_id", applicationIds)
      .order("chunk_index", { ascending: true });
    if (cErr) throw new Error(`Could not load CV passages: ${cErr.message}`);
    return (apps ?? []).map((a) => ({
      id: a.id,
      name: a.candidate_name,
      cv_text: a.cv_text,
      chunks: (chunks ?? [])
        .filter((c) => c.application_id === a.id)
        .map((c) => ({ id: c.id, chunk_index: c.chunk_index, content: c.content })),
    }));
  }

  async searchChunks(args: { query: string; embedding: number[] | null; limit: number; applicationIds?: string[] }): Promise<ChunkHit[]> {
    const { data, error } = await this.db.rpc("search_cv_chunks", {
      p_job_id: this.jobId,
      p_query_embedding: args.embedding ? JSON.stringify(args.embedding) : null,
      p_query_text: keywordQuery(args.query),
      p_match_count: args.limit,
      p_application_ids: args.applicationIds?.length ? args.applicationIds : null,
    });
    if (error) throw new Error(`CV search failed: ${error.message}`);
    return ((data ?? []) as ChunkHit[]).map((h) => ({
      chunk_id: h.chunk_id,
      application_id: h.application_id,
      chunk_index: h.chunk_index,
      content: h.content,
    }));
  }
}

/** Turns free text into an OR-joined websearch query so any term can match. */
export function keywordQuery(q: string): string {
  const words = q
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 24);
  return words.join(" or ");
}
