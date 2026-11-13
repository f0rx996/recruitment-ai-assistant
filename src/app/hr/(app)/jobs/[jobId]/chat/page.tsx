import { notFound } from "next/navigation";
import { requireHrPage } from "@/lib/auth";
import { getJob } from "@/lib/hr-data";
import { isUuid } from "@/lib/utils";
import { isOpenAiConfigured } from "@/lib/env";
import { ChatWorkspace } from "@/components/hr/chat/chat-workspace";
import type { ChatMessage, ChatSession, ProcessingStatus } from "@/lib/types";

export const metadata = { title: "AI Assistant" };

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { jobId } = await params;
  const { session: sessionParam } = await searchParams;
  if (!isUuid(jobId)) notFound();
  const { supabase, user } = await requireHrPage();
  const job = await getJob(supabase, jobId);
  if (!job) notFound();

  const [{ data: candidates }, { data: sessions }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, candidate_name, processing_status, review_status")
      .eq("job_id", jobId)
      .order("candidate_name", { ascending: true }),
    supabase
      .from("chat_sessions")
      .select("*")
      .eq("job_id", jobId)
      .eq("hr_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  let initialMessages: ChatMessage[] = [];
  let activeSessionId: string | null = null;
  if (sessionParam && isUuid(sessionParam) && (sessions ?? []).some((s) => s.id === sessionParam)) {
    activeSessionId = sessionParam;
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionParam)
      .order("created_at", { ascending: true });
    initialMessages = (data ?? []) as ChatMessage[];
  }

  return (
    <ChatWorkspace
      job={{
        id: job.id,
        title: job.title,
        status: job.status,
        required_skills: job.required_skills,
        preferred_skills: job.preferred_skills,
      }}
      candidates={(candidates ?? []).map((c) => ({
        id: c.id as string,
        name: c.candidate_name as string,
        processing_status: c.processing_status as ProcessingStatus,
      }))}
      sessions={(sessions ?? []) as ChatSession[]}
      initialSessionId={activeSessionId}
      initialMessages={initialMessages}
      aiConfigured={isOpenAiConfigured()}
    />
  );
}
