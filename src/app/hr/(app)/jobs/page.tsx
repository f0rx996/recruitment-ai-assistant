import Link from "next/link";
import { Bot, BriefcaseBusiness, Pencil, Plus, Users } from "lucide-react";
import { requireHrPage } from "@/lib/auth";
import { listJobsWithCounts } from "@/lib/hr-data";
import { publicJobUrl } from "@/lib/jobs";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { JobStatusBadge } from "@/components/hr/status-badges";
import { CopyLinkButton, JobStatusToggle } from "@/components/hr/job-actions";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Job openings" };

export default async function JobsPage() {
  const { supabase } = await requireHrPage();
  const jobs = await listJobsWithCounts(supabase);

  return (
    <>
      <PageHeader
        title="Job Openings"
        description="Create jobs, share application links and open or close applications."
        actions={
          <Button asChild>
            <Link href="/hr/jobs/new">
              <Plus /> New job
            </Link>
          </Button>
        }
      />
      <PageBody>
        {jobs.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title="No job openings yet"
            description="Create a job to generate its public application link."
            action={
              <Button asChild>
                <Link href="/hr/jobs/new">Create job</Link>
              </Button>
            }
          />
        ) : (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">Job</TH>
                  <TH>Status</TH>
                  <TH>Applicants</TH>
                  <TH>Created</TH>
                  <TH className="pr-5 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((job) => (
                  <TR key={job.id}>
                    <TD className="pl-5">
                      <Link href={`/hr/jobs/${job.id}`} className="font-medium hover:underline">
                        {job.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">/jobs/{job.slug}</p>
                    </TD>
                    <TD>
                      <JobStatusBadge status={job.status} />
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-4 text-muted-foreground" /> {job.applicant_count}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(job.created_at)}</TD>
                    <TD className="pr-5">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/hr/jobs/${job.id}`}>
                            <Users /> Applicants
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/hr/jobs/${job.id}/chat`}>
                            <Bot /> AI
                          </Link>
                        </Button>
                        <CopyLinkButton url={publicJobUrl(job.slug)} />
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/hr/jobs/${job.id}/edit`} aria-label="Edit job">
                            <Pencil />
                          </Link>
                        </Button>
                        <JobStatusToggle jobId={job.id} status={job.status} />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </PageBody>
    </>
  );
}
