import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, ExternalLink, Pencil } from "lucide-react";
import { requireHrPage } from "@/lib/auth";
import { getJob, listApplicants } from "@/lib/hr-data";
import { publicJobUrl } from "@/lib/jobs";
import { isUuid } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/primitives";
import { JobStatusBadge } from "@/components/hr/status-badges";
import { CopyLinkButton, JobStatusToggle } from "@/components/hr/job-actions";
import { ApplicantsTable } from "@/components/hr/applicants-table";
import { SkillChips } from "@/components/public-shell";

export const metadata = { title: "Applicants" };

export default async function JobApplicantsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const { supabase, hr } = await requireHrPage();
  const job = await getJob(supabase, jobId);
  if (!job) notFound();
  const applicants = await listApplicants(supabase, jobId);
  const url = publicJobUrl(job.slug);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {job.title} <JobStatusBadge status={job.status} />
          </span>
        }
        description={
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            {url} <ExternalLink className="size-3.5" />
          </a>
        }
        actions={
          <>
            <CopyLinkButton url={url} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/hr/jobs/${job.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <JobStatusToggle jobId={job.id} status={job.status} />
            <Button asChild size="sm">
              <Link href={`/hr/jobs/${job.id}/chat`}>
                <Bot /> AI Assistant
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Required</p>
              <SkillChips items={job.required_skills} max={20} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preferred</p>
              {job.preferred_skills.length ? <SkillChips items={job.preferred_skills} max={20} /> : <p className="text-sm text-muted-foreground">—</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Applicants <span className="text-muted-foreground">({applicants.length})</span>
          </h2>
        </div>
        <ApplicantsTable jobId={job.id} applicants={applicants} canDelete={hr.role === "admin"} />
      </PageBody>
    </>
  );
}
