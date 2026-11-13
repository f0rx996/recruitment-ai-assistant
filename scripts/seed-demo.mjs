#!/usr/bin/env node
/**
 * Seeds the demo setup for the university project:
 *   - HR admin login (credentials below — fictional, for demo use only)
 *   - "Data Analyst" job (Python, SQL, Power BI, data analysis experience)
 *   - 3 fictional applicants submitted through the public endpoint (needs `npm run dev` running)
 *
 *   npm run seed:demo
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";

config({ path: ".env.local", quiet: true });

export const DEMO_EMAIL = "admin@uni-demo.test";
export const DEMO_PASSWORD = "Recruit-Demo-2026";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// 1. HR admin account
const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
let user = list.users.find((u) => u.email === DEMO_EMAIL);
if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true });
  if (error) throw error;
  user = data.user;
} else {
  await db.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD });
}
const hr = await db
  .from("hr_users")
  .upsert({ user_id: user.id, email: DEMO_EMAIL, role: "admin", full_name: "Demo Admin", is_active: true }, { onConflict: "user_id" });
if (hr.error) throw hr.error;
console.log(`HR login ready: ${DEMO_EMAIL}`);

// 2. Data Analyst job
let { data: job } = await db.from("jobs").select("id").eq("slug", "data-analyst").maybeSingle();
if (!job) {
  const res = await db
    .from("jobs")
    .insert({
      title: "Data Analyst",
      slug: "data-analyst",
      summary: "Turn business data into dashboards and insights.",
      description:
        "We are looking for a Data Analyst to analyse sales and operations data, build Power BI dashboards and automate reporting for business stakeholders.",
      required_skills: ["Python", "SQL", "Power BI", "Data analysis experience"],
      preferred_skills: ["Statistics", "Stakeholder communication"],
      location: "Remote",
      status: "open",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (res.error) throw res.error;
  job = res.data;
  console.log("Created job: Data Analyst");
} else {
  console.log("Job already exists: Data Analyst");
}

// 3. Sample applicants (only if the job has none yet)
const { count } = await db.from("applications").select("id", { count: "exact", head: true }).eq("job_id", job.id);
if (!count) {
  const r = spawnSync(process.execPath, ["scripts/demo-apply.mjs", job.id, base], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`Could not submit sample CVs. Is the app running at ${base}? Start it with "npm run dev" and run this again.`);
    process.exit(1);
  }
} else {
  console.log(`Job already has ${count} applicant(s); skipping sample CVs.`);
}
console.log(`\nDone. Sign in at ${base}/hr/login (see LOGIN.md).`);
