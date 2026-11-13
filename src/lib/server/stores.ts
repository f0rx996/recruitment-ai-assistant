import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, CV_BUCKET } from "@/lib/supabase/admin";
import type { ProcessingStore } from "@/lib/cv/process";
import type { DeleteDeps } from "@/lib/applications/delete";
import type { EvidenceRef } from "@/lib/types";
import { isOpenAiConfigured } from "@/lib/env";
import { OpenAiLlm } from "@/lib/ai/openai";
import type { LlmClient } from "@/lib/ai/llm";

export function hashIp(ip: string): string {
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** DB-backed fixed-window rate limiter (works across serverless instances). Fails open if the DB call errors. */
export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      console.error("rate_limit_hit failed", error.message);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error("rate limit unavailable", (e as Error).message);
    return true;
  }
}

export function llmOrNull(): LlmClient | null {
  return isOpenAiConfigured() ? new OpenAiLlm() : null;
}

/** Service-role implementation of the CV processing store. */
export function adminProcessingStore(): ProcessingStore {
  const db = createAdminClient();
  return {
    async getApplication(id) {
      const { data, error } = await db
        .from("applications")
        .select("id, job_id, candidate_name, cv_storage_path, cv_mime_type")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async downloadCv(path) {
      const { data, error } = await db.storage.from(CV_BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      return new Uint8Array(await data.arrayBuffer());
    },
    async updateApplication(id, patch) {
      const { error } = await db.from("applications").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async replaceChunks(applicationId, jobId, chunks) {
      const del = await db.from("cv_chunks").delete().eq("application_id", applicationId);
      if (del.error) throw new Error(del.error.message);
      if (chunks.length === 0) return;
      const rows = chunks.map((c) => ({
        application_id: applicationId,
        job_id: jobId,
        chunk_index: c.chunk_index,
        content: c.content,
        embedding: c.embedding ? JSON.stringify(c.embedding) : null,
      }));
      const ins = await db.from("cv_chunks").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    },
  };
}

/**
 * Deletion dependencies. Reads/deletes the row through `userDb` (RLS: only
 * HR admins can delete), while file removal and chat evidence scrubbing use
 * the service role after that authorization has been established.
 */
export function deletionDeps(userDb: SupabaseClient | null): DeleteDeps {
  const admin = createAdminClient();
  const rowDb = userDb ?? admin;
  return {
    async getApplication(id) {
      const { data, error } = await rowDb.from("applications").select("id, cv_storage_path").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async removeCv(path) {
      const { error } = await admin.storage.from(CV_BUCKET).remove([path]);
      if (error) throw new Error(`Could not delete CV file: ${error.message}`);
    },
    async deleteApplicationRow(id) {
      const { error, count } = await rowDb.from("applications").delete({ count: "exact" }).eq("id", id);
      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("Application could not be deleted (not permitted).");
    },
    async findMessagesWithEvidence(applicationId) {
      const { data, error } = await admin
        .from("chat_messages")
        .select("id, evidence, metadata")
        .contains("evidence", JSON.stringify([{ application_id: applicationId }]));
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; evidence: EvidenceRef[]; metadata: Record<string, unknown> }[];
    },
    async updateMessage(id, patch) {
      const { error } = await admin.from("chat_messages").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
