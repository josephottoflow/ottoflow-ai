# DEPLOYMENT.md

Env + deploy truth. Topology in [ARCHITECTURE](ARCHITECTURE.md). Boot env validated (fail-loud); integration/publishing/video vars are lazy (read on use).

Hosts: **Vercel** (app) · **Railway** (worker `ottoflow-video-hub` + `redis`) · **Supabase** `ddozknywcdpyfdokmfrp` · **Clerk** · **Cloudflare R2** · **Google AI** · **AtlasCloud**.
Prod SHA **`564ffd3`** (Vercel + worker both on it). Vercel project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3` / team `team_MrIWWj7J9L2KLG58IRFcnDK7` / `ottoflow-ai.vercel.app`. Railway project `f14c8abf-…` / service `86818e11-…`. `vercel` CLI authed (`joseph-8605`); Railway CLI needs a **project token** (UUID) via `RAILWAY_TOKEN`.

## Environment variables

### App — Vercel (boot-validated in `src/lib/env.ts`) — 18 prod vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable `sb_publishable_…`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (build-inlined) · `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`, R2 trio, `VIDEO_RENDER_ENABLED=true`, Sentry, Pexels/Jamendo/ElevenLabs.
- ⚠️ **`REDIS_URL` is EMPTY** on Vercel → enqueues to `/api/video/generate` never reach the worker. MUST be set to a Redis reachable from Vercel that the **worker also uses** (see Redis below). `env.ts` doesn't currently fail on empty — add a guard.
- ⚠️ **`vercel redeploy` reuses the prior deployment's env snapshot.** After adding/changing any Vercel env var, trigger a **fresh git deploy** (push to `main`) — redeploy/promote/alias-set will NOT pick it up.

### Worker — Railway `ottoflow-video-hub` (boot-validated in `src/lib/worker-env.ts`)
**Required (all set):** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`. Optional: `GEMINI_MODEL`, `WORKER_CONCURRENCY` (1), `LOG_LEVEL`, `SENTRY_DSN` (**unset — set it**). No Clerk vars. **2 GB RAM** for video (currently lower → FFmpeg OOM at T3; T1/T2 light).
- **R2 (set):** `R2_ACCOUNT_ID=4b53de9208a4ecc628a9bad59b2272e4`, `R2_BUCKET=ottoflow-videos`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_PUBLIC_BASE_URL` present. `isR2Configured()`=true. (Before trusting a T1 storage_url, confirm `R2_PUBLIC_BASE_URL` maps to the `ottoflow-videos` bucket.)
- **AtlasCloud (set):** `ATLASCLOUD_API_KEY` set (operator-authorized, 2026-06-20). Optional `ATLASCLOUD_BASE_URL` (def `https://api.atlascloud.ai`), `ATLASCLOUD_MODEL` (def `bytedance/seedance-2.0/text-to-video`), `ATLASCLOUD_USER_AGENT` (def browser UA), `ATLASCLOUD_RESOLUTION` (def `720p`). `SEEDANCE_*` accepted as fallback.
- **`VIDEO_RENDER_ENABLED=true` (set):** boot log shows `scene-generation registered`, `sceneGenAvailable=true`.

### Redis (broker for BullMQ) — ⚠️ MISCONFIGURED
- `redis` service on Railway: `redis://redis.railway.internal:6379` — **internal-only, no auth (`REDIS_PASSWORD` absent), no TCP proxy (`RAILWAY_TCP_PROXY_PORT` absent)**; public domain `redis-production-882e.up.railway.app` has no reachable port.
- Worker uses the internal URL (works). **Vercel cannot reach it and its `REDIS_URL` is empty** → split. Fix: one shared Redis on both surfaces. **Option A (recommended):** Upstash `rediss://…` on Vercel + worker. **Option B:** enable Railway TCP proxy + add a password, set Vercel to the public `redis://…@host:port`.

### Phase 3 Integrations + Publishing (lazy; set on **Vercel AND worker**)
`INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`, identical) · `GOOGLE_OAUTH_*` / `LINKEDIN_OAUTH_*`+`LINKEDIN_API_VERSION` / `META_OAUTH_*`+`META_GRAPH_VERSION` · `PUBLISHING_ENABLED=true` · `ADMIN_EMAILS` (Vercel; gates `/api/publish/health`+`/api/debug/*`). Redirect URIs `…/api/integrations/{google_drive|linkedin|meta}/callback`.

## Release flow (deploy-from-`main`)
```
git push origin HEAD:main
 ├─► Vercel  — app  ~2-4 min → READY (a GIT push re-resolves env; verify via vercel CLI)
 └─► Railway — worker+redis ~3-6 min (verify ACTIVE = new commit + boot log
              `worker started`, `redis.ready`, `scene-generation registered`, no `[worker-env]`)
```
Gates before push: `npx tsc --noEmit` (ignore git-ignored `scripts/phase2a-acceptance.local.ts`) + `npm run build:worker`.
**Setting a Railway env var auto-triggers a worker redeploy.** Verify SHA + boot log via `railway status --json` / `railway logs -s ottoflow-video-hub` (needs `RAILWAY_TOKEN`).

## Migration workflow
Files `supabase/migrations/0NN_<name>.sql`, numeric order, Supabase dashboard SQL editor (no CLI/token). Migrate BEFORE pushing code that writes new columns. **Applied: 001–028.**

## Flag-flip procedure
Set the flag on **both** Vercel and worker (**worker first**), redeploy, verify boot log flips to `registered`. Rollback = unset (no code change). Never one surface only.

## Verifying flag/route state (gotcha)
Unauthenticated `curl` of `/api/video/generate` ALWAYS returns 404 (Clerk middleware `auth.protect()`), regardless of flag — NOT a valid probe. Verify env via `vercel env ls` / `railway variables`, and behavior via a **logged-in browser** `fetch`. Vercel *deployment URLs* (`ottoflow-xxxx.vercel.app`) are SSO-protected (401 = Vercel auth, not the app); only the production alias reflects real app behavior.

## Local dev
Repo `D:\tiktok-product-video-factory\ottoflow-ai`. `npm run dev` (:3000) · `npm run dev:worker` (`tsx watch`) · `npm run build` · `npm run build:worker` (esbuild → `worker/dist/index.js`) · `npm run start:worker`. No `test` script.

## Rollback
- **Code:** `git revert <sha>` + push (never force-push main); Vercel Instant Rollback; Railway History → Redeploy.
- **Migrations:** never rolled back (additive).
- **Feature kill-switch:** unset `VIDEO_RENDER_ENABLED` / `PUBLISHING_ENABLED`.

## Troubleshooting
- **Video route 500 empty body** — a module fails to import (e.g. sharp at top-level); check Vercel runtime logs for `Could not load the … module`.
- **Video 202 but no render / job stuck `queued`, 0 `scene_generations`** — Redis split (Vercel `REDIS_URL` empty / not shared with worker). THE current blocker.
- **Video 404** — `VIDEO_RENDER_ENABLED` unset, OR unauthenticated request (middleware).
- **Worker crash-loop** — `[worker-env]` validation (missing required vars). (`railway status --json`, `railway logs`.)
- **Publish does nothing** — `PUBLISHING_ENABLED` unset / worker not redeployed / `INTEGRATIONS_ENC_KEY` differs app↔worker.
