/**
 * REAL Supabase tests against the project in .env.local (migration must be
 * applied). Creates and removes its own fictional data and temporary users.
 *   RUN_INTEGRATION=1 npm run test:integration
 * Uses the real OpenAI API too when OPENAI_API_KEY is set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { submitApplication } from "@/lib/applications/submit";
import { processApplication } from "@/lib/cv/process";
import { deleteApplicationData } from "@/lib/applications/delete";
import { adminProcessingStore, deletionDeps } from "@/lib/server/stores";
import { SupabaseRecruitmentRepo } from "@/lib/ai/repo";
import { supabaseChatStore } from "@/lib/chat/supabase-store";
import { OpenAiLlm } from "@/lib/ai/openai";
import { AHMED_CV, SARA_CV, makeDocx, makePdf } from "../helpers/fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_INTEGRATION === "1" && !!url && !!anonKey && !!serviceKey;
const d = enabled ? describe : describe.skip;
const llm = process.env.OPENAI_API_KEY ? new OpenAiLlm() : null;

const tag = randomUUID().slice(0, 8);
let admin: SupabaseClient;
let hr: SupabaseClient;
let outsider: SupabaseClient;
let anon: SupabaseClient;
const userIds: string[] = [];
let jobA = "";
let jobB = "";
let closedJob = "";
const appIds: Record<string, string> = {};

async function makeUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userIds.push(data.user.id);
  return data.user.id;
}
async function signedIn(email: string, password: string) {
  const c = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

async function submit(jobId: string, name: string, file: { name: string; bytes: Uint8Array }) {
  let scheduled: Uint8Array | null = null;
  const res = await submitApplication(
    { jobId, fullName: name, email: `${tag}.${name.split(" ")[0].toLowerCase()}@example.test`, phone: "+1 555 0100 999", consent: true, file, ipHash: tag },
    {
      maxBytes: 4 * 1024 * 1024,
      consentVersion: "int-test",
      newId: () => randomUUID(),
      allowUpload: async () => true,
      getJob: async (id) => (await admin.from("jobs").select("id,title,status").eq("id", id).maybeSingle()).data,
      uploadCv: async (p, b, m) => {
        const { error } = await admin.storage.from("cvs").upload(p, b, { contentType: m });
        if (error) throw error;
      },
      removeCv: async (p) => void (await admin.storage.from("cvs").remove([p])),
      insertApplication: async (row) => {
        const { error } = await admin.from("applications").insert(row);
        if (error) throw error;
      },
      scheduleProcessing: (_id, bytes) => void (scheduled = bytes),
    },
  );
  if (!res.ok) throw new Error(res.error);
  await processApplication(res.applicationId, { store: adminProcessingStore(), llm, bytes: scheduled! });
  return res.applicationId;
}

d("Supabase (real project)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const pw = `Pw-${randomUUID()}`;
    const hrId = await makeUser(`hr-${tag}@example.test`, pw);
    await makeUser(`outsider-${tag}@example.test`, pw);
    await admin.from("hr_users").insert({ user_id: hrId, email: `hr-${tag}@example.test`, role: "admin" });
    hr = await signedIn(`hr-${tag}@example.test`, pw);
    outsider = await signedIn(`outsider-${tag}@example.test`, pw);

    const mk = async (title: string, status: "open" | "closed") => {
      const { data, error } = await hr
        .from("jobs")
        .insert({
          title,
          slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${tag}`,
          description: "Integration test job for fictional candidates.",
          required_skills: ["Python", "SQL", "Power BI"],
          status,
          created_by: hrId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    };
    jobA = await mk("Data Analyst", "open");
    jobB = await mk("Accountant", "open");
    closedJob = await mk("Closed Role", "closed");

    appIds.sara = await submit(jobA, "Sara Khan", { name: "sara.pdf", bytes: await makePdf(SARA_CV) });
    appIds.ahmed = await submit(jobA, "Ahmed Ali", { name: "ahmed.docx", bytes: await makeDocx(AHMED_CV) });
    appIds.other = await submit(jobB, "Zara Other", { name: "zara.pdf", bytes: await makePdf(["Zara Other", "UNIQUEJOBBTOKEN Python SQL"]) });
  });

  afterAll(async () => {
    if (!admin) return;
    const { data: apps } = await admin.from("applications").select("id, cv_storage_path").in("job_id", [jobA, jobB, closedJob].filter(Boolean));
    if (apps?.length) {
      await admin.storage.from("cvs").remove(apps.map((a) => a.cv_storage_path));
      await admin.from("applications").delete().in("id", apps.map((a) => a.id));
    }
    await admin.from("jobs").delete().in("id", [jobA, jobB, closedJob].filter(Boolean));
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("anon can read open jobs only, and never applications or chunks", async () => {
    const { data: jobs } = await anon.from("jobs").select("id").in("id", [jobA, closedJob]);
    expect(jobs?.map((j) => j.id)).toEqual([jobA]);
    const { data: apps } = await anon.from("applications").select("id").limit(1);
    expect(apps ?? []).toEqual([]);
    const { data: chunks } = await anon.from("cv_chunks").select("id").limit(1);
    expect(chunks ?? []).toEqual([]);
  });

  it("non-HR authenticated users cannot see applications, CV text or chunks", async () => {
    const { data } = await outsider.from("applications").select("id, cv_text").eq("job_id", jobA);
    expect(data ?? []).toEqual([]);
    const { data: c } = await outsider.from("cv_chunks").select("id").eq("job_id", jobA);
    expect(c ?? []).toEqual([]);
    const { error } = await outsider.from("jobs").insert({ title: "Hack", slug: `hack-${tag}`, description: "x".repeat(30) });
    expect(error).not.toBeNull();
  });

  it("CV files are private: no public or anonymous access", async () => {
    const { data: row } = await admin.from("applications").select("cv_storage_path").eq("id", appIds.sara).single();
    const anonDl = await anon.storage.from("cvs").download(row!.cv_storage_path);
    expect(anonDl.data).toBeNull();
    const outsiderDl = await outsider.storage.from("cvs").download(row!.cv_storage_path);
    expect(outsiderDl.data).toBeNull();
    const pub = await fetch(`${url}/storage/v1/object/public/cvs/${row!.cv_storage_path}`);
    expect(pub.ok).toBe(false);
  });

  it("HR sees applicants associated with the correct job, with extracted text", async () => {
    const { data } = await hr.from("applications").select("id, job_id, candidate_name, cv_text, processing_status").eq("job_id", jobA);
    expect(data?.map((a) => a.candidate_name).sort()).toEqual(["Ahmed Ali", "Sara Khan"]);
    expect(data?.every((a) => a.job_id === jobA)).toBe(true);
    expect(data?.find((a) => a.candidate_name === "Sara Khan")?.cv_text).toContain("Power BI");
  });

  it("job-scoped retrieval never leaks another job's CV chunks", async () => {
    const repo = new SupabaseRecruitmentRepo(hr, jobA);
    const roster = await repo.listCandidates();
    expect(roster.map((r) => r.name).sort()).toEqual(["Ahmed Ali", "Sara Khan"]);
    const embedding = llm ? (await llm.embed(["UNIQUEJOBBTOKEN Python SQL"]))[0] : null;
    const hits = await repo.searchChunks({ query: "UNIQUEJOBBTOKEN Python SQL", embedding, limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.application_id !== appIds.other)).toBe(true);
    expect(hits.some((h) => h.content.includes("UNIQUEJOBBTOKEN"))).toBe(false);
    const docs = await repo.getDocuments([appIds.other]);
    expect(docs).toEqual([]);
  });

  it("persists chat sessions/messages per HR user and hides them from others", async () => {
    const { data: me } = await hr.auth.getUser();
    const store = supabaseChatStore(hr, me.user!.id);
    const s = await store.createSession(jobA, "Integration chat");
    await store.addMessage(s.id, { role: "user", content: "Compare all candidates" });
    await store.addMessage(s.id, { role: "assistant", content: "Sara first.", metadata: { candidate_ids: [appIds.sara] } });
    const msgs = await store.listMessages(s.id, 10);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await store.getSession(s.id, jobB)).toBeNull(); // wrong job
    const { data: theirs } = await outsider.from("chat_messages").select("id").eq("session_id", s.id);
    expect(theirs ?? []).toEqual([]);
  });

  it("deleting an application removes the file, row and AI chunks", async () => {
    const { data: row } = await admin.from("applications").select("cv_storage_path").eq("id", appIds.ahmed).single();
    const res = await deleteApplicationData(appIds.ahmed, deletionDeps(hr));
    expect(res.deleted).toBe(true);
    expect((await admin.from("applications").select("id").eq("id", appIds.ahmed)).data).toEqual([]);
    expect((await admin.from("cv_chunks").select("id").eq("application_id", appIds.ahmed)).data).toEqual([]);
    const dl = await admin.storage.from("cvs").download(row!.cv_storage_path);
    expect(dl.data).toBeNull();
  });
});
