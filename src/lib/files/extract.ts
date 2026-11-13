import type { CvKind } from "./validate";

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

const MAX_PDF_PAGES = 40;
const MAX_TEXT_CHARS = 200_000;
const EXTRACT_TIMEOUT_MS = 20_000;

/** Normalises extracted text: strips NUL/control chars (Postgres rejects \u0000), collapses whitespace. */
export function normalizeExtractedText(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_CHARS)
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ExtractionError("Text extraction timed out.")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  // Copy: pdf.js may transfer/detach the buffer it is given.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError(`The PDF has ${pdf.numPages} pages; at most ${MAX_PDF_PAGES} are supported.`);
    }
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    return { text: text.join("\n\n"), pages: totalPages };
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return { text: result.value, pages: null };
}

/** Extracts readable text from a validated PDF or DOCX. Throws ExtractionError with an HR-readable reason. */
export async function extractCvText(kind: CvKind, bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  try {
    const result = await withTimeout(kind === "pdf" ? extractPdf(bytes) : extractDocx(bytes), EXTRACT_TIMEOUT_MS);
    return { text: normalizeExtractedText(result.text), pages: result.pages };
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    const name = (e as { name?: string })?.name ?? "";
    if (name === "PasswordException") {
      throw new ExtractionError("The PDF is password-protected, so its text could not be read.");
    }
    throw new ExtractionError(
      `The ${kind.toUpperCase()} file could not be parsed (${(e as Error)?.message?.slice(0, 160) ?? "unknown error"}).`,
    );
  }
}

/** Minimum amount of text we require before treating a CV as readable. */
export const MIN_READABLE_CHARS = 80;
