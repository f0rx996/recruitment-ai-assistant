import { notFound } from "next/navigation";
import { requireHrPage } from "@/lib/auth";
import { getJob } from "@/lib/hr-data";
import { isUuid } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { JobForm } from "@/components/hr/job-form";

export const metadata = { title: "Edit job" };

export default async function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const { supabase } = await requireHrPage();
  const job = await getJob(supabase, jobId);
  if (!job) notFound();
  return (
    <>
      <PageHeader title={`Edit: ${job.title}`} description="The public link stays the same when you rename the job." />
      <PageBody>
        <JobForm job={job} />
      </PageBody>
    </>
  );
}
