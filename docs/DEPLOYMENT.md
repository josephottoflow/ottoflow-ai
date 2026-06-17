# DEPLOYMENT.md

Env + deploy/operational truth for Ottoflow AI. Topology/design → [ARCHITECTURE](ARCHITECTURE.md) / [DECISIONS](DECISIONS.md). All env is boot-validated — missing/malformed values fail loud.

Hosts: **Vercel** (Next.js app) · **Railway** (BullMQ worker + Redis, Hobby plan) · **Supabase** (Postgres+Storage+Realtime) · **Clerk** (auth) · **Google AI** (Gemini/Imagen) · **Cloudflare R2** (video renders only).

## Environment variables

### Next.js app — Vercel (`src/lib/env.ts`)
| Variable | Req | For |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase REST + public key (inlined at build) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | ✅ | Clerk (`pk_…`/`sk_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | RLS-bypass in route handlers |
| `REDIS_URL` | ✅ | BullMQ enqueue |
| `GOOGLE_API_KEY` | ✅¹ | synchronous Gemini (brief/concept composition on Vercel) |
| `GEMINI_MODEL` / `NEXT_PUBLIC_CLERK_{SIGN_IN,SIGN_UP,AFTER_*}_URL` | opt | defaults `gemini-2.5-flash` / `/sign-in`,`/sign-up`,`/` |

> `NEXT_PUBLIC_*` are inlined at **build** → must exist when Vercel builds; changing requires redeploy. ¹ `GOOGLE_API_KEY` is not boot-validated by `env.ts`; `gemini.ts` throws at call time if unset.

### Worker — Railway (`src/lib/worker-env.ts`)
| Variable | Req | For |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ | admin client (RLS-bypass writes) |
| `REDIS_URL` | ✅ | BullMQ consume |
| `GOOGLE_API_KEY` | ✅ | Gemini + **Imagen `imagen-4.0-fast-generate-001`** |
| `GEMINI_MODEL` / `GEMINI_TIMEOUT_MS` / `WORKER_CONCURRENCY` / `LOG_LEVEL` | opt | `gemini-2.5-flash` / `90000` / `2` / `info` |
| `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL` | opt¹ | **Video V1** render storage (image path unaffected). ¹**All five MANDATORY for Video V1** — scene-gen durability gate hard-fails without a durable `storage_url` (no Drive fallback). |
| `SEEDANCE_API_KEY` / `SEEDANCE_MODEL` / `SEEDANCE_BASE_URL` | opt | **Video V1** scene gen; absent → registry skips Seedance |

> Worker needs **no** Clerk vars / anon key. Boot validation: dotenv → zod parse → throw+exit on failure → modules read `process.env`. `env.ts` substitutes a placeholder for missing *server-only* vars during `NEXT_PHASE==="phase-production-build"` (public vars still required).

## Branches / current deploy state
- **`main` = `5753f5b`** is production (Vercel app + Railway worker deploy from it). Migrations **001–022 applied to prod; 023 pending**.
- `feat/ffmpeg-multi-agent-pipeline` (HEAD `778bc39`, 12 ahead, **unpushed**): Video V1 + Phase 2A. Do **not** push to main until Video V1 is validated (it ships a live `/api/video/generate` + UI trigger).
- `staging/brand-pattern-2a` (HEAD `2aadf65`, 3 ahead, **unpushed**): Phase 2A only, file-disjoint from Video V1 → safe to merge to main independently. Lacks migration 022 (Video V1) by design.

## Release flow (production)
```
git push origin <branch> && git push origin HEAD:main
 ├─► Vercel  app          ~2-4 min → READY (verify state READY + SHA)
 └─► Railway worker+Redis ~5-15 min (verify card ACTIVE = new commit + "Deployment successful"
                          BEFORE functional tests — a mid-swap job runs on the OLD worker)
```
Every push to main triggers a Railway build (burns credits) — batch doc-only changes. Local gates before push: `npx tsc --noEmit` (ignore the 2 known untracked-script errors) + `npm run build:worker`. Local `next build` fails at env collection (expected).

## Migration workflow
Supabase dashboard SQL editor: paste file → Run (`monaco.editor.getEditors()[0].setValue(sql)` + Ctrl+Enter); the "destructive operation" modal is expected when the only DROPs are idempotency guards → confirm. (No CLI/management token on the machine; break-glass = node + `pg` against `SUPABASE_DB_URL`.) Rules:
1. Migrations are idempotent (`IF NOT EXISTS`/`OR REPLACE`/guarded `DO`) and additive-only.
2. **Apply BEFORE pushing whenever code writes new columns/values** (else routes 500). Purely additive columns nothing writes yet = code-first safe.
3. Verify without the dashboard: anon-key REST probe `GET /rest/v1/<table>?select=<col>&limit=1` → 200 exists · PGRST205 no table · 42703 no column · PGRST202 no RPC.

## Staging (for Phase 2A acceptance test)
No staging env exists. To run the acceptance test, provision a **separate** Supabase + **dedicated** Redis + a worker pointed at `staging/brand-pattern-2a`, apply 001→021→023, seed pilot brands/patterns. Paste-ready artifacts: **`.env.staging.example`** (env template; harness refuses the prod ref `ddozknywcdpyfdokmfrp`) and **`scripts/phase2a-staging-setup.sql`** (3 brands + `brand_colors` + 3 active patterns in one paste). Full runbook + preflight: **PHASE_2A_STAGING_RUNBOOK.md**.

## First-deploy setup (condensed)
**Supabase:** create project → copy URL/anon/service_role/**JWT Secret** → run `supabase/migrations/*` ascending → Realtime on (002). **Clerk:** app + keys + JWT template named `supabase` (HS256, signing key = Supabase JWT Secret, claims `{"aud":"authenticated","role":"authenticated"}`). **Redis (Upstash):** TLS `rediss://…`. **Google AI:** API key (Imagen 4.0 access required). **Railway:** root `ottoflow-ai`, build `npm run build:worker`, start `npm run start:worker`, set ✅ worker vars, replicas 1, **2 GB tier for video render**. **Vercel:** root `ottoflow-ai`, Next.js, set ✅ app vars (Prod+Preview+Dev), Node 20/22.

## Rollback
- **Code:** `git revert <sha>` + push (never force-push main); Vercel instant rollback; Railway History → Redeploy.
- **Migrations:** never rolled back (additive-only) — unused columns inert; reverting code suffices.

## Known platform behaviors
- Supabase dashboard can hard-fail (assets 200, zero API calls, blank body) → use REST probes to verify schema.
- Supabase Realtime unreliable on content tables → those UIs poll ~2.5s.
- sharp native unreliable on Vercel → magic-byte validation + lazy `await import("sharp")`; keep `serverExternalPackages:["sharp"]` + `@img/sharp-linux-x64` lockfile entry. Worker runs sharp fine.

## Troubleshooting
- **"Environment validation failed" at boot** — error names each missing/malformed var (`[worker-env]` in Railway logs).
- **Build OK but every route 500s** — runtime env not injected (check Vercel "Available to: Production").
- **Worker starts then stops** — almost always env validation.
- **Realtime not arriving** — `supabase` JWT template exists + signed with the Supabase JWT secret + table in the `supabase_realtime` publication.
- **All masked video/image renders fall back** (`background_source='fallback'`) — `GOOGLE_API_KEY` lacks Imagen 4.0 access.
