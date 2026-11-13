#!/usr/bin/env node
/**
 * Creates (or grants access to) an HR account. Run by an administrator only.
 *
 *   npm run hr:create -- --email hr@example.com --password "S3cure-pass!" --role admin --name "Jane Doe"
 *   npm run hr:create -- --email hr@example.com --invite          (sends a Supabase invite email)
 *   npm run hr:create -- --email hr@example.com --deactivate
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local / .env).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const email = String(arg("email") ?? "").trim().toLowerCase();
const password = arg("password");
const role = arg("role") === "recruiter" ? "recruiter" : "admin";
const fullName = typeof arg("name") === "string" ? arg("name") : null;
const invite = arg("invite") === true;
const deactivate = arg("deactivate") === true;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Fill in .env.local first.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Provide a valid --email.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(target) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  if (deactivate) {
    const user = await findUserByEmail(email);
    if (!user) throw new Error("No such user.");
    const { error } = await db.from("hr_users").update({ is_active: false }).eq("user_id", user.id);
    if (error) throw error;
    console.log(`Deactivated HR access for ${email}.`);
    return;
  }

  let user = await findUserByEmail(email);
  if (!user) {
    if (invite) {
      const { data, error } = await db.auth.admin.inviteUserByEmail(email);
      if (error) throw error;
      user = data.user;
      console.log(`Invitation email sent to ${email}.`);
    } else {
      if (typeof password !== "string" || password.length < 10) {
        throw new Error("Provide --password with at least 10 characters (or use --invite).");
      }
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      user = data.user;
      console.log(`Created auth user ${email}.`);
    }
  } else {
    console.log(`Auth user ${email} already exists; granting HR access.`);
    if (typeof password === "string" && password.length >= 10) {
      const { error } = await db.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
      console.log("Password updated.");
    }
  }

  const { error } = await db
    .from("hr_users")
    .upsert({ user_id: user.id, email, role, full_name: fullName, is_active: true }, { onConflict: "user_id" });
  if (error) throw error;
  console.log(`HR access granted: ${email} (role: ${role}). Sign in at /hr/login.`);
}

main().catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
