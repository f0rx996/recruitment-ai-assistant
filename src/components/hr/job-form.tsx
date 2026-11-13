"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, Input, Label, NativeSelect, Spinner, Textarea } from "@/components/ui/primitives";
import type { Job } from "@/lib/types";

type Errors = Record<string, string>;

export function JobForm({ job }: { job?: Job }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      title: String(f.get("title") ?? ""),
      summary: String(f.get("summary") ?? ""),
      description: String(f.get("description") ?? ""),
      required_skills: String(f.get("required_skills") ?? ""),
      preferred_skills: String(f.get("preferred_skills") ?? ""),
      other_requirements: String(f.get("other_requirements") ?? ""),
      location: String(f.get("location") ?? ""),
      status: String(f.get("status") ?? "open"),
    };
    const res = await fetch(job ? `/api/hr/jobs/${job.id}` : "/api/hr/jobs", {
      method: job ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErrors(body.fieldErrors ?? {});
      setFormError(body.error ?? "Could not save the job.");
      return;
    }
    const id = job?.id ?? body.job?.id;
    router.push(`/hr/jobs/${id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
            <F label="Job title" name="title" error={errors.title}>
              <Input id="title" name="title" defaultValue={job?.title} maxLength={120} placeholder="e.g. Data Analyst" required />
            </F>
            <F label="Status" name="status" error={errors.status}>
              <NativeSelect id="status" name="status" defaultValue={job?.status ?? "open"}>
                <option value="open">Open — accepting applications</option>
                <option value="closed">Closed</option>
              </NativeSelect>
            </F>
          </div>
          <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
            <F label="Short description (shown on job cards)" name="summary" error={errors.summary}>
              <Input id="summary" name="summary" defaultValue={job?.summary} maxLength={300} placeholder="One or two sentences" />
            </F>
            <F label="Location (optional)" name="location" error={errors.location}>
              <Input id="location" name="location" defaultValue={job?.location} maxLength={120} placeholder="e.g. Remote" />
            </F>
          </div>
          <F label="Job description" name="description" error={errors.description}>
            <Textarea id="description" name="description" defaultValue={job?.description} rows={7} maxLength={10000} required />
          </F>
          <div className="grid gap-5 sm:grid-cols-2">
            <F
              label="Required skills & qualifications"
              hint="One per line. The AI assistant uses these as the evaluation criteria."
              name="required_skills"
              error={errors.required_skills}
            >
              <Textarea
                id="required_skills"
                name="required_skills"
                rows={6}
                defaultValue={job?.required_skills.join("\n")}
                placeholder={"Python\nSQL\nPower BI\n2+ years of data analysis experience"}
              />
            </F>
            <F label="Preferred skills" hint="One per line (optional)." name="preferred_skills" error={errors.preferred_skills}>
              <Textarea id="preferred_skills" name="preferred_skills" rows={6} defaultValue={job?.preferred_skills.join("\n")} />
            </F>
          </div>
          <F label="Other job-related requirements (optional)" name="other_requirements" error={errors.other_requirements}>
            <Textarea
              id="other_requirements"
              name="other_requirements"
              rows={3}
              defaultValue={job?.other_requirements}
              maxLength={3000}
              placeholder="e.g. Fluent English, able to work on-site twice a week"
            />
          </F>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />} {job ? "Save changes" : "Create job"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function F({ label, hint, name, error, children }: { label: string; hint?: string; name: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
