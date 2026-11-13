import Link from "next/link";
import { BriefcaseBusiness, FileText, FolderOpen, Plus, Users } from "lucide-react";
import { requireHrPage } from "@/lib/auth";
import { listJobsWithCounts } from "@/lib/hr-data";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { JobStatusBadge, ProcessingBadge } from "@/components/hr/status-badges";
import { formatDateTime } from "@/lib/utils";
import type { ProcessingStatus } from "@/lib/types";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { supabase } = await requireHrPage();
  const [jobs, recentRes, totalRes] = await Promise.all([
    listJobsWithCounts(supabase),
    supabase
      .from("applications")
      .select("id, candidate_name, created_at, processing_status, processing_error, job_id, jobs(title)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("applications").select("id", { count: "exact", head: true }),
  ]);
  const recent = (recentRes.data ?? []) as unknown as {
    id: string;
    candidate_name: string;
    created_at: string;
    processing_status: ProcessingStatus;
    processing_error: string | null;
    job_id: string;
    jobs: { title: string } | null;
  }[];
  const openJobs = jobs.filter((j) => j.status === "open").length;

  const stats = [
    { label: "Total job openings", value: jobs.length, icon: BriefcaseBusiness },
    { label: "Open jobs", value: openJobs, icon: FolderOpen },
    { label: "Total applications", value: totalRes.count ?? 0, icon: Users },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of job openings and incoming applications."
        actions={
          <Button asChild>
            <Link href="/hr/jobs/new">
              <Plus /> New job
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-4 p-5">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="text-2xl font-semibold">{value}</p>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Recent submissions</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {recent.length === 0 ? (
                <p className="px-5 pb-4 text-sm text-muted-foreground">No applications yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="pl-5">Candidate</TH>
                      <TH>Job</TH>
                      <TH>CV</TH>
                      <TH>Submitted</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recent.map((a) => (
                      <TR key={a.id}>
                        <TD className="pl-5 font-medium">
                          <Link href={`/hr/jobs/${a.job_id}/applicants/${a.id}`} className="hover:underline">
                            {a.candidate_name}
                          </Link>
                        </TD>
                        <TD className="max-w-[160px] truncate text-muted-foreground">{a.jobs?.title ?? "—"}</TD>
                        <TD>
                          <ProcessingBadge status={a.processing_status} error={a.processing_error} />
                        </TD>
                        <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h2 className="font-semibold">Job openings</h2>
            {jobs.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No job openings yet"
                description="Create your first job to get a shareable application link."
                action={
                  <Button asChild size="sm">
                    <Link href="/hr/jobs/new">Create job</Link>
                  </Button>
                }
              />
            ) : (
              jobs.slice(0, 6).map((job) => (
                <Link key={job.id} href={`/hr/jobs/${job.id}`} className="block">
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{job.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.applicant_count} applicant{job.applicant_count === 1 ? "" : "s"}
                        </p>
                      </div>
                      <JobStatusBadge status={job.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
            {jobs.length > 6 && (
              <Link href="/hr/jobs" className="block text-sm text-primary hover:underline">
                View all {jobs.length} jobs →
              </Link>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
