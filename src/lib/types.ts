export type HrRole = "admin" | "recruiter";
export type JobStatus = "open" | "closed";
export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";
export type ReviewStatus = "new" | "reviewed" | "shortlisted" | "rejected";

export const REVIEW_STATUSES: ReviewStatus[] = ["new", "reviewed", "shortlisted", "rejected"];

export interface HrUser {
  user_id: string;
  email: string;
  full_name: string | null;
  role: HrRole;
  is_active: boolean;
}

export interface Job {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  required_skills: string[];
  preferred_skills: string[];
  other_requirements: string;
  location: string;
  status: JobStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidateProfile {
  headline: string | null;
  summary: string;
  skills: string[];
  tools_and_technologies: string[];
  education: { degree: string | null; field: string | null; institution: string | null; year: string | null }[];
  experience: {
    title: string | null;
    organization: string | null;
    start: string | null;
    end: string | null;
    highlights: string[];
  }[];
  certifications: { name: string; issuer: string | null; year: string | null }[];
  languages: string[];
  documented_years_of_experience: { value: number | null; basis: string };
}

export interface Application {
  id: string;
  job_id: string;
  candidate_name: string;
  email: string;
  phone: string;
  cv_storage_path: string;
  cv_original_filename: string;
  cv_mime_type: string;
  cv_size_bytes: number;
  cv_text: string | null;
  candidate_profile: CandidateProfile | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  processed_at: string | null;
  review_status: ReviewStatus;
  consent_given_at: string;
  consent_version: string;
  created_at: string;
  updated_at: string;
}

/** Evidence attached to an assistant message. */
export interface EvidenceRef {
  ref: string; // e.g. "E3"
  application_id: string;
  candidate_name: string;
  chunk_id: string | null;
  chunk_index: number | null;
  excerpt: string;
}

export interface ChatSession {
  id: string;
  job_id: string;
  hr_user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  evidence: EvidenceRef[];
  metadata: {
    error?: boolean;
    candidate_ids?: string[];
    coverage?: { total: number; assessed: number; not_assessable: string[] };
  };
  created_at: string;
}
