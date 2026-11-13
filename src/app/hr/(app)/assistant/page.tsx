import Link from "next/link";
import { Bot, BriefcaseBusiness } from "lucide-react";
import { requireHrPage } from "@/lib/auth";
import { listJobsWithCounts } from "@/lib/hr-data";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { JobStatusBadge } from "@/components/hr/status-badges";

export const metadata = { title: "AI Assistant" };

export default async function AssistantIndexPage() {
  const { supabase } = await requireHrPage();
  const jobs = await listJobsWithCounts(supabase);
  return (
    <>
      <PageHeader title="AI Assistant" description="Each job has its own assistant, connected only to that job's applicant CVs." />
      <PageBody>
        {jobs.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title="No jobs yet"
            description="Create a job and collect applications to start using the assistant."
            action={
              <Button asChild>
                <Link href="/hr/jobs/new">Create job</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Link key={job.id} href={`/hr/jobs/${job.id}/chat`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{job.title}</p>
                      <JobStatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {job.applicant_count} applicant{job.applicant_count === 1 ? "" : "s"}
                    </p>
                    <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      <Bot className="size-4" /> Open assistant
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
