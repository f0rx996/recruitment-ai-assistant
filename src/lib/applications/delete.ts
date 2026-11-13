import type { EvidenceRef } from "@/lib/types";

export interface DeleteDeps {
  getApplication(id: string): Promise<{ id: string; cv_storage_path: string } | null>;
  removeCv(path: string): Promise<void>;
  /** Deletes the application row; cv_chunks are removed by ON DELETE CASCADE. */
  deleteApplicationRow(id: string): Promise<void>;
  /** Chat messages whose evidence references this application. */
  findMessagesWithEvidence(applicationId: string): Promise<{ id: string; evidence: EvidenceRef[]; metadata: Record<string, unknown> }[]>;
  updateMessage(id: string, patch: { evidence: EvidenceRef[]; metadata: Record<string, unknown> }): Promise<void>;
}

/**
 * Deletes an application and everything derived from it: the original CV
 * file, the DB row (with extracted text and profile), retrieval chunks and
 * embeddings (cascade), and CV excerpts quoted as evidence in chat history.
 * The file is removed first so a partial failure can be retried safely and
 * never leaves an orphaned CV behind.
 */
export async function deleteApplicationData(id: string, deps: DeleteDeps): Promise<{ deleted: boolean; scrubbedMessages: number }> {
  const app = await deps.getApplication(id);
  if (!app) return { deleted: false, scrubbedMessages: 0 };

  await deps.removeCv(app.cv_storage_path);
  await deps.deleteApplicationRow(id);

  const messages = await deps.findMessagesWithEvidence(id);
  for (const m of messages) {
    const evidence = (m.evidence ?? []).filter((e) => e.application_id !== id);
    await deps.updateMessage(m.id, {
      evidence,
      metadata: { ...(m.metadata ?? {}), redacted_application_ids: [...new Set([...(asArray(m.metadata?.redacted_application_ids)), id])] },
    });
  }
  return { deleted: true, scrubbedMessages: messages.length };
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
