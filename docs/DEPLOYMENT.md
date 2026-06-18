# DEPLOYMENT.md

Env + deploy/operational truth. Topology/design in [ARCHITECTURE](ARCHITECTURE.md)/[DECISIONS](DECISIONS.md). All boot env is validated (fail-loud); new integration/publishing vars are lazy (read on use) so prod boots without them.

Hosts: **Vercel** (app) · **Railway** (worker + Redis, Hobby/active) · **Supabase** (Postgres+Storage+Realtime) · **Clerk** (auth) · **Cloudflare R2** (renders) · **Google AI** (Gemini/Imagen).

## Environment variables

### App — Vercel (boot-validated in `src/lib/env.ts`)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (browser+server, inlined at build) · `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL` (server). Optional: `GEMINI_MODEL`, Clerk URL overrides.
`GOOGLE_API_KEY` — **not** boot-validated; `gemini.ts` reads it directly (throws at call time). Required for creative/content gen.

### Worker — Railway (boot-validated in `src/lib/worker-env.ts`)
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`. Optional: `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` (90000), `WORKER_CONCURRENCY` (2), `LOG_LEVEL`. Render needs the **2 GB RAM** tier. Worker needs no Clerk vars.
**R2 (worker):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. Optional `REMOTION_CHROME_EXECUTABLE`, `SENTRY_DSN`.

### Phase 3 Integrations + Publishing (lazy; NOT in env.ts) — set on **Vercel AND worker**
| Var | For |
|---|---|
| `INTEGRATIONS_ENC_KEY` | AES-256-GCM token key (`openssl rand -base64 32`); **identical** app+worker |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | Google Drive OAuth (`drive.file`) |
| `LINKEDIN_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `LINKEDIN_API_VERSION` | LinkedIn connect + publish (`/rest`) |
| `META_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `META_GRAPH_VERSION` (opt) | Meta (FB/IG) |
| `PUBLISHING_ENABLED=true` | gates publish API + worker + scheduler (dark when unset) |
| `PUBLISH_SCHEDULER_LOCK_MS` (25000), `PUBLISH_REAPER_INTERVAL_MS` (300000), `PUBLISH_REAPER_LOCK_MS` (120000), `PUBLISH_ORPHAN_THRESHOLD_MS` (900000) | publish reliability tuning |
| `ADMIN_EMAILS` | comma-list; gates `/api/publish/health` + `/api/debug/*` (fail-closed) |

Redirect URIs resolve via `[provider]`: `…/api/integrations/{google_drive|linkedin|meta}/callback`.

## Release flow
```
git push origin <branch> && git push origin HEAD:main
 ├─► Vercel  — app  ~2-4 min → READY (verify API: state READY + SHA)
 └─► Railway — worker+Redis ~5-15 min (verify ACTIVE deployment = new commit msg +
                            "Deployment successful" BEFORE functional tests)
```
Local gates before push: `npx tsc --noEmit` (ignore the one git-ignored `scripts/phase2a-acceptance.local.ts` error) + `npm run build:worker`. Local `next build` fails type-check only on that same script.

## Migration workflow
Supabase dashboard SQL editor (no CLI/token on the machine): paste file → Run → confirm the "destructive operation" modal (only `DROP …IF EXISTS` idempotency guards). **Migrate BEFORE pushing whenever code WRITES new columns.** Verify without the dashboard: anon REST probe `GET /rest/v1/<table>?select=<col>&limit=1` (200 / PGRST205 no-table / 42703 no-column) or `select to_regclass('public.<table>')`.
- **Prod applied: 001–021.** Pending per branch: 022 (Video V1), 023 (brand_patterns), 024–028 (integrations+publishing). All additive.

## Per-platform first-deploy notes
Supabase: run migrations in numeric order; copy URL/anon/service_role; Realtime via 002. Clerk: third-party-auth (Supabase verifies the Clerk session via JWKS — no JWT template). Redis: Upstash `rediss://…` or Railway Redis. Railway: root `ottoflow-ai`, build `npm run build:worker`, start `npm run start:worker`, replicas 1 (BullMQ + the publish Redis-lock coordinate; scale-out safe). Vercel: root `ottoflow-ai`, Next.js, Node 22.x; Supabase+Clerk vars often via Vercel **integrations** (not always manual env).

## Rollback
- **Code:** `git revert <sha>` + push (never force-push main); Vercel instant rollback to a prior deployment; Railway: History → Redeploy.
- **Migrations:** never rolled back (additive); reverting code suffices. Drop the 024–028 tables only to fully remove Phase 3.
- **Publishing kill-switch:** `PUBLISHING_ENABLED=false` → API 404, worker/scheduler unregistered (no rollback needed).

## Known platform behaviors
- Supabase dashboard can hard-fail (assets load, zero API calls, blank body) — SQL editor unreachable under automation; operator runs DDL manually.
- Supabase Realtime unreliable on content tables → ~2.5s polling fallbacks.
- sharp native binary unreliable on Vercel → upload route validates by magic bytes + lazy `import`; worker runs sharp fine.

## Troubleshooting
- **API routes 500 after deploy** — runtime env not injected; check Vercel env scope.
- **Worker starts then stops** — env validation; look for `[worker-env]` in Railway logs.
- **Publish does nothing** — `PUBLISHING_ENABLED` unset, or worker not redeployed (publish queue unregistered), or migrations 027/028 not applied.
- **LinkedIn publish 403** — missing publish scopes (reconnect) or `LINKEDIN_API_VERSION` unset.
- **Drive/LinkedIn/Meta connect 503** — provider OAuth env not set; **decrypt errors** — `INTEGRATIONS_ENC_KEY` differs app↔worker.
- **Realtime missing** — check the Clerk third-party-auth config + the table's `supabase_realtime` publication.
