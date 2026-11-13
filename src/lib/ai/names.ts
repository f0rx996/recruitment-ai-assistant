/**
 * Candidate identity resolution against DATABASE records (never against
 * semantic similarity). Used both to pre-resolve names mentioned by HR and by
 * the assistant's `resolve_candidates` tool.
 */

export interface RosterEntry {
  id: string;
  name: string;
}

export type Resolution =
  | { query: string; status: "unique"; matches: RosterEntry[] }
  | { query: string; status: "ambiguous"; matches: RosterEntry[] }
  | { query: string; status: "not_found"; matches: RosterEntry[] };

export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/'s\b/g, "") // possessive: "Ahmed's" → "ahmed"
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/['-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeName(s).split(" ").filter(Boolean);
}

/** Resolve one name string (e.g. "Ahmed", "Sara Khan") against the roster. */
export function resolveName(query: string, roster: RosterEntry[]): Resolution {
  const q = normalizeName(query);
  const qTokens = tokens(query);
  if (!q || qTokens.length === 0) return { query, status: "not_found", matches: [] };

  // 1) exact full-name match
  const exact = roster.filter((r) => normalizeName(r.name) === q);
  if (exact.length === 1) return { query, status: "unique", matches: exact };
  if (exact.length > 1) return { query, status: "ambiguous", matches: exact };

  // 2) every query token equals a token of the candidate's name
  const tokenMatches = roster.filter((r) => {
    const nt = tokens(r.name);
    return qTokens.every((t) => nt.includes(t));
  });
  if (tokenMatches.length === 1) return { query, status: "unique", matches: tokenMatches };
  if (tokenMatches.length > 1) return { query, status: "ambiguous", matches: tokenMatches };

  // 3) prefix match on tokens (e.g. "Moh" → "Mohammed"), min 3 chars
  const prefix = roster.filter((r) => {
    const nt = tokens(r.name);
    return qTokens.every((t) => t.length >= 3 && nt.some((n) => n.startsWith(t)));
  });
  if (prefix.length === 1) return { query, status: "unique", matches: prefix };
  if (prefix.length > 1) return { query, status: "ambiguous", matches: prefix };

  return { query, status: "not_found", matches: [] };
}

/**
 * Finds roster candidates whose names (full or any name token ≥ 3 chars) are
 * mentioned in free text. Returns mentions grouped by the token that was used,
 * so "Ahmed" matching two people is reported as ambiguous.
 */
export function findMentionedCandidates(message: string, roster: RosterEntry[]): Resolution[] {
  const msgTokens = new Set(tokens(message));
  const normMsg = ` ${normalizeName(message)} `;
  const results: Resolution[] = [];
  const handled = new Set<string>();

  // Full names first.
  for (const r of roster) {
    const n = normalizeName(r.name);
    if (n && normMsg.includes(` ${n} `)) {
      const res = resolveName(r.name, roster);
      const key = res.matches.map((m) => m.id).sort().join(",");
      if (!handled.has(key)) {
        handled.add(key);
        results.push(res);
      }
      for (const t of tokens(r.name)) handled.add(`tok:${t}`);
    }
  }

  // Then individual name tokens (first names / surnames).
  const byToken = new Map<string, RosterEntry[]>();
  for (const r of roster) {
    for (const t of tokens(r.name)) {
      if (t.length < 3 || !msgTokens.has(t) || handled.has(`tok:${t}`)) continue;
      const list = byToken.get(t) ?? [];
      if (!list.some((x) => x.id === r.id)) list.push(r);
      byToken.set(t, list);
    }
  }
  for (const [t, matches] of byToken) {
    results.push({ query: t, status: matches.length === 1 ? "unique" : "ambiguous", matches });
  }
  return results;
}
