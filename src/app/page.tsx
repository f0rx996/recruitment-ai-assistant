import Link from "next/link";
import { ArrowRight, MapPin, SearchX } from "lucide-react";
import { PublicShell, SkillChips } from "@/components/public-shell";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, EmptyState, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { listOpenJobs } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const { jobs, error } = await listOpenJobs();

  return (
    <PublicShell>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Open positions</h1>
        <p className="mt-2 text-muted-foreground">
          Find a role that fits you and apply in a minute — no account needed. Just your details and your CV.
        </p>
      </div>

      {error === "not_configured" ? (
        <Alert variant="warning">The job board is not connected to its database yet. Please check back soon.</Alert>
      ) : error ? (
        <Alert variant="destructive">We could not load the job openings right now. Please refresh the page.</Alert>
      ) : jobs.length === 0 ? (
        <EmptyState icon={<SearchX />} title="No open positions right now" description="Please check back later for new opportunities." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.map((job) => (
            <Card key={job.id} className="flex flex-col transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">{job.title}</CardTitle>
                {job.location && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3.5" /> {job.location}
                  </span>
                )}
                <CardDescription className="line-clamp-3">{job.summary || job.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Key requirements</p>
                <SkillChips items={job.required_skills} />
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full sm:w-auto">
                  <Link href={`/jobs/${job.slug}`}>
                    View details & apply <ArrowRight />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
