import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, MapPin } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getPublicJob } from "@/lib/public-data";
import { maxCvBytes } from "@/lib/env";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const job = await getPublicJob(slug);
  return { title: job ? `${job.title} — Apply` : "Job not found" };
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

export default async function JobDetailPage({ params }: Props) {
  const { slug } = await params;
  const job = await getPublicJob(slug);
  if (!job) notFound();
  const isOpen = job.status === "open";

  return (
    <PublicShell>
      <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All positions
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{job.title}</h1>
            {job.location && (
              <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-4" /> {job.location}
              </p>
            )}
          </div>
          <section>
            <h2 className="mb-2 font-semibold">About the role</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{job.description}</p>
          </section>
          {job.required_skills.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Requirements</h2>
              <List items={job.required_skills} />
            </section>
          )}
          {job.preferred_skills.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Nice to have</h2>
              <List items={job.preferred_skills} />
            </section>
          )}
          {job.other_requirements && (
            <section>
              <h2 className="mb-2 font-semibold">Other requirements</h2>
              <p className="whitespace-pre-line text-sm">{job.other_requirements}</p>
            </section>
          )}
        </div>

        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Apply for this position</CardTitle>
            </CardHeader>
            <CardContent>
              {isOpen ? (
                <ApplyForm jobId={job.id} maxMb={Math.round(maxCvBytes() / (1024 * 1024))} />
              ) : (
                <Alert variant="warning" className="flex items-start gap-2">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  This position is closed and no longer accepts applications.
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
