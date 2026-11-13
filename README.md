# Recruitment AI Assistant

A simple, secure recruitment website with two interfaces:

1. **Candidate Portal** (public): browse open jobs, apply with name, email, phone and a CV (PDF/DOCX). No account is needed.
2. **HR Dashboard** (`/hr`, login required): manage job openings, review applicants and original CVs, and use the
   **AI Recruitment Assistant**. The assistant is a chatbot for each job that works from that job's uploaded CVs.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS 4 + shadcn/ui-style components, Supabase (Postgres, Auth, private
Storage, pgvector) and the OpenAI API (chat + embeddings).

---

## Contents

- [Quick start](#quick-start)
- [Configure Supabase](#configure-supabase)
- [Configure OpenAI](#configure-openai)
- [Create the first HR account](#create-the-first-hr-account)
- [Run, test, build](#run-test-build)
- [Deploy (Vercel)](#deploy-vercel)
- [How the AI assistant works](#how-the-ai-assistant-works)
- [Security & privacy](#security--privacy)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run dev                     # http://localhost:3000
```

Without Supabase configured, the site starts and shows a clear "not configured" message. It never shows fake data.

## Configure Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Apply the migration**. It creates the tables, RLS policies, the private `cvs` bucket, pgvector search and rate limiting.
   Use one of these options:
   - **SQL editor:** paste the contents of `supabase/migrations/20261113000000_init.sql` and run it.
   - **Supabase CLI:**
     ```bash
     npx supabase init          # once; keeps the existing supabase/migrations folder
     npx supabase link --project-ref YOUR-PROJECT-REF
     npx supabase db push
     ```
3. **Disable public sign-ups:** go to Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
   Keep Email/password enabled. (Even if someone does create an account, they get no access without an active `hr_users` row.)
4. In Authentication → URL Configuration, set the **Site URL** to your app URL (needed for invite emails).
5. Copy these from Project Settings → API into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon / publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`: the service-role / secret key. This is **server only**; never give it a `NEXT_PUBLIC_` prefix.

## Configure OpenAI

Set `OPENAI_API_KEY` in `.env.local`. These are optional:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_CHAT_MODEL` | `gpt-5.4-mini` | Any chat-completions model that supports tools and structured outputs |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Must produce 1536-dim vectors (requested via `dimensions`) |

If OpenAI is not configured:
- CVs are still uploaded, stored and text-extracted. Keyword chunks are created, and HR sees "AI indexing pending" with a
  **Retry processing** button.
- The chatbot replies with a clear "not configured" message. It never gives a simulated answer.

## Create the first HR account

HR accounts can only be created by an administrator who has the service-role key:

```bash
npm run hr:create -- --email hr.admin@yourcompany.com --password "a-long-unique-password" --role admin --name "HR Admin"
```

Options:
- `--role recruiter`: a recruiter can do everything **except delete applications** (admin only).
- `--invite`: sends a Supabase invite email instead of setting a password.
- `--deactivate`: revokes HR access. The user is signed out of HR on their next request.

Then sign in at `/hr/login`.

## Run, test, build

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (offline: real PDF/DOCX parsing, **mocked** LLM and in-memory DB) |
| `npm run test:integration` | **Real** Supabase + OpenAI tests (see below) |
| `npm run build` / `npm start` | Production build / server |
| `npm run retention:purge` | Triggers the retention job on a running deployment |

### What the tests cover (and how)

**Unit tests (`tests/unit`, 69 tests).** These run offline. The LLM is a scripted **mock** and the database is an
in-memory fake. They check *our* logic:

- HR authorization: every `/api/hr/*` endpoint returns 401 without a session and 403 for non-HR users. The middleware
  redirects HR pages to `/hr/login`. Only admins can delete. Cross-origin writes are rejected.
- Job input validation and slugs. Public submission: correct job association, closed or unknown jobs, consent, rate
  limit, honeypot, and no orphaned files.
- Real **PDF and DOCX extraction** (files generated with pdf-lib / docx). File checks reject invalid types, renamed
  files, oversized files, truncated PDFs, PDFs with JavaScript actions, macros and zip bombs.
- The CV pipeline: ready, failed and not-configured cases. The model is **never called** when there is no readable text.
- The assistant:
  - It resolves candidate identity from the DB roster, including possessives, accents and ambiguous names.
  - It evaluates individual candidates and compares several candidates.
  - It covers the **full applicant pool**: 23 candidates in batches, with a retry for a candidate the model omitted,
    unreadable CVs reported, and verification of evidence quotes.
  - It searches by exhaustive term checks.
  - Its **job-scoped retrieval** cannot leak CVs across jobs.
  - It neutralises prompt-injection text in CVs and validates citations.
  - It keeps context for follow-ups and handles AI failures.
- Chat persistence and error messages. Application deletion removes the file, the row, and chat evidence.

**Integration tests (`tests/integration`).** These are skipped unless `RUN_INTEGRATION=1` and credentials are set.
They run against the **real** services and create and delete their own fictional data:

- `supabase.int.test.ts`: RLS for anon, non-HR and HR users, private storage, job-scoped `search_cv_chunks`, chat
  persistence and ownership, and deletion cleanup.
- `openai.int.test.ts`: real embeddings, real profile extraction (checks that no qualifications are invented), a real
  "compare all three" answer followed by a follow-up, and an invalid-key error.

```bash
# PowerShell
$env:RUN_INTEGRATION="1"; npm run test:integration
# bash
RUN_INTEGRATION=1 npm run test:integration
```

> Status in the delivered build: unit tests, typecheck and `next build` pass. The integration tests have **not** been run
> yet, because no Supabase project or OpenAI key was available while building. Run them after configuring `.env.local`.

### End-to-end acceptance scenario (manual)

1. Sign in at `/hr/login` and go to **Job Openings → New job**. Title: "Data Analyst". Required skills: Python, SQL,
   Power BI, data analysis experience.
2. Click **Copy link** (`/jobs/data-analyst`) and submit 3 fictional CVs through that link.
3. Open the job. The three applicants are listed with the status **AI ready**. Open each original CV (60-second signed link).
4. Click **AI Assistant** and ask: *"Compare all three candidates and recommend who we should interview first."*
   You get a grounded comparison with clickable `[E#]` CV evidence and a coverage footnote ("3 of 3 applicants assessed").
5. Ask: *"Generate interview questions for the strongest candidate."* The assistant continues in the same conversation.

## Deploy (Vercel)

1. Push the repo to GitHub and import it in Vercel.
2. Add all variables from `.env.example` in Project → Settings → Environment Variables:
   - Set `NEXT_PUBLIC_SITE_URL` to the production URL.
   - Set `CRON_SECRET` to a long random string.
3. Deploy. `vercel.json` schedules `/api/cron/retention` daily at 03:00 UTC. Vercel sends the `CRON_SECRET` bearer token.
4. Notes:
   - The chat route sets `maxDuration = 300`. On plans with a lower limit, Vercel caps it.
   - Full-pool reviews of very large pools take longer.
   - Vercel limits request bodies to 4.5 MB, so keep `MAX_CV_SIZE_MB` at 4 or less.

Any Node.js host works too: run `npm run build && npm start`, and schedule the retention endpoint with any cron
(`npm run retention:purge -- https://your-host`).

## How the AI assistant works

```
HR message ─▶ load job + FULL applicant roster from DB (job-scoped)
           ─▶ resolve names mentioned in the message against roster records (exact / token / prefix; ambiguity flagged)
           ─▶ pool-wide request?  ≤10 applicants → read every CV;  >10 → batched review of every applicant
           ─▶ model + tools (all job-scoped, IDs validated against the roster):
                resolve_candidates · get_candidate_details · search_cvs (pgvector + full-text, RRF)
                check_terms (exhaustive keyword check of every CV) · review_all_applicants (batched, structured)
           ─▶ answer with [E#] citations → citations validated, evidence stored with the message
           ─▶ coverage footnote written by the server (not the model)
```

- **Indexing at upload:** the server validates the file, stores it privately, and creates the DB row. In the
  background it then extracts text, creates around 1,000-character chunks, makes `text-embedding-3-small` embeddings,
  and extracts a structured factual profile. **No evaluation or ranking happens at submission.**
- **Grounding rules:** the assistant may not invent facts. It must separate *not mentioned* from *contradicted*. It
  ignores protected characteristics and uses no numeric scores. Its recommendations are for human review only.
- **Identity:** candidates are always identified through database records, never by semantic similarity alone.
- **Full-pool coverage:** `review_all_applicants` sends every applicant with readable text through batches of 6. It
  retries any candidate the model leaves out. It reports unreadable CVs and failures by name. It checks each
  evidence quote against the CV text and removes any it cannot verify.
- **Prompt-injection defence:** CV text is wrapped in `<cv_document>` / `<cv_passage>` tags. Spoofed tags are removed,
  and the model is told this content is untrusted data.
- **History:** sessions are stored per HR user and job. Follow-ups receive the earlier turns and the candidates
  discussed in them.

## Security & privacy

- **Auth:**
  - Supabase email/password, with public sign-up disabled. Access needs an active `hr_users` row.
  - Middleware redirects anonymous users away from `/hr/*` and returns 401 on `/api/hr/*`. Every page and route also
    checks HR membership on the server.
- **RLS on every table:**
  - Anonymous users can read only **open** jobs.
  - Applications, CV chunks and chats are visible only to active HR users, and chats only to their owner.
  - HR clients can update only `review_status`, through a column-level grant.
  - Only admins can delete.
- **Storage:**
  - The `cvs` bucket is private and has no storage policies.
  - HR downloads go through `/api/hr/applications/:id/cv`. That route checks HR access and RLS visibility, then
    redirects to a **60-second signed URL**.
  - Storage paths are `jobId/applicationId.ext`. They never contain user input.
- **Uploads:**
  - Size limit, checked on Content-Length and on the file itself. Extension and magic-byte checks.
  - PDF checks: truncation and JavaScript/Launch actions.
  - DOCX checks: structure, macros, entry count, expanded size and compression ratio.
  - Parsing has a timeout and a page limit, and NUL bytes are stripped from the text.
- **Abuse protection:**
  - Database-backed rate limits: uploads 8 per 10 minutes per IP hash; chat 30 per 5 minutes per user; reprocessing
    20 per 5 minutes.
  - A honeypot field catches bots. Same-origin checks on all mutations.
  - All input is validated with zod. All queries are parameterised through PostgREST.
- **Secrets:** the service-role key and the OpenAI key are read only on the server (`server-only` modules). They are
  never exposed to the browser.
- **Consent:** candidates must give explicit consent to AI processing. The time and version of that consent are stored.
- **Deletion and retention:**
  - Deleting an application removes the original file, the row, its text and profile, its chunks and embeddings
    (cascade), and its CV excerpts in chat evidence.
  - `DATA_RETENTION_DAYS` (default 180) controls automatic purging and is shown on `/privacy`.
  - Known limitation: assistant replies are stored as text and may still mention a deleted candidate by name. Delete
    those conversations in the assistant if you need them gone.

## Project structure

```
src/
  middleware.ts                 session refresh + HR gate
  app/
    page.tsx                    public job list
    jobs/[slug]/                job details + apply form
    application/success/        confirmation
    privacy/                    privacy & AI notice
    hr/login/                   HR sign-in
    hr/(app)/                   protected HR area: dashboard, jobs, jobs/new, jobs/[jobId], …/edit,
                                …/applicants/[applicationId], …/chat, assistant
    api/applications            public CV submission
    api/hr/...                  jobs, applications (status/delete/cv/reprocess), chat, sessions
    api/auth/logout, api/cron/retention
  lib/
    ai/        assistant.ts (orchestrator + tools), repo.ts (job-scoped retrieval), names.ts, prompts.ts,
               evidence.ts, openai.ts, llm.ts
    cv/        chunk.ts, process.ts        files/  validate.ts, extract.ts, zip.ts
    applications/ submit.ts, delete.ts     chat/   turn.ts, supabase-store.ts
    supabase/  server.ts, admin.ts, browser.ts
  components/  ui primitives, HR components, chat workspace
supabase/migrations/            schema, RLS, storage, search + rate-limit functions
scripts/                        create-hr-user.mjs, purge-expired.mjs
tests/unit, tests/integration
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Supabase is not configured" | Set the three Supabase variables in `.env.local`, then restart `npm run dev`. |
| Login works but you are sent back with "does not have active HR access" | Run `npm run hr:create` for that email. Check that `hr_users.is_active = true`. |
| Applicant stuck on "Queued" / "Processing" | Background processing was interrupted (for example the server restarted). After 5 minutes a **Retry** button appears. |
| "Needs attention: No readable text" | The CV is probably a scanned image. OCR is not supported. Review the original file manually. |
| "AI indexing failed: OpenAI rejected the API key (401)" | Check `OPENAI_API_KEY`, then click **Retry processing**. |
| "model was not found (404)" | Set `OPENAI_CHAT_MODEL` to a model your OpenAI account can use. |
| Chat says "rate limit or quota exceeded (429)" | Check your OpenAI billing and limits, or wait and resend. |
| `relation "public.jobs" does not exist` | The migration was not applied. See [Configure Supabase](#configure-supabase). |
| Upload fails with 413 on Vercel | Keep `MAX_CV_SIZE_MB` at 4 or less. |
| `function search_cv_chunks … does not exist` | Re-run the migration. It requires the `vector` extension, which the migration enables. |
