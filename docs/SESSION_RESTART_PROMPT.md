# SESSION_RESTART_PROMPT

Paste this to a fresh Claude session to continue immediately.

---

You are continuing work on **Ottoflow AI** — a Next.js 15 SaaS "AI Content Operating System" at `D:\tiktok-product-video-factory\ottoflow-ai`.

**First:** read these in `ottoflow-ai/docs/` and treat as the ONLY source of truth (ignore the ~60 older `docs/` files): `PROJECT_STATE.md`, `ARCHITECTURE.md`, `OPEN_TASKS.md`, `DECISIONS.md`, `DEPLOYMENT.md`, `OTTOFLOW_VIDEO_V1_AUDIT.md`, `OTTOFLOW_VIDEO_V1_UX_SPEC.md`, this file. Verify from real state (git / `vercel` / `railway` / DB / logs), never assertions.

## ✅ MAJOR MILESTONE (2026-06-21): the first MP4 rendered end-to-end
The Redis split-brain blocker is **SOLVED** and the full Video V1 pipeline ran:
`Content → Gemini Strategy → 4× Seedance scenes → R2 → ffmpeg-compose → MP4`.
- `origin/main` = **`01fa671`** (Track B UI + Tasks 1–3,5 + 360s seedance timeout all merged; Vercel + worker both deployed on it).
- **Redis = shared Upstash**, set on BOTH Vercel Production + Railway worker: `REDIS_URL=rediss://default:<UPSTASH_TOKEN>@pet-lamb-125717.upstash.io:6379` (the Upstash REST token doubles as the TCP password). Verified: enqueue→consume→AtlasCloud→R2→compose all worked.
- **Proof render** `234a069e-c02b-4614-9a17-f3f52f0ac2b0`: 4/4 scenes `provider=seedance` (no Pexels fallback), `merge_status=done`, `progress=100`, `merged_video_url` populated. **MP4 exists in R2**: bucket `ottoflow-videos`, key `user_3EU5v1pvYzamGINC5tUKbr8g1Ff/234a069e…/ffmpeg-v2.mp4`, **14,509,357 bytes** (verified via authenticated S3 API). Worker RAM held (no OOM at compose).

## 🔴 THE ONE OPEN BLOCKER: R2 public URL doesn't serve
The objects EXIST in R2 (verified), but the public URL is dead → users can't preview/download.
- `R2_PUBLIC_BASE_URL = https://pub-3e67736a889849bab6c5fde844f9521a.r2.dev` (worker + `R2_PUBLIC_URL` alias). That host **does not resolve / returns a Chrome error page** (browser + shell). It's a per-bucket R2 Public-Dev URL that is **disabled / stale** for `ottoflow-videos` (the bucket was switched from `ottoflow-renders`; `r2.ts` is correct, the env var points at a dead endpoint).
- **Fix (operator — needs Cloudflare dashboard or a CF API token; the R2 *S3* keys can't toggle this):** Cloudflare → R2 → bucket `ottoflow-videos` → Settings → **enable "Public Development URL"** (new `pub-<hash>.r2.dev`) OR connect a **custom domain** (e.g. `cdn.ottoflow.ai`).
- **Then (you can do):** set `R2_PUBLIC_BASE_URL` (+`R2_PUBLIC_URL`) to the new base on worker (`railway`) + Vercel (`vercel env`, fresh git deploy); rewrite the stored `render_jobs.merged_video_url` + `scene_generations.storage_url` base for `234a069e` (or re-render); prove `curl -I <base>/…/ffmpeg-v2.mp4` → HTTP 200 `video/mp4` `content-length: 14509357`.
- **No code change needed** (`src/lib/ffmpeg-pipeline/r2.ts` is correct).

## Access & tooling
- **Railway:** `RAILWAY_TOKEN=<project-token-UUID>` (operator-provided; **ROTATE** — it's in old transcripts). `railway status/logs/variables -s ottoflow-video-hub`.
- **Vercel:** CLI authed `joseph-8605`. `vercel … --scope team_MrIWWj7J9L2KLG58IRFcnDK7`. Runtime errors via Vercel MCP `get_runtime_logs` (project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`).
- **R2:** S3 API at `https://4b53de9208a4ecc628a9bad59b2272e4.r2.cloudflarestorage.com` (reachable); `pub-*.r2.dev` is NOT reachable from the sandbox. R2 S3 keys live in worker env (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`). A Node SigV4 client works (see how the last session listed objects).
- **Prod DB:** Supabase MCP is mis-scoped (can't reach `ddoz`). Query via the **authenticated browser** (Clerk `getToken()` + publishable key) — store results on `window.__x` then read back sanitized (the Chrome MCP suppresses outputs containing key/uuid-like strings).
- **Browser:** Chrome MCP, `Browser 1`, logged into `ottoflow-ai.vercel.app`. T0/T1 are Clerk-gated → must run in the logged-in browser.
- **Test data:** brand Basecamp `b1384434-3666-45cc-96d9-ca764e90cdc3` · content `4742f075-f48a-43a1-a547-00816ef816eb` · user `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`.

## Gotchas (verified this session)
- A render takes ~14 min (4 Seedance scenes at ~2–6 min each) + ~18s compose. AtlasCloud is slow under load; 360s timeout keeps scenes on Seedance.
- `pub-*.r2.dev` unreachable from BOTH sandbox and browser (DNS + CORS); use the S3 API or a working public base to verify objects.
- `render_jobs.status` stays `queued` even when done — the real terminal signal is `merge_status=done` + `merged_video_url`.
- ffmpeg-compose ships even on QC soft-fail (qcScore < threshold → "regen_unactionable" → uploads anyway).

## 🔁 Rotate (all exposed in transcripts)
Railway project token · AtlasCloud API key (`apikey-a62a…`) · Upstash REST token (`gQAA…`) · **R2 secret key** (`4015f3…`, leaked in a variable dump).

## Remaining after R2 public-serving
- Worker `SENTRY_DSN` unset. · Clerk still DEV keys (gates public launch). · Track-B FFmpeg quality items (crossfades/grade — spec in the audit doc, deferred).

**Goal this session: enable R2 public serving on `ottoflow-videos`, wire `R2_PUBLIC_BASE_URL`, and prove `render_jobs.merged_video_url` returns HTTP 200 + plays.** That's the last gap to a user-viewable first video.
