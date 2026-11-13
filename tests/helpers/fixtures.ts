import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";

/** Builds a real, valid PDF with the given lines of text (fictional CV content). */
export async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 50) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 16;
  }
  return doc.save();
}

/** Builds a real, valid DOCX with the given paragraphs. */
export async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{ children: paragraphs.map((t) => new Paragraph({ children: [new TextRun(t)] })) }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Arbitrary ZIP archive for negative tests. */
export async function makeZip(files: Record<string, string | Uint8Array>, compress = true): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: compress ? "DEFLATE" : "STORE" });
}

export function concatBytes(a: Uint8Array, b: string): Uint8Array {
  const tail = new TextEncoder().encode(b);
  const out = new Uint8Array(a.length + tail.length);
  out.set(a);
  out.set(tail, a.length);
  return out;
}

export const SARA_CV = [
  "Sara Khan",
  "Data Analyst",
  "Experience",
  "Senior Data Analyst, Northwind Analytics (2020 - 2024)",
  "Built Power BI dashboards for sales leadership and automated reporting with Python.",
  "Wrote complex SQL queries in PostgreSQL to analyse 20M rows of transactions.",
  "Education",
  "BSc Computer Science, University of Leeds, 2019",
  "Certifications",
  "Microsoft Certified: Power BI Data Analyst Associate (2022)",
];

export const AHMED_CV = [
  "Ahmed Ali",
  "Junior Analyst",
  "Experience",
  "Reporting Assistant, Contoso Retail (2023 - 2024)",
  "Maintained Excel reports and wrote basic SQL queries.",
  "Education",
  "BA Business Administration, 2022",
];

export const MOHAMMED_CV = [
  "Mohammed Hassan",
  "Software Developer",
  "Experience",
  "Backend Developer, Fabrikam (2019 - 2024)",
  "Developed Python services and data pipelines; used SQL Server daily.",
  "Education",
  "MSc Data Science, 2018",
  "Certifications",
  "AWS Certified Cloud Practitioner (2021)",
];
