# DEPLOYMENT.md

Environment + deploy/operational truth for Ottoflow AI. Topology and design decisions live in [ARCHITECTURE.md](ARCHITECTURE.md) / [DECISIONS.md](DECISIONS.md); this doc is env vars, per-platform setup, and the release/migration/rollback procedures.

Hosts: **Vercel** (Next.js app) · **Railway** (BullMQ worker + Redis) · **Supabase** (Postgres+Storage+Realtime) · **Clerk** (auth) · **Google AI** (Gemini/Imagen). All env is validated at boot — missing/malformed values fail loud, no silent fallbacks.

## Environment variables

### Next.js app — Vercel (`src/lib/env.ts`)
| Variable | Req | Scope | For |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | browser+server | Supabase REST endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | browser+server | public publishable key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | browser+server | Clerk publishable (`pk_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | server | bypasses RLS in route handlers |
| `CLERK_SECRET_KEY` | ✅ | server | Clerk server SDK (`sk_…`) |
| `REDIS_URL` | ✅ | server | BullMQ enqueue |
| `GOOGLE_API_KEY` | ✅¹ | server | synchronous Gemini calls (creative brief/concept composition runs on Vercel) |
| `GEMINI_MODEL` | opt | server | default `gemini-2.5-flash` |
| `NEXT_PUBLIC_CLERK_{SIGN_IN,SIGN_UP,AFTER_SIGN_IN,AFTER_SIGN_UP}_URL` | opt | browser | default `/sign-in`,`/sign-up`,`/`,`/` |

> `NEXT_PUBLIC_*` are inlined into the client bundle at **build** time — must be present when Vercel builds, and changing them requires a redeploy.
>
> ¹ `GOOGLE_API_KEY` is **not** boot-validated by `env.ts` — `gemini.ts` reads it directly and throws `GOOGLE_API_KEY is not set` at call time. It must be set on Vercel for creative brief/concept composition to work.

### Worker — Railway (`src/lib/worker-env.ts`)
| Variable | Req | For |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | admin client target |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | RLS-bypass writes |
| `REDIS_URL` | ✅ | BullMQ consume |
| `GOOGLE_API_KEY` | ✅ | Gemini + Imagen |
| `GEMINI_MODEL` | opt | default `gemini-2.5-flash` |
| `GEMINI_TIMEOUT_MS` | opt | per-call timeout, default `90000` |
| `WORKER_CONCURRENCY` | opt | jobs/process, default `2` |
| `LOG_LEVEL` | opt | trace…fatal, default `info` |

> Worker needs **no** Clerk vars or anon key — no user session, never goes through RLS.

### Validation flow
Boot → dotenv loads `.env.local`/`.env` (no-op on platforms) → `env.ts`/`worker-env.ts` parse `process.env` via zod → on failure throw listing offending vars + exit non-zero → on success modules read `process.env` directly. **Build-phase tolerance:** `env.ts` detects `NEXT_PHASE==="phase-production-build"` and substitutes `build-placeholder-…-do-not-use-at-runtime` for missing *server-only* vars (public vars are still required — they're inlined). Seeing a placeholder in a request log = runtime env wasn't injected on the host.

## Per-platform setup (first deploy)
1. **Supabase** — create project; **Settings→API** copy URL + anon + service_role + **JWT Secret**; **SQL Editor** run `supabase/migrations/*` in numeric order (001 → latest); Realtime enabled by migration 002, verify **Database→Replication**.
2. **Clerk** — create app; copy keys; **JWT Templates→New**: name `supabase` (exact), HS256, signing key = Supabase JWT Secret, claims `{"aud":"authenticated","role":"authenticated"}`; paths `/sign-in`,`/sign-up`,after-`/`.
3. **Redis (Upstash)** — create DB near Vercel region; TLS URL `rediss://default:<pw>@<host>.upstash.io:<port>`.
4. **Google AI** — `aistudio.google.com/app/apikey`; Brand Research grounding (URL Context + Google Search) is billed with generation tokens.
5. **Railway** — root dir `ottoflow-ai`; build `npm install`; start `npm run start:worker`; set every ✅ worker var; restart ON_FAILURE; replicas 1 (BullMQ coordinates ownership via Redis, scale-out safe). Worker also needs the 2 GB RAM tier for video render (Hobby).
6. **Vercel** — import repo; root dir `ottoflow-ai`; framework Next.js; set every ✅ app var to Production+Preview+Development; Node 20.x/22.x.

## Release flow
```
git push origin feat/ffmpeg-multi-agent-pipeline && git push origin HEAD:main
 ├─► Vercel  — app          ~2-4 min → READY (verify via API: state READY + SHA)
 └─► Railway — worker+Redis ~5-15 min (verify card ACTIVE = new commit msg +
                            "Deployment successful" BEFORE functional tests —
                            a job picked up mid-swap runs on the OLD worker)
```
⚠️ Every push to main triggers a Railway build (burns credits) — batch doc-only changes with feature pushes while metered. Local gates before push: `npx tsc --noEmit` (ignore the 2 known untracked-script errors) + `npm run build:worker`. Local `next build` fails at env collection (expected — no NEXT_PUBLIC_* locally).

## Migration workflow
**Interim (current):** Supabase dashboard SQL editor — paste file → Run (`monaco.editor.getEditors()[0].setValue(sql)` + Ctrl+Enter); the "destructive operation" modal is expected when the only DROPs are `DROP …IF EXISTS` idempotency guards → confirm. **Target (after ACCESS.md CLI setup):** `npx supabase db push`. **Break-glass:** node + `pg` against `SUPABASE_DB_URL`.

Rules (learned in prod):
1. Migrations are idempotent (`IF NOT EXISTS`/`OR REPLACE`/guarded `DO`) and additive-only.
2. **Migrate BEFORE pushing whenever code WRITES new columns/values** (e.g. 019 `creative_branding`, 014 `in_review`, 010 brand finalize). Exception: purely additive columns nothing existing writes — code-first is safe; only the new feature fails until the migration lands.
3. Verify schema without the dashboard: anon-key REST probe `GET /rest/v1/<table>?select=<col>&limit=1` → 200 exists · PGRST205 no table · 42703 no column; RPC missing = PGRST202.

## Rollback
- **Code:** `git revert <sha>` + push (never force-push main); Vercel offers instant rollback to a prior deployment; Railway: deployment History → Redeploy.
- **Migrations:** never rolled back (additive-only) — unused columns are inert; reverting code suffices.

## Known platform behaviors
- Supabase dashboard can hard-fail (assets 200, zero API calls, blank body) — the reason ACCESS.md CLI/token setup matters.
- Supabase Realtime unreliable on content tables → those UIs use ~2.5s polling fallbacks.
- sharp's native binary doesn't reliably load on Vercel → the brand-assets upload route validates by magic bytes and reads dimensions via a lazy, non-fatal `await import("sharp")`; the Railway worker runs sharp fine. See [DECISIONS.md](DECISIONS.md).

## Troubleshooting
- **"Environment validation failed" at startup** — read the error; it names each missing/malformed var.
- **"Server env X accessed in the browser"** — a client component imports a server-only module; move behind a server file or `"use server"`.
- **Build succeeds but every API route 500s** — runtime env not injected; check Vercel env "Available to: Production".
- **Worker starts then stops** — almost always env validation; look for `[worker-env]` in Railway logs.
- **Worker jobs never run / paused** — check the Railway plan (a maxed Trial pauses all services); see [PROJECT_STATE.md](PROJECT_STATE.md).
- **Realtime updates don't arrive** — check browser console `[supabase-provider] realtime auth refresh failed`; the `supabase` JWT template exists + signed with the Supabase JWT secret; the table is in the `supabase_realtime` publication.

Companion: [ACCESS.md](ACCESS.md) (credentials/access matrix) · [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (codified release order).
