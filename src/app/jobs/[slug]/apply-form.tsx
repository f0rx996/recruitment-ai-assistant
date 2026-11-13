"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Input, Label, Spinner } from "@/components/ui/primitives";
import { formatBytes } from "@/lib/utils";

type FieldErrors = Partial<Record<"fullName" | "email" | "phone" | "cv" | "consent", string>>;

export function ApplyForm({ jobId, maxMb }: { jobId: string; maxMb: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const submitting = progress !== null;

  function pickFile(f: File | null) {
    setErrors((e) => ({ ...e, cv: undefined }));
    if (!f) return setFile(null);
    const ext = f.name.toLowerCase().split(".").pop();
    if (ext !== "pdf" && ext !== "docx") {
      setErrors((e) => ({ ...e, cv: "Please upload a PDF or DOCX file." }));
      return setFile(null);
    }
    if (f.size > maxMb * 1024 * 1024) {
      setErrors((e) => ({ ...e, cv: `The file is larger than ${maxMb} MB.` }));
      return setFile(null);
    }
    setFile(f);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const local: FieldErrors = {};
    if (!String(form.get("fullName") ?? "").trim()) local.fullName = "Full name is required";
    if (!String(form.get("email") ?? "").trim()) local.email = "Email is required";
    if (!String(form.get("phone") ?? "").trim()) local.phone = "Phone number is required";
    if (!file) local.cv = "Please attach your CV";
    if (!form.get("consent")) local.consent = "Please confirm your consent to continue";
    setErrors(local);
    if (Object.keys(local).length) return;

    form.set("jobId", jobId);
    form.set("cv", file!);

    // XHR gives real upload progress feedback.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/applications");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let body: { error?: string; fieldErrors?: FieldErrors; jobTitle?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 201) {
        router.push(`/application/success?job=${encodeURIComponent(body.jobTitle ?? "")}`);
        return;
      }
      setProgress(null);
      setErrors(body.fieldErrors ?? {});
      setFormError(body.error ?? "Something went wrong. Please try again.");
    };
    xhr.onerror = () => {
      setProgress(null);
      setFormError("Network error — please check your connection and try again.");
    };
    setProgress(0);
    xhr.send(form);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert variant="destructive">{formError}</Alert>}

      <Field id="fullName" label="Full name" error={errors.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" maxLength={120} required aria-invalid={!!errors.fullName} />
      </Field>
      <Field id="email" label="Email address" error={errors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required aria-invalid={!!errors.email} />
      </Field>
      <Field id="phone" label="Phone number" error={errors.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} required aria-invalid={!!errors.phone} />
      </Field>

      {/* Honeypot for bots — hidden from humans and assistive tech */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className="space-y-1.5">
        <Label htmlFor="cv">CV (PDF or DOCX, max {maxMb} MB)</Label>
        {file ? (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
            <FileText className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            {!submitting && (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                aria-label="Remove file"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ) : (
          <label
            htmlFor="cv"
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center hover:bg-muted/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">Click to upload or drag and drop</span>
            <span className="text-xs text-muted-foreground">PDF or DOCX</span>
          </label>
        )}
        <input
          ref={fileRef}
          id="cv"
          name="cv-picker"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {errors.cv && <p className="text-xs text-destructive">{errors.cv}</p>}
      </div>

      <div className="space-y-1">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" className="mt-0.5 size-4 accent-[var(--primary)]" aria-invalid={!!errors.consent} />
          <span className="text-muted-foreground">
            I agree that my application and CV will be stored and processed for recruitment purposes, including{" "}
            <strong className="font-medium text-foreground">AI-assisted analysis</strong> reviewed by HR staff, as described in the{" "}
            <Link href="/privacy" target="_blank" className="text-primary underline-offset-2 hover:underline">
              privacy notice
            </Link>
            .
          </span>
        </label>
        {errors.consent && <p className="text-xs text-destructive">{errors.consent}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Spinner /> {progress! < 100 ? `Uploading… ${progress}%` : "Processing…"}
          </>
        ) : (
          "Submit Application"
        )}
      </Button>
      {submitting && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
