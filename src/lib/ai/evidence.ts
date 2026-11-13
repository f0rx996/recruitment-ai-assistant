import type { EvidenceRef } from "@/lib/types";

/** Assigns stable [E#] reference labels to CV passages shown to the model in one turn. */
export class EvidenceRegistry {
  private byRef = new Map<string, EvidenceRef>();
  private byKey = new Map<string, string>();

  add(e: Omit<EvidenceRef, "ref">): string {
    const key = `${e.application_id}|${e.chunk_id ?? ""}|${e.chunk_index ?? ""}|${e.excerpt.slice(0, 120)}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const ref = `E${this.byRef.size + 1}`;
    this.byRef.set(ref, { ...e, ref });
    this.byKey.set(key, ref);
    return ref;
  }

  get(ref: string): EvidenceRef | undefined {
    return this.byRef.get(ref);
  }

  get size() {
    return this.byRef.size;
  }

  /**
   * Returns the evidence actually cited in `content`, and the content with any
   * citation that does not correspond to a real passage removed.
   */
  resolveCitations(content: string): { content: string; evidence: EvidenceRef[] } {
    const cited: EvidenceRef[] = [];
    const seen = new Set<string>();
    const cleaned = content.replace(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g, (_m, inner: string) => {
      const refs = inner.split(/\s*,\s*/).filter((r) => this.byRef.has(r));
      for (const r of refs) {
        if (!seen.has(r)) {
          seen.add(r);
          cited.push(this.byRef.get(r)!);
        }
      }
      return refs.map((r) => `[${r}]`).join("");
    });
    return { content: cleaned, evidence: cited };
  }
}

/** Removes [E#] markers from stored history so old labels never collide with a new turn's labels. */
export function stripCitations(content: string): string {
  return content.replace(/\s?\[E\d+(?:\s*,\s*E\d+)*\]/g, "");
}
