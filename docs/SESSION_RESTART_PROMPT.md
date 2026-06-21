# SESSION_RESTART_PROMPT

Paste this to a fresh Claude session to continue immediately.

---

You are continuing work on **Ottoflow AI** — a Next.js 15 SaaS "AI Content Operating System" at `D:\tiktok-product-video-factory\ottoflow-ai` (inside the `tiktok-product-video-factory` monorepo).

**First:** read these 6 docs in `ottoflow-ai/docs/` and treat them as the ONLY source of truth (ignore the ~60 other older `docs/` files — they contradict current state): `PROJECT_STATE.md`, `ARCHITECTURE.md`, `OPEN_TASKS.md`, `DECISIONS.md`, `DEPLOYMENT.md`, this file. Do not re-analyze project history. Verify claims from real state (git / `vercel` CLI / `railway` / DB / logs), never from assertions.

## Where things stand
- `origin/main` = **`564ffd3`**; Vercel prod AND Railway worker both deployed on it. Migrations 001–028 applied.
- The LIVE product (research→content→creative→Imagen→composite→review→metrics→recommendations) works and is untouched.
- **Active milestone = Video V1 first MP4** (Topic → Gemini Strategy → AtlasCloud Seedance 2.0 → R2 → FFmpeg → MP4).
  - **T0 (dryRun) PASSES** end-to-end on Vercel: strategy + scenePlan[4] + compositionPlan + estimate (provider=`seedance`, ~$2.00/video for 4×5s @ $0.10/s). $0 spent so far; $25 AtlasCloud credit funded.
  - **T1 (approve) is BLOCKED** — render_job is created (HTTP 202) but never reaches the worker.

## THE blocker (do this first)
**Vercel and the worker do not share a reachable Redis.**
- Worker consumes BullMQ from `redis://redis.railway.internal:6379` (Railway-internal, **no auth, no public TCP proxy**).
- Vercel `REDIS_URL = ""` (empty) → BullMQ `.add()` buffers offline and silently no-ops; route still returns 202; no job enqueued → worker idle → 0 `scene_generations`.

**Fix (operator picks; involves a secret + security choice — confirm before placing secrets):**
- **A (recommended):** provision an **Upstash** Redis; set the same `rediss://…` `REDIS_URL` on **Vercel Production AND the Railway worker**; redeploy both (Vercel needs a **fresh git deploy** — `vercel redeploy` reuses the old env snapshot).
- **B:** enable Railway's TCP proxy on the `redis` service **and add a password** (do NOT expose the unauthenticated Redis); set Vercel `REDIS_URL` to the public `redis://…@host:port` (worker keeps internal URL, same instance).
- Also add an `src/lib/env.ts` guard so an **empty** `REDIS_URL` fails boot loudly.

## Then prove T1 (Clerk-protected → needs a logged-in browser)
The route requires a Clerk session; `src/middleware.ts` `auth.protect()` returns 404 for ALL unauthenticated requests, so T0/T1 **cannot** run headless. Use the Chrome MCP against the operator's logged-in browser (they must sign in to `ottoflow-ai.vercel.app` first), and run direct `fetch`es in the app console (NOT the `/video/generate` UI page = legacy SSE path).

Test data (verified, owned by the test user `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`):
- brandId `b1384434-3666-45cc-96d9-ca764e90cdc3` (Basecamp) · contentItemId `4742f075-f48a-43a1-a547-00816ef816eb`.
```js
// T1 (~$2): in the logged-in app console
await fetch('/api/video/generate',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({brandId:'b1384434-3666-45cc-96d9-ca764e90cdc3',contentItemId:'4742f075-f48a-43a1-a547-00816ef816eb',approve:true})}).then(r=>r.json())
```
**T1 PASS =** worker logs `seedance task.created`→`task.succeeded`; a `scene_generations` row with `provider='seedance'` and a reachable `storage_url` (R2 `…r2.dev` / `ottoflow-videos`). Then STOP and report — do NOT proceed to FFmpeg/T3 yet (T3 needs the worker bumped to **2 GB RAM**).

## Access & tooling notes
- **Railway CLI:** needs `RAILWAY_TOKEN=<project-token-UUID>` (operator provides; last session's token should be ROTATED). Then `railway status --json -s ottoflow-video-hub`, `railway logs -s ottoflow-video-hub`, `railway variables -s ottoflow-video-hub --kv` (mask secrets in output).
- **Vercel CLI:** authed as `joseph-8605`. `vercel ls/inspect/env ls --scope team_MrIWWj7J9L2KLG58IRFcnDK7`. Runtime errors via the Vercel MCP `get_runtime_logs` (project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`, team `team_MrIWWj7J9L2KLG58IRFcnDK7`).
- **Prod DB:** Supabase MCP is mis-scoped (only sees INACTIVE `avymp`, permission-denied on `ddoz`). Query `ddoz` via the **authenticated browser** (Clerk `getToken()` + publishable key) or the Supabase **dashboard** SQL editor. In the browser, any JS call that invokes `getToken()` has its OUTPUT suppressed by the Chrome MCP — store results on `window.__x`, read them back sanitized (ids/names only) in a separate call. Keys/tokens must never leave the page.
- **Secrets:** never place a secret unless the operator explicitly authorizes that specific secret. Don't reprint secret values.
- **Deploy gotchas:** deploy from `main`; gates `npx tsc --noEmit` + `npm run build:worker`; a Railway env change auto-redeploys the worker; a Vercel env change needs a fresh git deploy; unauthenticated `curl` is not a valid flag probe (Clerk 404s anon; Vercel deployment URLs are SSO-protected — only the prod alias reflects real app behavior).

## Cleanup / debt (after T1)
- Delete stuck test `render_job` `e6ffb1b5-ca1d-4106-912f-e644ab663086`.
- Rotate the Railway token + AtlasCloud API key (both were pasted in chat).
- Worker `SENTRY_DSN` unset; Railway Redis unauthenticated; Clerk still on DEV keys (gates public launch).

## Verify current state quickly
```
cd D:\tiktok-product-video-factory\ottoflow-ai
git rev-parse origin/main                         # expect 564ffd3…
RAILWAY_TOKEN=<uuid> railway status --json -s ottoflow-video-hub | grep commitHash
RAILWAY_TOKEN=<uuid> railway logs -s ottoflow-video-hub | grep -E "scene-generation|redis.ready"
```

**Goal this session: make Vercel and the worker share one Redis, redeploy, and get T1 to produce the first `scene_generations.storage_url` on R2.** That proves Topic → Gemini → AtlasCloud → R2. Stop there and report.
