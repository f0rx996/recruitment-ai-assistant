import { requireHrPage } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/hr/page-header";
import { JobForm } from "@/components/hr/job-form";

export const metadata = { title: "Create job" };

export default async function NewJobPage() {
  await requireHrPage();
  return (
    <>
      <PageHeader title="Create job opening" description="A public application link is generated automatically from the title." />
      <PageBody>
        <JobForm />
      </PageBody>
    </>
  );
}
