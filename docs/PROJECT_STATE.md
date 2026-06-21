# PROJECT_STATE.md

> **⚡ UPDATE 2026-06-21 — FIRST MP4 RENDERED; Redis SOLVED. (Supersedes the 2026-06-20 body below.)**
> `origin/main` = **`01fa671`** (Track B UI + Video-V1 Tasks 1–3,5 + 360s seedance timeout; Vercel + worker both deployed). **Redis split-brain FIXED** via shared **Upstash** `rediss://default:<token>@pet-lamb-125717.upstash.io:6379` set on BOTH Vercel Production + Railway worker. Full pipeline proven end-to-end: render `234a069e-c02b-4614-9a17-f3f52f0ac2b0` → 4/4 Seedance scenes → R2 → ffmpeg-compose (no OOM) → **`ffmpeg-v2.mp4` (14,509,357 B) exists in R2 bucket `ottoflow-videos`** (verified via S3 API); `merge_status=done`, `merged_video_url` populated.
> **🔴 ONE OPEN BLOCKER:** the R2 **public URL doesn't serve** — `R2_PUBLIC_BASE_URL=https://pub-3e67736a889849bab6c5fde844f9521a.r2.dev` is a dead/disabled per-bucket dev URL (DNS-unresolvable; browser error page). Objects exist; no public endpoint. **Fix:** operator enables R2 Public Development URL (or custom domain) on `ottoflow-videos` in Cloudflare → set `R2_PUBLIC_BASE_URL` on worker+Vercel → rewrite the stored `merged_video_url` base (or re-render) → prove HTTP 200. No code change (`r2.ts` correct). Full detail + access/creds/test-data in [SESSION_RESTART_PROMPT.md](SESSION_RESTART_PROMPT.md).
> **🔁 Rotate:** Railway token · AtlasCloud key · Upstash token · **R2 secret key** (leaked in a var dump).


**App:** Ottoflow AI — Next.js 15 SaaS "AI Content Operating System" (`ottoflow-ai/` in the `tiktok-product-video-factory` monorepo). **Date:** 2026-06-20.
**Prod:** https://ottoflow-ai.vercel.app · Vercel (web/API) · BullMQ worker on Railway (`ottoflow-video-hub`) · Supabase (Postgres+Storage+Realtime) · Clerk auth · Cloudflare R2 (renders) · Google Gemini/Imagen · **AtlasCloud** (Seedance 2.0 video).
Companions: [ARCHITECTURE](ARCHITECTURE.md) · [DECISIONS](DECISIONS.md) · [OPEN_TASKS](OPEN_TASKS.md) · [DEPLOYMENT](DEPLOYMENT.md) · [SESSION_RESTART_PROMPT](SESSION_RESTART_PROMPT.md).
**⚠️ Authoritative docs = ONLY these 6.** `docs/` holds ~60 older files (ADR-00x, `*_AUDIT`, `BETA_*`, `RC1_*`, `VIDEO_*`, etc.) that predate today and **contradict current truth** — treat as historical, not current.

## Current truth
`origin/main` = **`564ffd3`** — Vercel prod AND Railway worker both deployed on it (verified: worker RUNNING/SUCCESS). **Migrations 001–028 applied.**

**LIVE (always on):** full content+creative intelligence loop — research→evidence (pgvector RRF)→opportunity mining→content gen→creative brief→approval gate→Imagen bg→deterministic sharp composite→review→manual publish→metrics→recommendations. Palette-driven; deterministic gradient fallback. Imagen `imagen-4.0-fast-generate-001`, Gemini `gemini-2.5-flash`.

**MERGED, flag-gated:**
- **Video V1 (AtlasCloud Seedance 2.0 → R2 → FFmpeg)** — `VIDEO_RENDER_ENABLED=true` NOW SET on **both** worker + Vercel. Route `/api/video/generate` live.
- **Publishing + Integrations** — still DARK (`PUBLISHING_ENABLED` unset → `/api/publish` 404).

## ⚠️ Active milestone: Video V1 first MP4 — T0 PASS, T1 BLOCKED
Goal: Topic → Gemini Strategy → AtlasCloud → R2 → FFmpeg → MP4.
- **T0 (dryRun) = PASS** (verified live, HTTP 200, 14s): strategy (4-beat problem→tension→solution→outcome) + scenePlan[4] + compositionPlan + estimate (provider=`seedance`, $0.10/s, 4×5s=20s ≈ **$2.00/video**).
- **T1 (approve) = BLOCKED** by the one open blocker below. `render_job` created (HTTP 202) but **never reaches the worker** → 0 `scene_generations`, no AtlasCloud call, **$0 spent**.

### 🔴 THE BLOCKER — Vercel↔worker Redis transport broken
- Worker consumes BullMQ from `redis://redis.railway.internal:6379` (Railway-internal, **no auth, no public TCP proxy**, reachable only inside Railway).
- Vercel `REDIS_URL = ""` (empty string). BullMQ `.add()` buffers offline + silently no-ops → route returns 202 but no job is enqueued.
- They do **not** share a reachable Redis. **Fix (operator, pick one):**
  - **A (recommended):** provision a shared **Upstash** Redis; set the same `rediss://…` `REDIS_URL` on **both** Vercel (Production) + worker; redeploy both.
  - **B:** enable Railway TCP proxy on the `redis` service **and add a password** (currently unauthenticated — do NOT expose without auth); set Vercel `REDIS_URL` to the public `redis://…@host:port`. Worker keeps internal URL (same instance).
- After fix: redeploy Vercel → re-run T1. Worker/key/R2 already proven-ready, so it should pass straight through.

## What got done this session (564ffd3)
1. **AtlasCloud provider deployed** (`seedance.ts` BytePlus→AtlasCloud; commit on main).
2. **`branding.ts` lazy-loads `sharp`** — fixed a hard import-time 500 (`Could not load the sharp module`) that crashed `/api/video/generate` on Vercel (the route transitively imports sharp via orchestrator→agent11→branding). sharp now imported lazily inside `renderCtaCard` (worker-only). This unblocked T0.
3. **Worker env set:** `ATLASCLOUD_API_KEY` (operator-authorized), `VIDEO_RENDER_ENABLED=true` → boot log flipped `scene-generation disabled`→**`registered`**, `sceneGenAvailable=true`. R2 vars present (`R2_BUCKET=ottoflow-videos`, `R2_ACCOUNT_ID=4b53de9208a4ecc628a9bad59b2272e4`).
4. **Vercel env set:** `VIDEO_RENDER_ENABLED=true` (18 prod vars now). Note: `vercel redeploy` reuses the old env snapshot — a **fresh git deploy** is required to pick up new env vars.

## Test data (verified, for T1 retry)
- brand **Basecamp** `b1384434-3666-45cc-96d9-ca764e90cdc3` · content_item `4742f075-f48a-43a1-a547-00816ef816eb` (latest creative_brief has `visual_tension`+`visual_metaphor`; owned by the test user).
- Clerk userId (test operator) `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`.
- Stuck test `render_job` `e6ffb1b5-ca1d-4106-912f-e644ab663086` (queued, harmless — delete whenever).

## Infra IDs
- **Prod SHA:** `564ffd353b615da9ab2918e553c6b5d3395e852a`
- **Vercel:** project `ottoflow-ai` `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3` · team `team_MrIWWj7J9L2KLG58IRFcnDK7` · `ottoflow-ai.vercel.app`. (`vercel` CLI authed `joseph-8605`.)
- **Railway:** project `ottoflow-worker` `f14c8abf-4199-451a-8f06-47bb41785c8c` · service `ottoflow-video-hub` `86818e11-ba0a-4dbb-a685-b98d38c1d1eb` · env `production` · repo `josephottoflow/ottoflow-ai` branch `main`. CLI needs a **project token** (UUID) via `RAILWAY_TOKEN`.
- **Supabase prod:** `ddozknywcdpyfdokmfrp`.

## Hard constraints / gotchas
- **No staging** — `ddoz` is live prod. **DDL via Supabase dashboard SQL editor** (no CLI/token).
- **Supabase MCP can't reach `ddoz`** (permission denied; only sees INACTIVE `avymp`). Query prod DB via the **authenticated browser** (Clerk `getToken()` + publishable key, see OPEN_TASKS) or the dashboard.
- **`/api/video/generate` is Clerk-protected** — middleware `auth.protect()` returns `notFound()` (404) for ALL unauthenticated requests, so T0/T1 cannot be run headless; they need a logged-in browser session.
- **sharp must never load at import time on Vercel** — keep it lazy/worker-only.
- **`vercel redeploy` does NOT re-resolve new env vars** — use a fresh git deploy.
- **Worker `scene-generation` is NOT recovered from DB** — a stuck render_job won't self-heal; only the Vercel enqueue feeds it.
- **Assistant never places secrets** unless the operator explicitly authorizes per-secret.

## Open risks / debt (priority order)
1. **🔴 Vercel↔worker Redis transport** (above) — blocks T1 = the milestone.
2. **🔴 P0-A Clerk DEV→prod keys** (operator-gated; gates public launch). Live instance = DEV `pk_test_…pro-beetle-20.clerk.accounts.dev`. Migrating changes the token issuer → update Supabase Third-Party Auth + re-key rows.
3. **🟠 Secret rotation** — Google Sheet plaintext secrets; ElevenLabs key in monorepo `.mcp.json`; **and this session a Railway project token + the AtlasCloud API key were pasted in chat → rotate both.**
4. **🟡 Observability** — worker `SENTRY_DSN` unset; **Railway Redis has no auth.**
5. **🟡** Worker **2 GB RAM** needed before T3 (FFmpeg compose OOMs at 1 GB). T1/T2 are light.

## Resume pointer
Set a shared `REDIS_URL` (Upstash, both surfaces) → redeploy Vercel → re-run T1 from a logged-in browser against the Basecamp test data → verify `scene_generations.storage_url` is a `…r2.dev` URL. Full steps in [OPEN_TASKS.md](OPEN_TASKS.md) and [SESSION_RESTART_PROMPT.md](SESSION_RESTART_PROMPT.md).
