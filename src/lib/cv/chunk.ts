export interface TextChunk {
  index: number;
  content: string;
}

/**
 * Splits CV text into retrieval chunks along paragraph/line boundaries,
 * targeting ~`target` characters with a small overlap so that facts spanning
 * a boundary (e.g. a job title and its bullet points) stay retrievable.
 */
export function chunkCvText(text: string, target = 1000, overlap = 150): TextChunk[] {
  const clean = text.trim();
  if (!clean) return [];

  // Paragraph units; very long paragraphs are split by sentences, then hard-split.
  const units: string[] = [];
  for (const para of clean.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= target) {
      units.push(p);
      continue;
    }
    const lines = p.split(/\n|(?<=[.!?;])\s+/);
    let buf = "";
    for (const line of lines) {
      if (line.length > target) {
        if (buf) {
          units.push(buf);
          buf = "";
        }
        for (let i = 0; i < line.length; i += target) units.push(line.slice(i, i + target));
        continue;
      }
      if (buf.length + line.length + 1 > target) {
        units.push(buf);
        buf = line;
      } else {
        buf = buf ? `${buf}\n${line}` : line;
      }
    }
    if (buf) units.push(buf);
  }

  const chunks: TextChunk[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > target) {
      chunks.push({ index: chunks.length, content: current });
      const tail = current.length > overlap ? current.slice(current.length - overlap) : current;
      // Start overlap at a word boundary.
      const cut = tail.indexOf(" ");
      const carry = cut > 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail;
      current = `${carry}\n\n${unit}`;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current) chunks.push({ index: chunks.length, content: current });
  return chunks;
}
