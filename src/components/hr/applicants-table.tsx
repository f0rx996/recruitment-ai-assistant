"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, RefreshCw, Search, Trash2, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Input, NativeSelect, Spinner, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { ProcessingBadge, REVIEW_LABEL } from "@/components/hr/status-badges";
import { formatDateTime } from "@/lib/utils";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/types";
import type { ApplicantRow } from "@/lib/hr-data";

const STALE_MS = 5 * 60 * 1000;

export function ApplicantsTable({ jobId, applicants, canDelete }: { jobId: string; applicants: ApplicantRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState(applicants);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? rows.filter((a) => a.candidate_name.toLowerCase().includes(term)) : rows;
  }, [q, rows]);

  async function setStatus(id: string, review_status: ReviewStatus) {
    setBusy(id);
    const prev = rows;
    setRows((r) => r.map((a) => (a.id === id ? { ...a, review_status } : a)));
    const res = await fetch(`/api/hr/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_status }),
    });
    setBusy(null);
    if (!res.ok) {
      setRows(prev);
      alert("Could not update the status.");
    }
  }

  async function remove(a: ApplicantRow) {
    if (!confirm(`Permanently delete ${a.candidate_name}'s application?\n\nThis removes the CV file, extracted text, AI search data and CV excerpts in chat history. This cannot be undone.`)) return;
    setBusy(a.id);
    const res = await fetch(`/api/hr/applications/${a.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Could not delete the application.");
      return;
    }
    setRows((r) => r.filter((x) => x.id !== a.id));
    router.refresh();
  }

  async function retry(id: string) {
    setBusy(id);
    const res = await fetch(`/api/hr/applications/${id}/reprocess`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Could not restart processing.");
      return;
    }
    setRows((r) => r.map((a) => (a.id === id ? { ...a, processing_status: "pending", processing_error: null } : a)));
    setTimeout(() => router.refresh(), 4000);
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<UserRoundX />}
        title="No applicants yet"
        description="Share the job's public application link. New applications appear here automatically."
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="pl-9" aria-label="Search applicants by name" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH className="pl-5">Candidate</TH>
            <TH>Phone</TH>
            <TH>CV</TH>
            <TH>Submitted</TH>
            <TH>Processing</TH>
            <TH>Review status</TH>
            <TH className="pr-5 text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {filtered.map((a) => {
            const stale =
              (a.processing_status === "pending" || a.processing_status === "processing") &&
              Date.now() - new Date(a.updated_at).getTime() > STALE_MS;
            return (
              <TR key={a.id}>
                <TD className="pl-5">
                  <Link href={`/hr/jobs/${jobId}/applicants/${a.id}`} className="font-medium hover:underline">
                    {a.candidate_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{a.email}</p>
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground">{a.phone}</TD>
                <TD className="max-w-[180px]">
                  <a
                    href={`/api/hr/applications/${a.id}/cv`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-primary hover:underline"
                    title="Open original CV"
                  >
                    <FileText className="size-4 shrink-0" />
                    <span className="truncate">{a.cv_original_filename}</span>
                  </a>
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <ProcessingBadge status={a.processing_status} error={a.processing_error} />
                    {(a.processing_status === "failed" || stale) && (
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => retry(a.id)} disabled={busy === a.id} title="Retry processing">
                        <RefreshCw />
                      </Button>
                    )}
                  </div>
                  {a.processing_status === "failed" && a.processing_error && (
                    <p className="mt-1 max-w-[220px] text-xs text-red-700">{a.processing_error}</p>
                  )}
                </TD>
                <TD>
                  <NativeSelect
                    aria-label={`Review status for ${a.candidate_name}`}
                    value={a.review_status}
                    disabled={busy === a.id}
                    onChange={(e) => setStatus(a.id, e.target.value as ReviewStatus)}
                    className="h-8 w-[130px] text-xs"
                  >
                    {REVIEW_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {REVIEW_LABEL[s]}
                      </option>
                    ))}
                  </NativeSelect>
                </TD>
                <TD className="pr-5">
                  <div className="flex justify-end gap-1">
                    {busy === a.id && <Spinner className="m-2 text-muted-foreground" />}
                    <Button asChild variant="ghost" size="icon" title="View details & extracted text">
                      <Link href={`/hr/jobs/${jobId}/applicants/${a.id}`}>
                        <Eye />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="icon" title="Download original CV">
                      <a href={`/api/hr/applications/${a.id}/cv?download=1`}>
                        <Download />
                      </a>
                    </Button>
                    {canDelete && (
                      <Button variant="ghost" size="icon" title="Delete application" onClick={() => remove(a)} disabled={busy === a.id}>
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            );
          })}
          {filtered.length === 0 && (
            <TR>
              <TD colSpan={7} className="py-8 text-center text-muted-foreground">
                No applicants match “{q}”.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </Card>
  );
}
