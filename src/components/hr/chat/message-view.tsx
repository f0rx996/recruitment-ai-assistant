"use client";

import { useMemo, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Bot, ChevronDown, ChevronUp, Quote, User } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import type { ChatMessage, EvidenceRef } from "@/lib/types";

function linkifyCitations(content: string): string {
  return content.replace(/\[(E\d+)\]/g, "[$1](#cite-$1)");
}

export function MessageView({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const isUser = message.role === "user";
  const isError = !!message.metadata?.error;
  const evidence = (message.evidence ?? []) as EvidenceRef[];

  // Stable renderer map: recreating it every render would remount citation chips
  // (new component identities) and could swallow clicks.
  const mdComponents = useMemo<Components>(
    () => ({
      table: ({ children }) => (
        <div className="my-3 max-w-full overflow-x-auto">
          <table className="!my-0">{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        if (href?.startsWith("#cite-")) {
          const ref = href.slice(6);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
                setHighlight(ref);
                setTimeout(
                  () => document.getElementById(`${message.id}-${ref}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
                  50,
                );
              }}
              className="mx-0.5 inline-flex -translate-y-px cursor-pointer items-center rounded bg-accent px-1 align-baseline text-[10px] font-semibold text-accent-foreground hover:bg-primary hover:text-primary-foreground"
              title="Show CV evidence"
            >
              {ref}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">
            {children}
          </a>
        );
      },
    }),
    [message.id],
  );

  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm">
          {message.content}
        </div>
        <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full bg-muted sm:flex">
          <User className="size-4 text-muted-foreground" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full sm:flex",
          isError ? "bg-red-50 text-red-600" : "bg-accent text-accent-foreground",
        )}
      >
        {isError ? <AlertTriangle className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "min-w-0 overflow-hidden rounded-2xl rounded-tl-sm border px-4 py-3 shadow-sm",
            isError ? "border-red-200 bg-red-50 text-red-800" : "bg-card",
          )}
        >
          <div className="prose-chat">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {linkifyCitations(message.content)}
            </Markdown>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 px-1 text-xs text-muted-foreground">
          <span>{formatDateTime(message.created_at)}</span>
          {evidence.length > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <Quote className="size-3" /> {evidence.length} CV evidence passage{evidence.length === 1 ? "" : "s"}
              {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          )}
        </div>
        {open && evidence.length > 0 && (
          <div className="mt-2 space-y-2">
            {evidence.map((e) => (
              <div
                key={e.ref}
                id={`${message.id}-${e.ref}`}
                className={cn(
                  "rounded-lg border bg-muted/40 p-3 text-xs transition-colors",
                  highlight === e.ref && "border-primary/50 bg-accent",
                )}
              >
                <p className="mb-1 font-semibold">
                  <span className="mr-1.5 rounded bg-accent px-1 text-[10px] text-accent-foreground">{e.ref}</span>
                  {e.candidate_name}
                  {typeof e.chunk_index === "number" && <span className="font-normal text-muted-foreground"> · CV passage {e.chunk_index + 1}</span>}
                </p>
                <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{e.excerpt}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
