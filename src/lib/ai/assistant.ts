import type { Job, EvidenceRef } from "@/lib/types";
import { chunkCvText } from "@/lib/cv/chunk";
import { AiServiceError, type LlmClient, type LlmMessage, type LlmToolCall, type LlmToolSpec } from "./llm";
import { EvidenceRegistry, stripCitations } from "./evidence";
import { findMentionedCandidates, resolveName, type Resolution } from "./names";
import { FAIRNESS_RULE, UNTRUSTED_DATA_RULE, jobContext, wrapUntrusted } from "./prompts";
import type { CandidateDocument, RecruitmentRepo, RosterCandidate } from "./repo";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const SMALL_POOL_LIMIT = 10; // ≤ this: read every CV directly for pool-wide questions
export const REVIEW_BATCH_SIZE = 6; // candidates per batch in review_all_applicants
const REVIEW_CONCURRENCY = 3;
const MAX_TOOL_ROUNDS = 8;
const MAX_DETAIL_CHARS_PER_CANDIDATE = 14_000;
const MAX_DETAIL_IDS = 12;
const HISTORY_MESSAGES = 16;
const ROSTER_PROMPT_LIMIT = 250;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  metadata?: { error?: boolean; candidate_ids?: string[] };
}

export interface Coverage {
  total: number;
  assessed: number;
  not_assessable: string[];
  failed: string[];
}

export interface AssistantTurnResult {
  content: string;
  evidence: EvidenceRef[];
  metadata: {
    candidate_ids: string[];
    tools_used: string[];
    coverage?: Coverage;
    model_rounds: number;
  };
}

export interface AssistantDeps {
  repo: RecruitmentRepo;
  llm: LlmClient;
  onStatus?: (text: string) => void;
}

export class AssistantError extends Error {}

// ---------------------------------------------------------------------------
// Tool definitions (exposed to the model)
// ---------------------------------------------------------------------------
const TOOLS: LlmToolSpec[] = [
  {
    name: "resolve_candidates",
    description:
      "Match candidate names mentioned by HR against the database roster for THIS job. Returns unique / ambiguous / not_found per name. Use before discussing a named candidate if the name was not already resolved.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["names"],
      properties: { names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } },
    },
  },
  {
    name: "get_candidate_details",
    description: `Read the CV passages (with [E#] evidence labels) and AI-extracted profile for specific candidates of THIS job. Max ${MAX_DETAIL_IDS} candidate IDs per call. Use for evaluations, comparisons, summaries, interview questions.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["candidate_ids"],
      properties: {
        candidate_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_DETAIL_IDS },
      },
    },
  },
  {
    name: "search_cvs",
    description:
      "Hybrid semantic + keyword search over CV passages of THIS job's applicants. Returns the most relevant passages only (a sample, not exhaustive). Optionally restrict to candidate IDs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query", "candidate_ids"],
      properties: {
        query: { type: "string" },
        candidate_ids: { type: ["array", "null"], items: { type: "string" } },
      },
    },
  },
  {
    name: "check_terms",
    description:
      "Exhaustive check of EVERY applicant's full CV text for specific skills/keywords (e.g. Python, SQL, Power BI, AWS). Returns, for every candidate, which terms are documented with evidence. Use for 'who has X / Y / Z' questions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["terms"],
      properties: { terms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12 } },
    },
  },
  {
    name: "review_all_applicants",
    description:
      "Systematically review EVERY applicant for this job against the job requirements in batches, returning structured, evidence-checked summaries and coverage counts. Use for pool-wide recommendations ('review all applicants', 'who are the strongest candidates'). Follow up with get_candidate_details on a shortlist for deeper analysis.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["focus"],
      properties: { focus: { type: ["string", "null"], description: "Optional extra focus from HR, e.g. 'SQL experience'" } },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function rosterLine(c: RosterCandidate, i: number): string {
  const status = c.has_text
    ? c.processing_status === "ready"
      ? "CV readable"
      : "CV text available (AI index incomplete)"
    : c.processing_status === "failed"
      ? "NO readable CV text"
      : "CV still processing";
  const yrs = c.profile?.documented_years_of_experience?.value;
  return `${i + 1}. ${c.name} — id: ${c.id} — ${status}${typeof yrs === "number" ? ` — documented experience ≈ ${yrs} yrs (AI-extracted, verify)` : ""} — HR status: ${c.review_status}`;
}

export function buildSystemPrompt(job: Job, roster: RosterCandidate[]): string {
  const shown = roster.slice(0, ROSTER_PROMPT_LIMIT);
  const rosterText = roster.length
    ? shown.map(rosterLine).join("\n") +
      (roster.length > shown.length ? `\n… and ${roster.length - shown.length} more (use tools; review_all_applicants covers everyone).` : "")
    : "(No applicants yet.)";

  return `You are the Recruitment AI Assistant for an HR team. You help HR review applicants for ONE job opening, using ONLY the applicants' uploaded CVs (retrieved through your tools) and the job requirements below. You support human decisions; you never make hiring decisions.

=== JOB (the only job in scope) ===
${jobContext(job)}

=== APPLICANT ROSTER (from the database — authoritative; ${roster.length} applicant${roster.length === 1 ? "" : "s"}) ===
${rosterText}

=== HOW TO WORK ===
- Identify candidates ONLY via the roster/database: use the IDs above or resolve_candidates. Never guess who a name refers to. If a name is ambiguous or not found, ask HR to clarify (list the possible matches) instead of answering about the wrong person.
- Before making any claim about a candidate, read their CV evidence with get_candidate_details (or search_cvs / check_terms). Never rely on memory or assumptions.
- Pool-wide questions ("all applicants", "strongest candidates", "who has…"): you must account for EVERY applicant in the roster. With ≤ ${SMALL_POOL_LIMIT} applicants, call get_candidate_details with all their IDs. With more, call review_all_applicants first, then get_candidate_details for the shortlist. For specific skills/keywords use check_terms (exhaustive). search_cvs results are only a sample.
- Explicitly mention applicants whose CV text is unavailable, and never assume their qualifications.
- Evaluate against this job's requirements. For individual evaluations cover: relevant qualifications; relevant professional experience; strengths supported by CV evidence; missing or undocumented requirements; overall suitability for an interview; suggested interview questions.
- For comparisons: compare demonstrated skills and relevant experience, strengths and gaps, say who best meets the requirements and whom to consider interviewing first, and justify with evidence. A small markdown table is welcome.

=== ACCURACY RULES ===
- Never fabricate experience, skills, degrees, employers, dates or certifications.
- Cite CV evidence for important claims using the passage labels exactly as given, e.g. "Built Power BI dashboards [E4]". Only use labels that appear in tool results. The AI-extracted profile is a helper; cite passages, not the profile.
- Distinguish "not mentioned in the CV" (undocumented — may need to be verified in interview) from "the CV shows otherwise" (confirmed gap). Say so explicitly.
- When evidence is insufficient, say so plainly.
- No numerical scores or ratings. Use qualitative judgments (e.g. "strong match", "partial match", "insufficient evidence").
- Present recommendations as suggestions for human review. Never state that a candidate is hired, rejected or shortlisted, and never claim to have changed anyone's status.
- ${FAIRNESS_RULE}
- ${UNTRUSTED_DATA_RULE}
- Do not reveal contact details. Do not discuss applicants of other jobs.

=== STYLE ===
Conversational and concise. Use short headings, bullet points and small tables where they help. Address the HR user directly. Write in the language HR writes in.
PRONOUNS: Never use gendered pronouns (he, she, him, her, his, hers) for candidates — a name does not tell you anyone's gender. Repeat the candidate's name or use "they/them/their".`;
}

// ---------------------------------------------------------------------------
// Intent helpers
// ---------------------------------------------------------------------------
export function isPoolWideRequest(message: string): boolean {
  const m = message.toLowerCase();
  // Referential follow-ups ("questions for the strongest candidate") are about one
  // already-identified person, not a new pool-wide evaluation.
  if (/\b(for|of|about|with|to|on)\s+(the|our|that|this)\s+(strongest|best|top|recommended)\s+(applicant|candidate)\b/.test(m)) {
    return false;
  }
  return (
    /\b(all|every|entire|whole|each)\b[^.?!]{0,40}\b(applicants?|candidates?|cvs?|pool|people)\b/.test(m) ||
    /\b(strongest|best|top)\b[^.?!]{0,30}\b(applicants?|candidates?)\b/.test(m) ||
    /\b(rank|shortlist(ing)?\s+suggestions?|recommend)\b[^.?!]{0,40}\b(applicants?|candidates?)\b/.test(m)
  );
}

function describeResolution(r: Resolution): string {
  if (r.status === "unique") return `"${r.query}" → ${r.matches[0].name} (id: ${r.matches[0].id})`;
  if (r.status === "ambiguous")
    return `"${r.query}" is AMBIGUOUS → ${r.matches.map((m) => `${m.name} (id: ${m.id})`).join("; ")} — ask HR which one they mean unless context makes it certain.`;
  return `"${r.query}" → no applicant with this name for this job.`;
}

// ---------------------------------------------------------------------------
// Turn orchestration
// ---------------------------------------------------------------------------
export async function runAssistantTurn(
  input: { job: Job; history: HistoryMessage[]; userMessage: string },
  deps: AssistantDeps,
): Promise<AssistantTurnResult> {
  const { job, userMessage } = input;
  const { repo, llm } = deps;
  if (repo.jobId !== job.id) throw new AssistantError("Repository is not scoped to this job.");
  const status = (t: string) => deps.onStatus?.(t);

  status("Loading applicant roster…");
  const roster = await repo.listCandidates();
  const rosterById = new Map(roster.map((c) => [c.id, c]));
  const registry = new EvidenceRegistry();
  const toolsUsed: string[] = [];
  const referenced = new Set<string>();
  let coverage: Coverage | undefined;

  const ctx: ToolContext = { job, repo, llm, roster, rosterById, registry, referenced, status };

  // ---- messages -----------------------------------------------------------
  const messages: LlmMessage[] = [{ role: "system", content: buildSystemPrompt(job, roster) }];

  const usable = input.history.filter((m) => !m.metadata?.error).slice(-HISTORY_MESSAGES);
  for (const m of usable) {
    messages.push({ role: m.role, content: m.role === "assistant" ? stripCitations(m.content) : m.content });
  }

  const notes: string[] = [];
  const mentions = findMentionedCandidates(userMessage, roster);
  if (mentions.length) {
    notes.push(`Name resolution for HR's latest message (database lookup):\n${mentions.map(describeResolution).join("\n")}`);
  }
  const lastAssistant = [...usable].reverse().find((m) => m.role === "assistant");
  const prevIds = (lastAssistant?.metadata?.candidate_ids ?? []).filter((id) => rosterById.has(id));
  if (prevIds.length) {
    notes.push(
      `Candidates discussed in your previous answer: ${prevIds.map((id) => `${rosterById.get(id)!.name} (id: ${id})`).join("; ")}. Use these for follow-up references like "them", "the strongest candidate", "she/he".`,
    );
  }
  if (notes.length) messages.push({ role: "system", content: notes.join("\n\n") });
  messages.push({ role: "user", content: userMessage });

  // ---- deterministic prefetch for pool-wide requests ----------------------
  // Guarantees every applicant is accounted for, independent of model behaviour.
  if (roster.length > 0 && isPoolWideRequest(userMessage)) {
    const call: LlmToolCall =
      roster.length <= SMALL_POOL_LIMIT
        ? { id: "prefetch_all_cvs", name: "get_candidate_details", arguments: JSON.stringify({ candidate_ids: roster.map((c) => c.id) }) }
        : { id: "prefetch_pool_review", name: "review_all_applicants", arguments: JSON.stringify({ focus: null }) };
    const out = await executeTool(call, ctx);
    toolsUsed.push(call.name);
    if (out.coverage) coverage = out.coverage;
    else if (call.name === "get_candidate_details") coverage = smallPoolCoverage(roster);
    messages.push({ role: "assistant", content: null, tool_calls: [call] });
    messages.push({ role: "tool", tool_call_id: call.id, content: out.text });
  }

  // ---- tool loop -----------------------------------------------------------
  let rounds = 0;
  let final: string | null = null;
  status("Thinking…");
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const res = await llm.chat({ messages, tools: TOOLS, purpose: "assistant_turn" });
    if (!res.toolCalls.length) {
      final = res.content;
      break;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      const out = await executeTool(call, ctx);
      toolsUsed.push(call.name);
      if (out.coverage) coverage = out.coverage;
      messages.push({ role: "tool", tool_call_id: call.id, content: out.text });
    }
    status("Analysing evidence…");
  }
  if (final === null) {
    rounds++;
    messages.push({
      role: "system",
      content: "Tool budget reached. Answer now using only the evidence already retrieved; state clearly what could not be checked.",
    });
    const res = await llm.chat({ messages, purpose: "assistant_final" });
    final = res.content;
  }
  if (!final || !final.trim()) throw new AiServiceError("The AI returned an empty answer.", true);

  const { content, evidence } = registry.resolveCitations(final.trim());
  for (const e of evidence) referenced.add(e.application_id);

  let body = content;
  if (coverage) body += `\n\n---\n${coverageNote(coverage)}`;

  return {
    content: body,
    evidence,
    metadata: {
      candidate_ids: [...referenced].filter((id) => rosterById.has(id)),
      tools_used: toolsUsed,
      ...(coverage ? { coverage } : {}),
      model_rounds: rounds,
    },
  };
}

export function coverageNote(c: Coverage): string {
  const parts = [`*Coverage (from the database): ${c.assessed} of ${c.total} applicant${c.total === 1 ? "" : "s"} assessed.`];
  if (c.not_assessable.length) parts.push(`No readable CV text: ${c.not_assessable.join(", ")}.`);
  if (c.failed.length) parts.push(`AI assessment failed (review manually): ${c.failed.join(", ")}.`);
  parts.push("AI suggestions are for human review only.*");
  return parts.join(" ");
}

function smallPoolCoverage(roster: RosterCandidate[]): Coverage {
  const readable = roster.filter((c) => c.has_text);
  return {
    total: roster.length,
    assessed: readable.length,
    not_assessable: roster.filter((c) => !c.has_text).map((c) => c.name),
    failed: [],
  };
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
interface ToolContext {
  job: Job;
  repo: RecruitmentRepo;
  llm: LlmClient;
  roster: RosterCandidate[];
  rosterById: Map<string, RosterCandidate>;
  registry: EvidenceRegistry;
  referenced: Set<string>;
  status: (t: string) => void;
}

interface ToolOutput {
  text: string;
  coverage?: Coverage;
}

async function executeTool(call: LlmToolCall, ctx: ToolContext): Promise<ToolOutput> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { text: "ERROR: tool arguments were not valid JSON." };
  }
  try {
    switch (call.name) {
      case "resolve_candidates":
        return toolResolve(args, ctx);
      case "get_candidate_details":
        return await toolDetails(args, ctx);
      case "search_cvs":
        return await toolSearch(args, ctx);
      case "check_terms":
        return await toolCheckTerms(args, ctx);
      case "review_all_applicants":
        return await toolReviewAll(args, ctx);
      default:
        return { text: `ERROR: unknown tool ${call.name}` };
    }
  } catch (e) {
    if (e instanceof AiServiceError) throw e;
    return { text: `ERROR: ${(e as Error).message}` };
  }
}

/** Keeps only IDs that belong to THIS job's roster (prevents cross-job access). */
function partitionIds(ids: unknown, ctx: ToolContext): { valid: string[]; invalid: string[] } {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of [...new Set(list)]) (ctx.rosterById.has(id) ? valid : invalid).push(id);
  return { valid, invalid };
}

function toolResolve(args: Record<string, unknown>, ctx: ToolContext): ToolOutput {
  const names = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === "string").slice(0, 20) : [];
  const entries = ctx.roster.map((c) => ({ id: c.id, name: c.name }));
  return { text: names.map((n) => describeResolution(resolveName(n, entries))).join("\n") || "No names given." };
}

function passagesFor(doc: CandidateDocument): { id: string | null; chunk_index: number; content: string }[] {
  if (doc.chunks.length) return doc.chunks;
  if (doc.cv_text) return chunkCvText(doc.cv_text).map((c) => ({ id: null, chunk_index: c.index, content: c.content }));
  return [];
}

async function toolDetails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const { valid, invalid } = partitionIds(args.candidate_ids, ctx);
  const ids = valid.slice(0, MAX_DETAIL_IDS);
  ctx.status(`Reading ${ids.length} CV${ids.length === 1 ? "" : "s"}…`);
  const docs = await ctx.repo.getDocuments(ids);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const parts: string[] = [];
  if (invalid.length) parts.push(`IGNORED unknown IDs (not applicants for this job): ${invalid.join(", ")}`);
  if (valid.length > ids.length) parts.push(`Only the first ${MAX_DETAIL_IDS} IDs were read; call again for the rest.`);

  for (const id of ids) {
    const c = ctx.rosterById.get(id)!;
    ctx.referenced.add(id);
    const doc = docById.get(id);
    const passages = doc ? passagesFor(doc) : [];
    const header = `### Candidate: ${c.name} (id: ${c.id}) — HR status: ${c.review_status}`;
    if (!passages.length) {
      parts.push(
        `${header}\nCV TEXT UNAVAILABLE (${c.processing_error ?? c.processing_status}). Do not assume any qualifications for this candidate; HR must review the original file.`,
      );
      continue;
    }
    let used = 0;
    const blocks: string[] = [];
    for (const p of passages) {
      if (used + p.content.length > MAX_DETAIL_CHARS_PER_CANDIDATE) {
        blocks.push("(CV truncated for length — use search_cvs with this candidate's ID for the remainder.)");
        break;
      }
      used += p.content.length;
      const ref = ctx.registry.add({
        application_id: id,
        candidate_name: c.name,
        chunk_id: p.id,
        chunk_index: p.chunk_index,
        excerpt: p.content,
      });
      blocks.push(wrapUntrusted("cv_passage", { ref, candidate: c.name }, p.content));
    }
    const profile = c.profile ? `AI-extracted profile (helper only; verify against passages):\n${JSON.stringify(c.profile)}` : "";
    parts.push([header, profile, ...blocks].filter(Boolean).join("\n"));
  }
  return { text: parts.join("\n\n") || "No candidates found." };
}

async function toolSearch(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const query = typeof args.query === "string" ? args.query.slice(0, 500) : "";
  if (!query.trim()) return { text: "ERROR: empty query" };
  const { valid, invalid } = partitionIds(args.candidate_ids ?? [], ctx);
  if (Array.isArray(args.candidate_ids) && args.candidate_ids.length && !valid.length) {
    return { text: `ERROR: none of the candidate IDs belong to this job (${invalid.join(", ")}).` };
  }
  ctx.status("Searching CVs…");
  let embedding: number[] | null = null;
  try {
    [embedding] = await ctx.llm.embed([query]);
  } catch {
    embedding = null; // fall back to keyword search
  }
  const hits = await ctx.repo.searchChunks({ query, embedding, limit: 14, applicationIds: valid.length ? valid : undefined });
  const blocks: string[] = [];
  for (const h of hits) {
    const c = ctx.rosterById.get(h.application_id);
    if (!c) continue; // defensive: never surface passages from outside this job's roster
    ctx.referenced.add(c.id);
    const ref = ctx.registry.add({
      application_id: c.id,
      candidate_name: c.name,
      chunk_id: h.chunk_id,
      chunk_index: h.chunk_index,
      excerpt: h.content,
    });
    blocks.push(wrapUntrusted("cv_passage", { ref, candidate: c.name, candidate_id: c.id }, h.content));
  }
  return {
    text:
      (blocks.length ? blocks.join("\n\n") : "No matching passages found.") +
      "\n\nNOTE: search returns only the most relevant passages. Applicants not listed may still have relevant information; use check_terms or get_candidate_details for completeness.",
  };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termRegex(term: string): RegExp {
  const body = term
    .trim()
    .split(/\s+/)
    .map(escapeRegex)
    .join("[\\s\\-_]*");
  // Custom boundaries so terms like "C++", "C#", ".NET" work.
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

async function toolCheckTerms(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const terms = (Array.isArray(args.terms) ? args.terms : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 60))
    .slice(0, 12);
  if (!terms.length) return { text: "ERROR: no terms" };
  ctx.status(`Checking ${ctx.roster.length} CVs for ${terms.join(", ")}…`);

  const lines: string[] = [`Exhaustive keyword check of all ${ctx.roster.length} applicants for: ${terms.join(", ")}`];
  for (let i = 0; i < ctx.roster.length; i += 50) {
    const batch = ctx.roster.slice(i, i + 50);
    const docs = await ctx.repo.getDocuments(batch.map((c) => c.id));
    const docById = new Map(docs.map((d) => [d.id, d]));
    for (const c of batch) {
      const doc = docById.get(c.id);
      if (!doc?.cv_text) {
        lines.push(`- ${c.name} (id: ${c.id}): CV TEXT UNAVAILABLE — cannot check.`);
        continue;
      }
      const found: string[] = [];
      const missing: string[] = [];
      for (const term of terms) {
        const m = termRegex(term).exec(doc.cv_text);
        if (!m) {
          missing.push(term);
          continue;
        }
        const start = Math.max(0, m.index - 160);
        const end = Math.min(doc.cv_text.length, m.index + m[0].length + 160);
        const excerpt = doc.cv_text.slice(start, end).trim();
        const chunk = doc.chunks.find((ch) => termRegex(term).test(ch.content));
        const ref = ctx.registry.add({
          application_id: c.id,
          candidate_name: c.name,
          chunk_id: chunk?.id ?? null,
          chunk_index: chunk?.chunk_index ?? null,
          excerpt,
        });
        found.push(`${term} [${ref}]`);
      }
      if (found.length) ctx.referenced.add(c.id);
      lines.push(
        `- ${c.name} (id: ${c.id}): mentioned → ${found.length ? found.join(", ") : "none"}; not mentioned → ${missing.length ? missing.join(", ") : "none"}`,
      );
    }
  }
  const evidenceBlocks: string[] = [];
  // Provide the excerpts so the model can quote them.
  for (let n = 1; n <= ctx.registry.size; n++) {
    const e = ctx.registry.get(`E${n}`);
    if (e && lines.some((l) => l.includes(`[E${n}]`))) {
      evidenceBlocks.push(wrapUntrusted("cv_passage", { ref: e.ref, candidate: e.candidate_name }, e.excerpt));
    }
  }
  lines.push(
    "NOTE: 'not mentioned' means the term does not appear in the CV text (undocumented), NOT a confirmed lack of the skill. Synonyms or related wording may exist — verify with get_candidate_details if important.",
  );
  return { text: `${lines.join("\n")}\n\nEXCERPTS:\n${evidenceBlocks.join("\n")}` };
}

// ---- review_all_applicants ------------------------------------------------
const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "requirements", "strengths", "gaps", "interview_priority", "rationale"],
        properties: {
          candidate_id: { type: "string" },
          requirements: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["requirement", "status", "evidence_quote"],
              properties: {
                requirement: { type: "string" },
                status: { type: "string", enum: ["documented", "partially_documented", "not_documented", "contradicted"] },
                evidence_quote: { type: ["string", "null"] },
              },
            },
          },
          strengths: { type: "array", items: { type: "string" } },
          gaps: { type: "array", items: { type: "string" } },
          interview_priority: { type: "string", enum: ["high", "medium", "low", "insufficient_information"] },
          rationale: { type: "string" },
        },
      },
    },
  },
};

interface Assessment {
  candidate_id: string;
  requirements: { requirement: string; status: string; evidence_quote: string | null }[];
  strengths: string[];
  gaps: string[];
  interview_priority: string;
  rationale: string;
}

function normalizeForMatch(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function reviewBatch(docs: CandidateDocument[], focus: string | null, ctx: ToolContext): Promise<Assessment[]> {
  const cvs = docs
    .map((d) => wrapUntrusted("cv_document", { candidate_id: d.id, candidate: d.name }, (d.cv_text ?? "").slice(0, 9000)))
    .join("\n\n");
  const res = await ctx.llm.chat({
    purpose: "pool_review_batch",
    jsonSchema: { name: "pool_review", schema: REVIEW_SCHEMA },
    messages: [
      {
        role: "system",
        content: `You assess job applicants' CVs against job requirements for an HR team. Produce one assessment per candidate_id given — no more, no fewer.
- For every REQUIRED and PREFERRED qualification, set status: documented / partially_documented / not_documented (not mentioned) / contradicted (CV shows otherwise).
- evidence_quote: a short VERBATIM quote (≤ 25 words) copied exactly from that candidate's CV supporting the status, or null.
- No numeric scores. interview_priority is a qualitative suggestion for human review.
- Never invent facts. ${FAIRNESS_RULE}
- ${UNTRUSTED_DATA_RULE}`,
      },
      {
        role: "user",
        content: `${jobContext(ctx.job)}${focus ? `\n\nHR FOCUS: ${focus}` : ""}\n\nCANDIDATES:\n${cvs}`,
      },
    ],
  });
  let parsed: { assessments?: Assessment[] };
  try {
    parsed = JSON.parse(res.content ?? "");
  } catch {
    throw new AiServiceError("Batch review returned unreadable output.", true);
  }
  return parsed.assessments ?? [];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function toolReviewAll(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const focus = typeof args.focus === "string" && args.focus.trim() ? args.focus.trim().slice(0, 300) : null;
  const total = ctx.roster.length;
  const withText = ctx.roster.filter((c) => c.has_text);
  const notAssessable = ctx.roster.filter((c) => !c.has_text).map((c) => c.name);

  const batches: RosterCandidate[][] = [];
  for (let i = 0; i < withText.length; i += REVIEW_BATCH_SIZE) batches.push(withText.slice(i, i + REVIEW_BATCH_SIZE));

  let done = 0;
  ctx.status(`Reviewing all ${total} applicants (${batches.length} batch${batches.length === 1 ? "" : "es"})…`);

  const assessments = new Map<string, Assessment>();
  const docsById = new Map<string, CandidateDocument>();

  await mapLimit(batches, REVIEW_CONCURRENCY, async (batch) => {
    const docs = await ctx.repo.getDocuments(batch.map((c) => c.id));
    for (const d of docs) docsById.set(d.id, d);
    const usable = docs.filter((d) => d.cv_text);
    let result: Assessment[] = [];
    try {
      result = await reviewBatch(usable, focus, ctx);
    } catch (e) {
      if (!(e instanceof AiServiceError) || !e.retryable) throw e;
    }
    const ids = new Set(usable.map((d) => d.id));
    for (const a of result) if (ids.has(a.candidate_id) && !assessments.has(a.candidate_id)) assessments.set(a.candidate_id, a);
    // Retry individually any candidate the batch did not return.
    for (const d of usable) {
      if (assessments.has(d.id)) continue;
      try {
        const single = await reviewBatch([d], focus, ctx);
        const a = single.find((x) => x.candidate_id === d.id);
        if (a) assessments.set(d.id, a);
      } catch (e) {
        if (!(e instanceof AiServiceError) || !e.retryable) throw e;
      }
    }
    done += batch.length;
    ctx.status(`Reviewed ${done} of ${withText.length} readable CVs…`);
  });

  const failed = withText.filter((c) => !assessments.has(c.id)).map((c) => c.name);
  const lines: string[] = [
    `POOL REVIEW — applicants in database: ${total}; assessed: ${assessments.size}; no readable CV text: ${notAssessable.length ? notAssessable.join(", ") : "none"}; assessment failed: ${failed.length ? failed.join(", ") : "none"}.`,
    "Evidence quotes were verified against the CV text; unverifiable quotes were removed.",
  ];

  for (const c of withText) {
    const a = assessments.get(c.id);
    if (!a) continue;
    ctx.referenced.add(c.id);
    const text = docsById.get(c.id)?.cv_text ?? "";
    const normText = normalizeForMatch(text);
    const reqLines = a.requirements.map((r) => {
      let ev = "";
      if (r.evidence_quote) {
        const q = normalizeForMatch(r.evidence_quote);
        if (q.length >= 4 && normText.includes(q)) {
          const ref = ctx.registry.add({
            application_id: c.id,
            candidate_name: c.name,
            chunk_id: null,
            chunk_index: null,
            excerpt: r.evidence_quote.trim(),
          });
          ev = ` [${ref}] "${r.evidence_quote.trim()}"`;
        } else {
          ev = " (quote could not be verified in CV text — treat as unsupported)";
        }
      }
      return `  - ${r.requirement}: ${r.status}${ev}`;
    });
    lines.push(
      [
        `### ${c.name} (id: ${c.id})`,
        `Suggested interview priority: ${a.interview_priority}`,
        `Requirements:\n${reqLines.join("\n")}`,
        `Strengths: ${a.strengths.join("; ") || "—"}`,
        `Gaps / undocumented: ${a.gaps.join("; ") || "—"}`,
        `Rationale: ${a.rationale}`,
      ].join("\n"),
    );
  }
  for (const name of notAssessable) lines.push(`### ${name}\nNo readable CV text — cannot be assessed; HR should review the original file.`);
  for (const name of failed) lines.push(`### ${name}\nAI assessment failed — HR should review manually.`);

  return {
    text: lines.join("\n\n"),
    coverage: { total, assessed: assessments.size, not_assessable: notAssessable, failed },
  };
}
