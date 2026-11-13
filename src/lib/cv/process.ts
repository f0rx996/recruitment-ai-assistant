import { chunkCvText } from "./chunk";
import { extractCvText, ExtractionError, MIN_READABLE_CHARS } from "@/lib/files/extract";
import type { CvKind } from "@/lib/files/validate";
import type { LlmClient } from "@/lib/ai/llm";
import { AiServiceError } from "@/lib/ai/llm";
import { CANDIDATE_PROFILE_SCHEMA, PROFILE_EXTRACTION_SYSTEM, wrapUntrusted } from "@/lib/ai/prompts";
import type { CandidateProfile, ProcessingStatus } from "@/lib/types";

/** Storage/DB operations needed by the processing pipeline (injected for testability). */
export interface ProcessingStore {
  getApplication(id: string): Promise<{
    id: string;
    job_id: string;
    candidate_name: string;
    cv_storage_path: string;
    cv_mime_type: string;
  } | null>;
  downloadCv(path: string): Promise<Uint8Array>;
  updateApplication(
    id: string,
    patch: Partial<{
      processing_status: ProcessingStatus;
      processing_error: string | null;
      cv_text: string | null;
      candidate_profile: CandidateProfile | null;
      processed_at: string | null;
    }>,
  ): Promise<void>;
  replaceChunks(
    applicationId: string,
    jobId: string,
    chunks: { chunk_index: number; content: string; embedding: number[] | null }[],
  ): Promise<void>;
}

export interface ProcessResult {
  status: ProcessingStatus;
  error: string | null;
  chunks: number;
}

function kindFromMime(mime: string): CvKind {
  return mime === "application/pdf" ? "pdf" : "docx";
}

/**
 * Full CV processing: extract text → store text → chunk → (OpenAI) structured
 * profile + embeddings → mark ready. On any failure the status is "failed"
 * with an HR-readable reason. When no readable text exists we never call the
 * model, so no qualifications can be invented.
 */
export async function processApplication(
  applicationId: string,
  deps: { store: ProcessingStore; llm: LlmClient | null; bytes?: Uint8Array },
): Promise<ProcessResult> {
  const { store, llm } = deps;
  const app = await store.getApplication(applicationId);
  if (!app) return { status: "failed", error: "Application not found", chunks: 0 };

  await store.updateApplication(applicationId, { processing_status: "processing", processing_error: null });

  const fail = async (error: string, extra: { cv_text?: string | null } = {}): Promise<ProcessResult> => {
    await store.updateApplication(applicationId, {
      processing_status: "failed",
      processing_error: error,
      ...(extra.cv_text !== undefined ? { cv_text: extra.cv_text } : {}),
    });
    return { status: "failed", error, chunks: 0 };
  };

  // 1. Text extraction
  let text: string;
  try {
    const bytes = deps.bytes ?? (await store.downloadCv(app.cv_storage_path));
    ({ text } = await extractCvText(kindFromMime(app.cv_mime_type), bytes));
  } catch (e) {
    const msg = e instanceof ExtractionError ? e.message : "The CV file could not be read from storage.";
    await store.replaceChunks(applicationId, app.job_id, []);
    return fail(`Text extraction failed: ${msg} The original CV is still available for manual review.`, {
      cv_text: null,
    });
  }

  if (text.replace(/\s/g, "").length < MIN_READABLE_CHARS) {
    await store.replaceChunks(applicationId, app.job_id, []);
    return fail(
      "No readable text could be extracted (the file may be a scanned image). AI analysis is unavailable for this CV; please review the original file manually.",
      { cv_text: text || null },
    );
  }

  // Store the raw text immediately so HR can read it even if AI steps fail.
  await store.updateApplication(applicationId, { cv_text: text });

  // 2. Chunking (keyword search works even without embeddings)
  const chunks = chunkCvText(text);
  await store.replaceChunks(
    applicationId,
    app.job_id,
    chunks.map((c) => ({ chunk_index: c.index, content: c.content, embedding: null })),
  );

  if (!llm) {
    return fail(
      "Text was extracted, but AI indexing is pending because OpenAI is not configured (OPENAI_API_KEY). Use “Retry processing” after configuring it.",
    );
  }

  // 3. Structured profile + embeddings
  try {
    const [profileRes, embeddings] = await Promise.all([
      llm.chat({
        purpose: "profile_extraction",
        messages: [
          { role: "system", content: PROFILE_EXTRACTION_SYSTEM },
          {
            role: "user",
            content: `Extract the profile from this CV.\n\n${wrapUntrusted("cv_document", { candidate: app.candidate_name }, text.slice(0, 60_000))}`,
          },
        ],
        jsonSchema: { name: "candidate_profile", schema: CANDIDATE_PROFILE_SCHEMA },
      }),
      llm.embed(chunks.map((c) => c.content)),
    ]);

    let profile: CandidateProfile;
    try {
      profile = JSON.parse(profileRes.content ?? "") as CandidateProfile;
    } catch {
      throw new AiServiceError("The AI returned an unreadable profile.");
    }
    if (embeddings.length !== chunks.length) throw new AiServiceError("Embedding count mismatch.");

    await store.replaceChunks(
      applicationId,
      app.job_id,
      chunks.map((c, i) => ({ chunk_index: c.index, content: c.content, embedding: embeddings[i] })),
    );
    await store.updateApplication(applicationId, {
      candidate_profile: profile,
      processing_status: "ready",
      processing_error: null,
      processed_at: new Date().toISOString(),
    });
    return { status: "ready", error: null, chunks: chunks.length };
  } catch (e) {
    const reason = e instanceof AiServiceError ? e.message : "Unexpected error during AI indexing.";
    return fail(`Text was extracted, but AI indexing failed: ${reason} Use “Retry processing” to try again.`);
  }
}
