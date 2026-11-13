import { describe, expect, it } from "vitest";
import { extractCvText, ExtractionError, normalizeExtractedText } from "@/lib/files/extract";
import { makeDocx, makePdf, SARA_CV } from "../helpers/fixtures";

describe("PDF / DOCX text extraction (real parsers, real files)", () => {
  it("extracts text from a real PDF", async () => {
    const pdf = await makePdf(SARA_CV);
    const { text, pages } = await extractCvText("pdf", pdf);
    expect(pages).toBe(1);
    expect(text).toContain("Sara Khan");
    expect(text).toContain("Power BI");
    expect(text).toMatch(/BSc Computer Science/);
  });

  it("extracts text from a real DOCX", async () => {
    const docx = await makeDocx(SARA_CV);
    const { text } = await extractCvText("docx", docx);
    expect(text).toContain("Senior Data Analyst, Northwind Analytics");
    expect(text).toContain("PostgreSQL");
  });

  it("returns a clear ExtractionError for a corrupt PDF", async () => {
    const garbage = new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf\n%%EOF");
    await expect(extractCvText("pdf", garbage)).rejects.toBeInstanceOf(ExtractionError);
  });

  it("returns a clear ExtractionError for a corrupt DOCX", async () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    await expect(extractCvText("docx", garbage)).rejects.toBeInstanceOf(ExtractionError);
  });

  it("normalizes text and strips NUL bytes (Postgres-safe)", () => {
    expect(normalizeExtractedText("a\u0000b\r\n\r\n\r\n\r\nc   d")).toBe("a b\n\nc d");
  });
});
