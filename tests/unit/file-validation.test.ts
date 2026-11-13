import { describe, expect, it } from "vitest";
import { validateCvFile, FileValidationError, sanitizeFilename } from "@/lib/files/validate";
import { makeDocx, makePdf, makeZip, concatBytes, SARA_CV } from "../helpers/fixtures";

const MB = 1024 * 1024;

describe("CV file validation (type, size, signature, structure)", () => {
  it("accepts a valid PDF", async () => {
    const pdf = await makePdf(SARA_CV);
    const v = validateCvFile({ filename: "Sara Khan CV.pdf", bytes: pdf }, 4 * MB);
    expect(v.kind).toBe("pdf");
    expect(v.mimeType).toBe("application/pdf");
  });

  it("accepts a valid DOCX", async () => {
    const docx = await makeDocx(SARA_CV);
    const v = validateCvFile({ filename: "cv.docx", bytes: docx }, 4 * MB);
    expect(v.kind).toBe("docx");
  });

  it("rejects an oversized file", async () => {
    const pdf = await makePdf(SARA_CV);
    expect(() => validateCvFile({ filename: "cv.pdf", bytes: pdf }, 100)).toThrow(/too large/i);
  });

  it("rejects an empty file", () => {
    expect(() => validateCvFile({ filename: "cv.pdf", bytes: new Uint8Array() }, MB)).toThrow(FileValidationError);
  });

  it("rejects unsupported extensions", () => {
    expect(() => validateCvFile({ filename: "cv.exe", bytes: new Uint8Array([1, 2, 3]) }, MB)).toThrow(/Only PDF or DOCX/);
    expect(() => validateCvFile({ filename: "cv.doc", bytes: new Uint8Array([1, 2, 3]) }, MB)).toThrow(/Only PDF or DOCX/);
  });

  it("rejects a PNG renamed to .pdf (signature check)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(() => validateCvFile({ filename: "cv.pdf", bytes: png }, MB)).toThrow(/not a valid PDF/);
  });

  it("rejects a PDF renamed to .docx", async () => {
    const pdf = await makePdf(SARA_CV);
    expect(() => validateCvFile({ filename: "cv.docx", bytes: pdf }, MB)).toThrow(/not a valid DOCX/);
  });

  it("rejects a truncated PDF", async () => {
    const pdf = await makePdf(SARA_CV);
    expect(() => validateCvFile({ filename: "cv.pdf", bytes: pdf.slice(0, 200) }, MB)).toThrow(/truncated|corrupted/);
  });

  it("rejects PDFs with JavaScript actions but not CVs that mention JavaScript as a skill", async () => {
    const pdf = await makePdf(SARA_CV);
    const withJs = concatBytes(pdf, "\n9 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF\n");
    expect(() => validateCvFile({ filename: "cv.pdf", bytes: withJs }, MB)).toThrow(/scripts/);

    const skillText = concatBytes(pdf, "\n% (Skills: HTML/JavaScript, React)\n%%EOF\n");
    expect(validateCvFile({ filename: "cv.pdf", bytes: skillText }, MB).kind).toBe("pdf");
  });

  it("rejects a ZIP that is not a Word document", async () => {
    const zip = await makeZip({ "hello.txt": "hi" });
    expect(() => validateCvFile({ filename: "cv.docx", bytes: zip }, MB)).toThrow(/not a valid Word/);
  });

  it("rejects macro-enabled documents", async () => {
    const zip = await makeZip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": "<w:document/>",
      "word/vbaProject.bin": "macro",
    });
    expect(() => validateCvFile({ filename: "cv.docx", bytes: zip }, MB)).toThrow(/macros/);
  });

  it("rejects zip bombs (extreme compression ratio)", async () => {
    const zip = await makeZip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": new Uint8Array(20 * MB), // 20 MB of zeros compresses to ~20 KB
    });
    expect(zip.byteLength).toBeLessThan(MB);
    expect(() => validateCvFile({ filename: "cv.docx", bytes: zip }, 4 * MB)).toThrow(/compression ratio|unsafe size/);
  });

  it("sanitizes filenames (path traversal, control chars)", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\my\u0000cv.pdf")).toBe("mycv.pdf");
    expect(sanitizeFilename("<script>.pdf")).toBe("script.pdf");
  });
});
