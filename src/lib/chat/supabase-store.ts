import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatSession, Job } from "@/lib/types";
import type { ChatStore } from "./turn";

/** ChatStore over the HR user's RLS-bound client (users only ever see their own sessions). */
export function supabaseChatStore(db: SupabaseClient, userId: string): ChatStore {
  return {
    async getJob(jobId) {
      const { data, error } = await db.from("jobs").select("*").eq("id", jobId).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Job | null;
    },
    async getSession(sessionId, jobId) {
      const { data, error } = await db
        .from("chat_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("job_id", jobId)
        .eq("hr_user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as ChatSession | null;
    },
    async createSession(jobId, title) {
      const { data, error } = await db
        .from("chat_sessions")
        .insert({ job_id: jobId, hr_user_id: userId, title })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as ChatSession;
    },
    async listMessages(sessionId, limit) {
      const { data, error } = await db
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return ((data ?? []) as ChatMessage[]).reverse();
    },
    async addMessage(sessionId, msg) {
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          session_id: sessionId,
          role: msg.role,
          content: msg.content.slice(0, 60000),
          evidence: msg.evidence ?? [],
          metadata: msg.metadata ?? {},
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as ChatMessage;
    },
    async touchSession(sessionId) {
      await db.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
    },
  };
}
