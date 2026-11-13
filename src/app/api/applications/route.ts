import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { submitApplication } from "@/lib/applications/submit";
import { createAdminClient, CV_BUCKET } from "@/lib/supabase/admin";
import { adminProcessingStore, clientIp, hashIp, llmOrNull, rateLimit } from "@/lib/server/stores";
import { processApplication } from "@/lib/cv/process";
import { consentVersion, maxCvBytes, ConfigError } from "@/lib/env";
import { isUuid } from "@/lib/utils";
import { checkSameOrigin, jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Public CV submission endpoint (no candidate account required). */
export async function POST(request: Request) {
  const cross = checkSameOrigin(request);
  if (cross) return cross;

  const limit = maxCvBytes();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit + 64 * 1024) {
    return jsonError(`The file is too large. Maximum size is ${Math.round(limit / (1024 * 1024))} MB.`, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Invalid form submission.", 400);
  }

  const jobId = String(form.get("jobId") ?? "");
  if (!isUuid(jobId)) return jsonError("Invalid job.", 400);

  const file = form.get("cv");
  let filePayload: { name: string; bytes: Uint8Array } | null = null;
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const f = file as File;
    if (f.size > limit) {
      return jsonError(`The file is too large. Maximum size is ${Math.round(limit / (1024 * 1024))} MB.`, 413, {
        fieldErrors: { cv: "File too large" },
      });
    }
    if (f.size > 0) filePayload = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
  }

  try {
    const db = createAdminClient();
    const result = await submitApplication(
      {
        jobId,
        fullName: form.get("fullName"),
        email: form.get("email"),
        phone: form.get("phone"),
        consent: form.get("consent"),
        honeypot: form.get("website"),
        file: filePayload,
        ipHash: hashIp(clientIp(request.headers)),
      },
      {
        maxBytes: limit,
        consentVersion: consentVersion(),
        newId: () => randomUUID(),
        allowUpload: (ipHash) => rateLimit(`upload:${ipHash}`, 600, 8),
        async getJob(id) {
          const { data, error } = await db.from("jobs").select("id, title, status").eq("id", id).maybeSingle();
          if (error) throw new Error(error.message);
          return data;
        },
        async uploadCv(path, bytes, mimeType) {
          const { error } = await db.storage.from(CV_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
          if (error) throw new Error(`Storage upload failed: ${error.message}`);
        },
        async removeCv(path) {
          await db.storage.from(CV_BUCKET).remove([path]);
        },
        async insertApplication(row) {
          const { error } = await db.from("applications").insert(row);
          if (error) throw new Error(`Could not save application: ${error.message}`);
        },
        scheduleProcessing(applicationId, bytes) {
          // Runs after the response is sent (uses waitUntil on serverless hosts).
          after(async () => {
            try {
              await processApplication(applicationId, { store: adminProcessingStore(), llm: llmOrNull(), bytes });
            } catch (e) {
              console.error("CV processing crashed", applicationId, (e as Error).message);
              await db
                .from("applications")
                .update({ processing_status: "failed", processing_error: "Processing crashed unexpectedly. Use “Retry processing”." })
                .eq("id", applicationId);
            }
          });
        },
      },
    );

    if (!result.ok) return jsonError(result.error, result.status, result.fieldErrors ? { fieldErrors: result.fieldErrors } : undefined);
    return NextResponse.json({ ok: true, jobTitle: result.jobTitle }, { status: 201 });
  } catch (e) {
    if (e instanceof ConfigError) return jsonError("The application service is not configured yet. Please try again later.", 503);
    console.error("application submit failed", (e as Error).message);
    return jsonError("We could not save your application. Please try again.", 500);
  }
}
