#!/usr/bin/env node
/**
 * Triggers the data-retention job on a running deployment:
 *   npm run retention:purge                      (uses NEXT_PUBLIC_SITE_URL)
 *   npm run retention:purge -- https://your-app.example.com
 * Requires CRON_SECRET.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set.");
  process.exit(1);
}

const res = await fetch(`${base}/api/cron/retention`, { headers: { Authorization: `Bearer ${secret}` } });
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
