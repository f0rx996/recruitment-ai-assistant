#!/usr/bin/env node
/**
 * Demo helper: submits three FICTIONAL candidate CVs (real PDF/DOCX files) to a
 * job through the public application endpoint — the same one the apply form uses.
 *
 *   node scripts/demo-apply.mjs <jobId> [baseUrl]
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";

const [jobId, base = "http://localhost:3000"] = process.argv.slice(2);
if (!jobId) {
  console.error("Usage: node scripts/demo-apply.mjs <jobId> [baseUrl]");
  process.exit(1);
}

const CANDIDATES = [
  {
    name: "Sara Khan",
    email: "sara.khan@example.test",
    phone: "+44 20 7946 0101",
    format: "pdf",
    lines: [
      "Sara Khan — Data Analyst",
      "",
      "EXPERIENCE",
      "Senior Data Analyst, Northwind Analytics (Jan 2020 – Dec 2024)",
      "- Built 12 Power BI dashboards used weekly by sales leadership.",
      "- Automated monthly reporting with Python (pandas), saving 3 days per month.",
      "- Wrote complex SQL queries in PostgreSQL over 20M transaction rows.",
      "Junior Analyst, Tailspin Toys (Jul 2018 – Dec 2019)",
      "- Cleaned and analysed customer data in Excel and SQL.",
      "",
      "EDUCATION",
      "BSc Computer Science, University of Leeds, 2018",
      "",
      "CERTIFICATIONS",
      "Microsoft Certified: Power BI Data Analyst Associate (2022)",
    ],
  },
  {
    name: "Ahmed Ali",
    email: "ahmed.ali@example.test",
    phone: "+44 20 7946 0102",
    format: "docx",
    lines: [
      "Ahmed Ali — Junior Reporting Analyst",
      "EXPERIENCE",
      "Reporting Assistant, Contoso Retail (Mar 2023 – present)",
      "- Maintain weekly Excel sales reports for store managers.",
      "- Write basic SQL SELECT queries to export data.",
      "EDUCATION",
      "BA Business Administration, University of Manchester, 2022",
      "SKILLS",
      "Excel (pivot tables, VLOOKUP), basic SQL, presentation skills",
    ],
  },
  {
    name: "Mohammed Hassan",
    email: "mohammed.hassan@example.test",
    phone: "+44 20 7946 0103",
    format: "pdf",
    lines: [
      "Mohammed Hassan — Backend Developer",
      "",
      "EXPERIENCE",
      "Backend Developer, Fabrikam Inc. (Sep 2019 – present)",
      "- Develop Python microservices and ETL data pipelines (Airflow).",
      "- Design SQL Server schemas and optimise queries.",
      "- Built internal metrics reports with Tableau.",
      "",
      "EDUCATION",
      "MSc Data Science, University of Edinburgh, 2019",
      "",
      "CERTIFICATIONS",
      "AWS Certified Cloud Practitioner (2021)",
    ],
  },
];

async function pdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 800;
  for (const l of lines) {
    page.drawText(l.replace("—", "-").replace("–", "-"), { x: 50, y, size: 11, font });
    y -= 17;
  }
  return doc.save();
}

async function docx(lines) {
  const doc = new Document({ sections: [{ children: lines.map((t) => new Paragraph({ children: [new TextRun(t)] })) }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

for (const c of CANDIDATES) {
  const bytes = c.format === "pdf" ? await pdf(c.lines) : await docx(c.lines);
  const mime = c.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const form = new FormData();
  form.set("jobId", jobId);
  form.set("fullName", c.name);
  form.set("email", c.email);
  form.set("phone", c.phone);
  form.set("consent", "on");
  form.set("cv", new Blob([bytes], { type: mime }), `${c.name.replace(" ", "_")}_CV.${c.format}`);
  const res = await fetch(`${base}/api/applications`, { method: "POST", body: form });
  console.log(`${c.name} (${c.format}): ${res.status} ${await res.text()}`);
}
