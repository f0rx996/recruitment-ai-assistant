"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";

export function CopyLinkButton({ url, size = "sm" }: { url: string; size?: "sm" | "default" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          window.prompt("Copy this link:", url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      title={url}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function JobStatusToggle({ jobId, status }: { jobId: string; status: "open" | "closed" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = status === "open" ? "closed" : "open";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        if (next === "closed" && !confirm("Close applications for this job? Candidates will no longer be able to apply.")) return;
        setBusy(true);
        const res = await fetch(`/api/hr/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        setBusy(false);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          alert(body.error ?? "Could not update the job status.");
          return;
        }
        router.refresh();
      }}
    >
      {busy ? <Spinner /> : status === "open" ? <Lock /> : <LockOpen />}
      {status === "open" ? "Close applications" : "Reopen applications"}
    </Button>
  );
}
