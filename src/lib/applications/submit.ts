import { applicationInputSchema, fieldErrors } from "@/lib/validation";
import { FileValidationError, validateCvFile, type CvKind } from "@/lib/files/validate";

export interface SubmitDeps {
  getJob(jobId: string): Promise<{ id: string; title: string; status: "open" | "closed" } | null>;
  uploadCv(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  removeCv(path: string): Promise<void>;
  insertApplication(row: Record<string, unknown>): Promise<void>;
  /** Returns false when the caller exceeded the upload rate limit. */
  allowUpload(ipHash: string): Promise<boolean>;
  scheduleProcessing(applicationId: string, bytes: Uint8Array, kind: CvKind): void;
  newId(): string;
  maxBytes: number;
  consentVersion: string;
}

export interface SubmitInput {
  jobId: string;
  fullName: unknown;
  email: unknown;
  phone: unknown;
  consent: unknown;
  honeypot?: unknown;
  file: { name: string; bytes: Uint8Array } | null;
  ipHash: string;
}

export type SubmitResult =
  | { ok: true; applicationId: string; jobTitle: string }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string> };

/**
 * Public CV submission. Validates input + file, enforces job open status and
 * rate limits, stores the CV privately, creates the application linked to the
 * job, and schedules background CV processing.
 */
export async function submitApplication(input: SubmitInput, deps: SubmitDeps): Promise<SubmitResult> {
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    // Bot filled the hidden field. Respond generically.
    return { ok: false, status: 400, error: "Submission rejected." };
  }

  if (!(await deps.allowUpload(input.ipHash))) {
    return { ok: false, status: 429, error: "Too many submissions from your network. Please try again later." };
  }

  const parsed = applicationInputSchema.safeParse({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    consent: input.consent === true || input.consent === "true" || input.consent === "on",
  });
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    return { ok: false, status: 400, error: Object.values(fe)[0] ?? "Invalid input", fieldErrors: fe };
  }

  if (!input.file) {
    return { ok: false, status: 400, error: "Please attach your CV (PDF or DOCX).", fieldErrors: { cv: "CV is required" } };
  }

  let validated;
  try {
    validated = validateCvFile({ filename: input.file.name, bytes: input.file.bytes }, deps.maxBytes);
  } catch (e) {
    if (e instanceof FileValidationError) {
      return { ok: false, status: 400, error: e.message, fieldErrors: { cv: e.message } };
    }
    throw e;
  }

  const job = await deps.getJob(input.jobId);
  if (!job) return { ok: false, status: 404, error: "This job opening does not exist." };
  if (job.status !== "open") return { ok: false, status: 409, error: "This position is no longer accepting applications." };

  const applicationId = deps.newId();
  // Storage path never contains user-controlled text.
  const path = `${job.id}/${applicationId}.${validated.extension}`;

  await deps.uploadCv(path, input.file.bytes, validated.mimeType);
  try {
    await deps.insertApplication({
      id: applicationId,
      job_id: job.id,
      candidate_name: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      cv_storage_path: path,
      cv_original_filename: validated.safeFilename,
      cv_mime_type: validated.mimeType,
      cv_size_bytes: validated.size,
      processing_status: "pending",
      review_status: "new",
      consent_given_at: new Date().toISOString(),
      consent_version: deps.consentVersion,
      submitter_ip_hash: input.ipHash,
    });
  } catch (e) {
    await deps.removeCv(path).catch(() => undefined);
    throw e;
  }

  deps.scheduleProcessing(applicationId, input.file.bytes, validated.kind);
  return { ok: true, applicationId, jobTitle: job.title };
}
