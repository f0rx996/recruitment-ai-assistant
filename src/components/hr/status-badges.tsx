import { Badge } from "@/components/ui/primitives";
import type { JobStatus, ProcessingStatus, ReviewStatus } from "@/lib/types";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return status === "open" ? <Badge variant="success">Open</Badge> : <Badge variant="muted">Closed</Badge>;
}

export function ProcessingBadge({ status, error }: { status: ProcessingStatus; error?: string | null }) {
  const map = {
    pending: { v: "muted" as const, t: "Queued" },
    processing: { v: "default" as const, t: "Processing" },
    ready: { v: "success" as const, t: "AI ready" },
    failed: { v: "destructive" as const, t: "Needs attention" },
  }[status];
  return (
    <Badge variant={map.v} title={error ?? undefined}>
      {map.t}
    </Badge>
  );
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const v = { new: "default", reviewed: "secondary", shortlisted: "success", rejected: "muted" }[status] as
    | "default"
    | "secondary"
    | "success"
    | "muted";
  return <Badge variant={v}>{REVIEW_LABEL[status]}</Badge>;
}
