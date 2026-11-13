"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, MessageSquarePlus, MessagesSquare, PanelLeft, SendHorizontal, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Spinner, Textarea } from "@/components/ui/primitives";
import { ProcessingBadge } from "@/components/hr/status-badges";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSession, ProcessingStatus } from "@/lib/types";
import { MessageView } from "./message-view";

interface Props {
  job: { id: string; title: string; status: string; required_skills: string[]; preferred_skills: string[] };
  candidates: { id: string; name: string; processing_status: ProcessingStatus }[];
  sessions: ChatSession[];
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  aiConfigured: boolean;
}

const SUGGESTIONS = [
  "Compare all candidates and recommend who we should interview first.",
  "Review all applicants for this job and recommend the strongest candidates.",
  "Which candidates have at least three years of documented experience?",
  "Who has experience with the required skills for this role?",
];

type StreamEvent =
  | { type: "session"; session: ChatSession }
  | { type: "user_message"; message: ChatMessage }
  | { type: "status"; text: string }
  | { type: "message"; message: ChatMessage }
  | { type: "error"; error: string; message?: ChatMessage };

export function ChatWorkspace({ job, candidates, sessions: initialSessions, initialSessionId, initialMessages, aiConfigured }: Props) {
  const [sessions, setSessions] = useState(initialSessions);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const setUrlSession = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("session", id);
    else url.searchParams.delete("session");
    window.history.replaceState(null, "", url.toString());
  };

  const openSession = useCallback(async (id: string) => {
    setPanelOpen(false);
    setLoadingSession(true);
    setError(null);
    const res = await fetch(`/api/hr/chat/sessions/${id}`);
    setLoadingSession(false);
    if (!res.ok) {
      setError("Could not load this conversation.");
      return;
    }
    const body = await res.json();
    setSessionId(id);
    setMessages(body.messages ?? []);
    setUrlSession(id);
  }, []);

  function newChat() {
    setPanelOpen(false);
    setSessionId(null);
    setMessages([]);
    setError(null);
    setUrlSession(null);
    inputRef.current?.focus();
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    const res = await fetch(`/api/hr/chat/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) return alert("Could not delete the conversation.");
    setSessions((s) => s.filter((x) => x.id !== id));
    if (id === sessionId) newChat();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setError(null);
    setStatus("Sending…");
    setInput("");
    const tempId = `temp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tempId, session_id: sessionId ?? "", role: "user", content: message, evidence: [], metadata: {}, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await fetch(`/api/hr/jobs/${job.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.type === "session") {
            setSessionId(ev.session.id);
            setUrlSession(ev.session.id);
            setSessions((s) => [ev.session, ...s.filter((x) => x.id !== ev.session.id)]);
          } else if (ev.type === "user_message") {
            setMessages((m) => m.map((x) => (x.id === tempId ? ev.message : x)));
          } else if (ev.type === "status") {
            setStatus(ev.text);
          } else if (ev.type === "message") {
            setMessages((m) => [...m, ev.message]);
          } else if (ev.type === "error") {
            if (ev.message) setMessages((m) => [...m, ev.message!]);
            else setError(ev.error);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message || "The request failed.");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  function insertName(name: string) {
    setInput((v) => (v ? `${v.trimEnd()} ${name}` : name));
    setPanelOpen(false);
    inputRef.current?.focus();
  }

  const sidePanel = (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <Button onClick={newChat} className="w-full" size="sm">
          <MessageSquarePlus /> New conversation
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="p-3">
          <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5" /> Candidates ({candidates.length})
          </h3>
          {candidates.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">No applicants yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => insertName(c.name)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                    title="Insert name into message"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.processing_status !== "ready" && <ProcessingBadge status={c.processing_status} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="border-t p-3">
          <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessagesSquare className="size-3.5" /> Previous conversations
          </h3>
          {sessions.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map((s) => (
                <li key={s.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => openSession(s.id)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      s.id === sessionId && "bg-accent font-medium text-accent-foreground",
                    )}
                    title={s.title}
                  >
                    {s.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSession(s.id)}
                    className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus:opacity-100"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col md:h-dvh">
      {/* Top: job + requirements */}
      <div className="border-b bg-card px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setPanelOpen(true)} aria-label="Show candidates and conversations">
            <PanelLeft />
          </Button>
          <Link href={`/hr/jobs/${job.id}`} className="text-muted-foreground hover:text-foreground" aria-label="Back to applicants">
            <ArrowLeft className="size-4" />
          </Link>
          <Bot className="size-5 text-primary" />
          <h1 className="min-w-0 truncate font-semibold">AI Assistant · {job.title}</h1>
          {job.status === "closed" && <Badge variant="muted">Closed</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-muted-foreground">Requirements:</span>
          {job.required_skills.map((s) => (
            <span key={s} className="rounded-md bg-accent px-1.5 py-0.5 font-medium text-accent-foreground">
              {s}
            </span>
          ))}
          {job.preferred_skills.map((s) => (
            <span key={s} className="rounded-md border border-dashed px-1.5 py-0.5 text-muted-foreground" title="Preferred">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left panel (desktop) */}
        <aside className="hidden w-72 shrink-0 border-r bg-card lg:block">{sidePanel}</aside>

        {/* Left panel (mobile drawer) */}
        {panelOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setPanelOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[85%] bg-card shadow-xl">
              <div className="flex justify-end p-2">
                <Button variant="ghost" size="icon" onClick={() => setPanelOpen(false)} aria-label="Close">
                  <X />
                </Button>
              </div>
              <div className="h-[calc(100%-3.25rem)]">{sidePanel}</div>
            </div>
          </div>
        )}

        {/* Main conversation */}
        <div className="flex min-w-0 flex-1 flex-col bg-muted/30">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
              {!aiConfigured && (
                <Alert variant="warning">
                  OpenAI is not configured on the server (OPENAI_API_KEY). The assistant cannot answer until an administrator configures it.
                </Alert>
              )}
              {loadingSession ? (
                <div className="flex justify-center py-16 text-muted-foreground">
                  <Spinner />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center">
                  <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Bot className="size-6" />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold">Ask about the {candidates.length} applicant{candidates.length === 1 ? "" : "s"} for {job.title}</h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    Answers are grounded in the uploaded CVs and this job&apos;s requirements, with cited evidence. Recommendations are for your review — the assistant never makes hiring decisions.
                  </p>
                  <div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={pending || candidates.length === 0}
                        onClick={() => send(s)}
                        className="rounded-lg border bg-card px-3 py-2.5 text-left text-sm shadow-xs hover:border-primary/40 hover:bg-accent disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => <MessageView key={m.id} message={m} />)
              )}
              {pending && status && (
                <div className="flex items-center gap-2 pl-0 text-sm text-muted-foreground sm:pl-11">
                  <Spinner className="size-3.5" /> {status}
                </div>
              )}
              {error && <Alert variant="destructive">{error}</Alert>}
            </div>
          </div>

          {/* Input */}
          <div className="border-t bg-card p-3 md:p-4">
            <form
              className="mx-auto flex max-w-3xl items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder="Ask about candidates, e.g. “Evaluate Sara's CV for this position”"
                className="max-h-40 min-h-11 resize-none"
                aria-label="Message the AI assistant"
              />
              <Button type="submit" size="icon" className="size-11 shrink-0" disabled={pending || !input.trim()} aria-label="Send">
                {pending ? <Spinner /> : <SendHorizontal />}
              </Button>
            </form>
            <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted-foreground">
              AI can make mistakes. Verify important claims against the cited CV evidence. Enter to send · Shift+Enter for a new line.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
