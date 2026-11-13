import { readZipEntries, ZipFormatError } from "./zip";

export type CvKind = "pdf" | "docx";

export const CV_MIME: Record<CvKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface ValidatedCv {
  kind: CvKind;
  mimeType: string;
  extension: CvKind;
  safeFilename: string;
  size: number;
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

const MAX_DOCX_UNCOMPRESSED = 60 * 1024 * 1024; // 60 MB expanded
const MAX_COMPRESSION_RATIO = 200;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "cv";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001F\u007F<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "cv").slice(0, 200);
}

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

function indexOfAscii(buf: Uint8Array, needle: string, limit = buf.length): number {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  const end = Math.min(limit, buf.length) - n.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Validates a CV by size, extension AND file signature (magic bytes). The
 * browser-supplied MIME type is never trusted.
 */
export function validateCvFile(input: { filename: string; bytes: Uint8Array }, maxBytes: number): ValidatedCv {
  const { bytes } = input;
  const safeFilename = sanitizeFilename(input.filename);
  const ext = safeFilename.toLowerCase().split(".").pop();

  if (bytes.byteLength === 0) throw new FileValidationError("The uploaded file is empty.");
  if (bytes.byteLength > maxBytes) {
    throw new FileValidationError(`The file is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  if (ext !== "pdf" && ext !== "docx") {
    throw new FileValidationError("Only PDF or DOCX files are accepted.");
  }

  if (ext === "pdf") {
    // "%PDF-" must appear within the first 1024 bytes (PDF spec tolerance).
    const at = indexOfAscii(bytes, "%PDF-", 1024);
    if (at < 0) throw new FileValidationError("This file is not a valid PDF document.");
    if (indexOfAscii(bytes, "%%EOF", bytes.length) < 0) {
      throw new FileValidationError("This PDF appears to be truncated or corrupted.");
    }
    // Best-effort rejection of active content: PDF action dictionaries of type
    // JavaScript or Launch ("/S /JavaScript"). Plain text such as
    // "HTML/JavaScript" in a CV does not match this pattern.
    const latin1 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    if (/\/S\s*\/(JavaScript|Launch)\b/.test(latin1)) {
      throw new FileValidationError("PDFs containing scripts or launch actions are not accepted. Please export a plain PDF.");
    }
    return { kind: "pdf", extension: "pdf", mimeType: CV_MIME.pdf, safeFilename, size: bytes.byteLength };
  }

  // DOCX = ZIP container ("PK\x03\x04") with a Word document part.
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new FileValidationError("This file is not a valid DOCX document.");
  }
  let entries;
  try {
    entries = readZipEntries(bytes);
  } catch (e) {
    if (e instanceof ZipFormatError) throw new FileValidationError("This DOCX file is corrupted or unsupported.");
    throw e;
  }
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
    throw new FileValidationError("This file is not a valid Word (DOCX) document.");
  }
  if ([...names].some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new FileValidationError("Documents containing macros are not accepted.");
  }
  let total = 0;
  for (const e of entries) {
    total += e.uncompressedSize;
    if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > MAX_COMPRESSION_RATIO && e.uncompressedSize > 1_000_000) {
      throw new FileValidationError("This DOCX file has a suspicious compression ratio and was rejected.");
    }
  }
  if (total > MAX_DOCX_UNCOMPRESSED) {
    throw new FileValidationError("This DOCX file expands to an unsafe size and was rejected.");
  }
  return { kind: "docx", extension: "docx", mimeType: CV_MIME.docx, safeFilename, size: bytes.byteLength };
}
