import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/primitives";

export const metadata = { title: "Application received" };

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const title = typeof job === "string" ? job.slice(0, 120) : "";
  return (
    <PublicShell>
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <CheckCircle2 className="mb-4 size-12 text-emerald-600" />
          <h1 className="text-xl font-semibold">Application submitted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thank you! Your application{title ? ` for ${title}` : ""} has been received and your CV was uploaded securely.
            Our HR team will review it and contact you if your profile matches the role.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Back to open positions</Link>
          </Button>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
