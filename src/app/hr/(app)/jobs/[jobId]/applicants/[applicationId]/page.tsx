import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, Download, ExternalLink } from "lucide-react";
import { requireHrPage } from "@/lib/auth";
import { isUuid, formatBytes, formatDateTime } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ProcessingBadge, ReviewBadge } from "@/components/hr/status-badges";
import type { Application } from "@/lib/types";

export const metadata = { title: "Applicant" };

export default async function ApplicantPage({ params }: { params: Promise<{ jobId: string; applicationId: string }> }) {
  const { jobId, applicationId } = await params;
  if (!isUuid(jobId) || !isUuid(applicationId)) notFound();
  const { supabase } = await requireHrPage();
  const { data } = await supabase
    .from("applications")
    .select("*, jobs(title)")
    .eq("id", applicationId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) notFound();
  const app = data as Application & { jobs: { title: string } | null };
  const p = app.candidate_profile;

  return (
    <>
      <PageHeader
        title={app.candidate_name}
        description={
          <Link href={`/hr/jobs/${jobId}`} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> {app.jobs?.title ?? "Job"}
          </Link>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/hr/applications/${app.id}/cv`} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open CV
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/hr/applications/${app.id}/cv?download=1`}>
                <Download /> Download
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href={`/hr/jobs/${jobId}/chat`}>
                <Bot /> Ask AI
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Application</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row k="Email" v={<a className="text-primary hover:underline" href={`mailto:${app.email}`}>{app.email}</a>} />
                <Row k="Phone" v={app.phone} />
                <Row k="CV file" v={`${app.cv_original_filename} (${formatBytes(app.cv_size_bytes)})`} />
                <Row k="Submitted" v={formatDateTime(app.created_at)} />
                <Row k="Review status" v={<ReviewBadge status={app.review_status} />} />
                <Row k="Processing" v={<ProcessingBadge status={app.processing_status} error={app.processing_error} />} />
                <Row k="AI consent" v={`${formatDateTime(app.consent_given_at)} (${app.consent_version})`} />
              </CardContent>
            </Card>
            {app.processing_status === "failed" && app.processing_error && <Alert variant="destructive">{app.processing_error}</Alert>}

            {p && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">AI-extracted profile</CardTitle>
                  <p className="text-xs text-muted-foreground">Facts extracted from the CV text. Verify against the original.</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {p.summary && <p>{p.summary}</p>}
                  <ListBlock title="Skills" items={[...p.skills, ...p.tools_and_technologies]} />
                  <ListBlock
                    title="Experience"
                    items={p.experience.map((e) => [e.title, e.organization, [e.start, e.end].filter(Boolean).join("–")].filter(Boolean).join(" · "))}
                  />
                  <ListBlock
                    title="Education"
                    items={p.education.map((e) => [e.degree, e.field, e.institution, e.year].filter(Boolean).join(", "))}
                  />
                  <ListBlock title="Certifications" items={p.certifications.map((c) => [c.name, c.issuer, c.year].filter(Boolean).join(", "))} />
                  <p className="text-xs text-muted-foreground">
                    Documented experience: {p.documented_years_of_experience.value ?? "unknown"} yrs — {p.documented_years_of_experience.basis}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extracted CV text</CardTitle>
            </CardHeader>
            <CardContent>
              {app.cv_text ? (
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-sans text-sm leading-relaxed">
                  {app.cv_text}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {app.processing_status === "pending" || app.processing_status === "processing"
                    ? "The CV is still being processed. Refresh in a moment."
                    : "No text could be extracted from this CV. Please review the original file."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 text-right break-words">{v}</span>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  const clean = items.filter(Boolean);
  if (!clean.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {clean.slice(0, 15).map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
