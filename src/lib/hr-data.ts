import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Application, Job } from "@/lib/types";

export type JobWithCount = Job & { applicant_count: number };

export async function listJobsWithCounts(db: SupabaseClient): Promise<JobWithCount[]> {
  const { data, error } = await db.from("jobs").select("*, applications(count)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => {
    const { applications, ...job } = j as Job & { applications: { count: number }[] };
    return { ...(job as Job), applicant_count: applications?.[0]?.count ?? 0 };
  });
}

export async function getJob(db: SupabaseClient, jobId: string): Promise<Job | null> {
  const { data, error } = await db.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Job | null;
}

export type ApplicantRow = Pick<
  Application,
  | "id"
  | "job_id"
  | "candidate_name"
  | "email"
  | "phone"
  | "cv_original_filename"
  | "cv_mime_type"
  | "cv_size_bytes"
  | "processing_status"
  | "processing_error"
  | "review_status"
  | "created_at"
  | "updated_at"
>;

export async function listApplicants(db: SupabaseClient, jobId: string): Promise<ApplicantRow[]> {
  const out: ApplicantRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("applications")
      .select(
        "id, job_id, candidate_name, email, phone, cv_original_filename, cv_mime_type, cv_size_bytes, processing_status, processing_error, review_status, created_at, updated_at",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ApplicantRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
