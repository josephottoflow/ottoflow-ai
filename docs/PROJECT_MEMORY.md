# Ottoflow AI — Project Memory (Updated 2026-06-03)

---

## Project Goal

Ship the **AI Content Operating System** vertical-slice-by-vertical-slice to production-quality staging.

- **Brand Research Engine:** 100/100, verified end-to-end (happy + retry path).
- **Content Pipeline MVP:** live (pick brand + platform → publish-ready draft in ~20s).
- **Video Pipeline:** fully operational — one prompt produces topic-relevant stock video, ElevenLabs narration, Jamendo music, Gemini upload-ready post copy, and a single downloadable MP4 with audio baked in.

---

## Tech Stack

**Frontend / API**
- Next.js 15.1.6 + React 19 + TypeScript + Tailwind + Shadcn/ui
- Clerk (free plan, dev instance `pro-beetle-20.clerk.accounts.dev`)
- Supabase (Postgres + Realtime + RLS, project `ddozknywcdpyfdokmfrp`)
- Vercel deployment, GitHub `josephottoflow/ottoflow-ai`

**Worker**
- BullMQ + ioredis on Railway, esbuild-bundled CJS, Node 22 (native WebSocket needed for supabase-js Realtime)
- Three Worker instances: `brand-research`, `content-generation`, `video-merge` (shared Redis + shutdown)

**AI / Media**
- Gemini Flash 2.5 via `@google/genai` v0.3.0 (URL Context + Google Search grounding; `generateImages` only, no `generateVideos` yet)
- ElevenLabs TTS — `eleven_turbo_v2`, voice `21m00Tcm4TlvDq8ikWAM` (Rachel), base64 data-URL delivery
- Jamendo Music API v3.0 — CC instrumental via vibe→tag mapping
- Pexels Video Search — 12 domain overrides + keyword extractor + portrait-first
- ffmpeg-full (nix package) on Railway worker for merge

**Observability**
- `@sentry/nextjs` v10.55 (Next: client + server + edge)
- `@sentry/node` v10.55 (Worker)
- DSN active in production, `tracesSampleRate=0.1`, release auto-tagged to commit SHA
- Vendor-neutral shim with `globalThis.__ottoflow_observability__` singleton

**Identifiers**
- Vercel team `team_MrIWWj7J9L2KLG58IRFcnDK7` / `joseph-ottoflow-s-projects`
- Vercel project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`
- Supabase URL `https://ddozknywcdpyfdokmfrp.supabase.co`
- Railway Redis `redis://default:***@zephyr.proxy.rlwy.net:34949`
- Railway project `6f03b33a-9433-4e21-bdbc-1c47525dd5a1`
- Sentry org `ottoflow`, project `javascript-nextjs`, org id `o4511491188850688`
- Clerk userId `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`

---

## Live URLs

| Service | URL |
|---|---|
| Staging | https://ottoflow-ai.vercel.app |
| Sign-in | https://ottoflow-ai.vercel.app/sign-in |
| Health probe | https://ottoflow-ai.vercel.app/api/debug/health |
| Linear brand | https://ottoflow-ai.vercel.app/brands/455e4f6a-113f-4504-8aac-e4f3442db6ff |
| Notion brand | https://ottoflow-ai.vercel.app/brands/0cd7d34a-54cf-4ffb-8fe0-e3a2b8d6c029 |
| Content generation | https://ottoflow-ai.vercel.app/content/generate |
| Video generation | https://ottoflow-ai.vercel.app/video/generate |
| Vercel | https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai |
| Railway | https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1 |
| Supabase | https://supabase.com/dashboard/project/ddozknywcdpyfdokmfrp |
| Sentry | https://ottoflow.sentry.io/issues/?project=4511491204907008 |
| GitHub | https://github.com/josephottoflow/ottoflow-ai |

**Sign-in:** `joseph@ottoflow.ai` / `Ottoflow!2026-Staging-Xt7Qm9pL`

---

## Architecture

### Auth (Supabase Third-Party Auth, Path A)
Clerk session JWT → `Authorization: Bearer <jwt>` (no JWT template). Supabase verifies via Clerk JWKS. RLS via `current_clerk_user_id()` → `auth.jwt() ->> 'sub'`. Root layout `auth()` wrapped in try/catch (favicon paths bypass middleware and would throw Clerk's "no middleware detected").

### Brand-research flow
1. POST `/api/brands` → idempotency + rate-limit + admin insert `brands` + `brand_research_jobs` → BullMQ enqueue
2. Railway worker: `extractBrandProfile` → `findCompetitors` → `generateSEOBundle` (5 stages)
3. Browser subscribes via Realtime (carries Clerk JWT)
4. `/brands/[id]` SSR via user-authed client (RLS scopes to owner)

### Brand-research retry
1. POST `/api/brands/[id]/retry` → ownership check (404 on non-owner) → refuse if `status='researching'` → shared rate-limit (10/hr)
2. Reset latest job in place, flip brand → pending
3. **`queue.remove(researchJobId)` BEFORE `queue.add(..., {jobId})`** — BullMQ dedupes by jobId
4. `onRetried()` callback updates parent state immediately (Realtime doesn't cover brands table)

### Content-generation flow
1. POST `/api/content/generate` → 20/hr rate limit + brand-owned + profile-required → placeholder `content_items` + `content_generation_jobs` row → BullMQ
2. Worker: 3-step pipeline (preparing_prompt → generating → finalizing) → `generateContentPiece()` with brand profile + voice + audience + optional pillar/userPrompt
3. Browser subscribes to BOTH `content_generation_jobs` AND `content_items`
4. `/content/[id]` SSR via user-authed client (RLS via brand_id traversal)

### Video-generation flow
1. POST `/api/generate` (SSE, `text/event-stream`) — 7-stage ReadableStream:
   - **Script** — `generateVideoScript()` returns `{hook, body, cta, estimatedDurationSec, voiceDirection}`
   - **Storyboard** — `generateVideoStoryboard()` returns 3-6 scenes
   - **Voice** — `synthesizeNarration()` → ElevenLabs base64 data URL
   - **Clips** — `generateHeroFrame()` → Imagen 3 best-effort (currently 404 on v1beta, graceful skip). Per-scene Veo not in SDK
   - **Music** — `findTrackByVibe()` → Jamendo CC instrumental, random pick from top 5 popular
   - **SEO** — `generateVideoSEO()` → `{title, description, hashtags[]}` for upload-ready copy
   - **Render** — `findStockVideoByPrompt()` → Pexels (12 domain overrides + keyword extractor + portrait-first + HD filter). Falls back to Big Buck Bunny placeholder only on miss or missing key
2. SSE `done` event payload: `{videoUrl, jobId, audioUrl, musicUrl, musicTrack, videoAttribution, seo}`
3. **Post-SSE merge:** `/api/generate` flips `render_jobs.merge_status='pending'` + enqueues `video-merge` BullMQ job (fire-and-forget; Sentry on enqueue throw)
4. Railway worker `processVideoMerge`: downloads video + narration data URL + music URL in parallel → ffmpeg stream-copy video + amix narration (full) + ducked music (`10^(duckingDb/20)`, default -12 dB) + AAC + `-shortest` → uploads to Supabase Storage `merged-videos/{userId}/{renderJobId}.mp4` → writes `render_jobs.merged_video_url` + `merge_status='done'`
5. Page `/video/generate` Realtime subscription on `render_jobs` row → swaps `<video src>` + Download button + Copy Link to merged URL when ready

### Defensive layers
- `isHeaderSafe()` RFC 7230 check on every env value at boot
- `safeToken()` strict JWT regex
- `tryCreateClient()` try/catch around Supabase createClient
- `safe<T>()` wrapper on every public db query
- `withTimeout()` + `withRetry()` around every Gemini call (90s timeout, 3 attempts, exponential 1s→2s→4s capped 5s)
- Idempotency cache (Redis, 24h TTL) + rate limit (Redis ZSET sliding window) per route
- Stuck-job recovery sweep at worker boot + on stalled events
- Domain allowlist (`@ottoflow.ai` only)
- Global ErrorBoundary + segment ErrorBoundary

---

## Key Decisions

- **Clerk free plan + app-layer domain allowlist** — `ALLOWED_EMAIL_DOMAINS` defaults to `ottoflow.ai`, enforced in `layout.tsx`
- **GitHub identity** — `josephottoflow` for all commits
- **Railway build** — `nixpacks.toml` overrides all phases; `railway.json` builds worker only
- **Node 22 on Railway** (Node 20 lacks native WebSocket)
- **Idempotency + rate limit in Redis** (not DB) — staging acceptable
- **Gemini structured-output two-mode branch** — strict (responseMimeType + responseSchema) when no tools; lenient (schema-in-prompt + code-fence-strip) when tools used
- **Icons across RSC boundary** — pre-rendered JSX, not function refs
- **Worker bundle externalizes `@sentry/node` + `@opentelemetry/*`** — OTel loads via dynamic require()
- **Observability shim has NO `@sentry/*` imports** — keeps worker bundle free of `@sentry/nextjs`
- **Handler state on `globalThis.__ottoflow_observability__`** — Next.js per-route bundling duplicates module-level `let`
- **One Sentry DSN for all runtimes** (Next server/client/edge + worker) — each tagged via `runtime:`
- **Sensitive env vars are runtime-only on Vercel** — `SENTRY_DSN`/`GOOGLE_API_KEY`/etc Sensitive (read at runtime). `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` MUST be non-Sensitive (webpack plugin reads them at build time). Sensitive vars can't be rotated — delete + recreate
- **`/monitoring` tunnel route in middleware public matcher** — Clerk would otherwise redirect browser Sentry POSTs to `/sign-in`
- **BullMQ jobId = research/content/render UUID** for tracing — retry MUST `queue.remove()` before `queue.add()`
- **Brand profile written early in brand pipeline** — preserved even if later stages fail
- **Three BullMQ Worker instances** (vs job-name multiplexing) — independent scaling, stuck queue isolation
- **Content can be generated direct-against-brand** (no Project required) — migration 003 added `content_items.brand_id`; RLS accepts brand_id OR project_id traversal
- **`content_items.engagement` jsonb is a union** — legacy `{likes, shares, comments}` OR generated `{hashtags?, cta?}`
- **Native ffmpeg via nixpacks `ffmpeg-full`** (vs ffmpeg-static npm) — smaller bundle, cleaner per-arch
- **ffmpeg merge: stream-copy video + re-encode audio only** — Pexels source is already H.264 + yuv420p; 10× faster + libx264 not in failure surface
- **`amix=duration=first`** — follows narration timeline; music trimmed if longer or silent if shorter. `-shortest` at encoder caps to video duration
- **Public Supabase Storage bucket `merged-videos`** — service-role write (worker), public read so `<a download>` works without auth
- **Pexels is currently the SOLE video source** — provider toggle in UI (Veo 3 Lite / Higgsfield / Imagen 3) is cosmetic. `provider` field saved to `render_jobs.template` for record-keeping only, never branched on. Veo 3 unavailable in SDK; Higgsfield in `.mcp.json` but not wired; Imagen 3 only attempted for a hero frame (still image), currently 404s

---

## Completed Work

### Sentry Activation (`096fb85` → `604814e`)
- Vendor-neutral observability shim with `globalThis` singleton fix
- DSN deployed: Vercel `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (Sensitive, Production+Preview), Railway `SENTRY_DSN`
- Verified end-to-end via `/api/debug/sentry-test`

### Bugs caught + fixed via Sentry
- `d4c290b` — middleware was protecting `/monitoring` tunnel
- `604814e` — observability shim handler state didn't survive Next.js bundling
- `84d3697` — root layout `auth()` threw on favicon requests

### Full UI button audit + wiring (`e6b73f7`, `63f6263`)
11 dead buttons surfaced via JS DOM enumeration; all now navigate or surface honest disabled state.

### Brand retry flow (`de3457f`, `7e77ccb`, `76b440e`)
- POST `/api/brands/[id]/retry` full implementation with FailureCard Retry Research button
- `onRetried` callback for client state sync
- BullMQ remove-before-add fix

### Google API key rotation
- Vercel `GOOGLE_API_KEY` delete + recreate
- Railway in-place edit
- Verified: `/api/debug/health` 8/8 in 955ms, Gemini "pong" in 586ms

### Brand-pipeline validation
- Linear: Failed (503) → retry with new key → **Ready** with full Gemini output

### Content Pipeline MVP (`ad23ca2`, `ab2d3dd`, `4e9ee9f`)
- Migration `003_content_pipeline.sql` — `content_generation_jobs` table, `append_content_log()`, `content_items.brand_id` + `user_prompt`, RLS via brand_id traversal
- `src/lib/queue.ts` — content-generation queue + payload + helper
- `src/lib/gemini.ts` — `generateContentPiece()` (platform-aware, brand context)
- `worker/processors/content-generation.ts` — 3-step pipeline
- POST `/api/content/generate` — 20/hr rate limit + brand-profile-required
- `/content/generate` page — brand dropdown + 6 platform cards + Realtime + inline output + copy
- `/content/[id]` detail page — full body + copy-all + hashtag chips + brand link
- Two pieces of brand-authentic content generated for Linear in production

### Pexels topic-relevant fix (`0c851fa`)
- `src/lib/pexels.ts` — `findStockVideoByPrompt()` with 12 domain overrides (coffee, standing desk, skincare, fitness, tech, finance, food, fashion, travel, home, startup, marketing) + keyword extractor + portrait-first orientation + HD filter
- Replaces hardcoded Big Buck Bunny placeholder in Render stage
- `SSEEvent.videoAttribution` added — Pexels photographer credit rendered beneath video (TOS)
- Verified live: coffee prompt → `Stock clip matched — query "coffee pour cinematic closeup" (portrait, 720×1366, 38s) by Ron Lach`

### Video Pipeline MVP (`ed6e7d2`, `4f01733`, `d1f5e5a`)
- `src/lib/gemini.ts` — `generateVideoScript()`, `generateVideoStoryboard()`, `generateHeroFrame()`
- `src/lib/elevenlabs.ts` — `synthesizeNarration()` (Rachel + eleven_turbo_v2 + base64 data URL)
- `src/lib/jamendo.ts` — `findTrackByVibe()` with vibe→tag map + portrait-first + top-5 random
- POST `/api/generate` — full SSE pipeline orchestrator
- `/video/generate` page — 3 playable assets, audio players, attribution, autoplay (`muted playsInline`)
- Vercel env vars added (Sensitive, Production+Preview): `ELEVENLABS_API_KEY`, `JAMENDO_CLIENT_ID`, `JAMENDO_CLIENT_SECRET`, `PEXELS_API_KEY`

### Video SEO Copy (`e3ad6b0`)
- `generateVideoSEO()` in `src/lib/gemini.ts` — TikTok/IG-tuned title + description + hashtags via strict structured output
- Stage 7 in `/api/generate` between Music and Render (overlaps stock-clip lookup latency)
- `SSEEvent.seo?` emitted on done event
- "POST COPY · READY TO UPLOAD" card with Title, Description, hashtag chips, one-tap "Copy all" (assembles `<title>\n\n<description>\n\n#tag1 #tag2`)
- Live verification examples:
  - Espresso machine: *"Coffee or an experience? Elevate your mornings."* + 13 hashtags
  - Workout earbuds: *"Gym noise? GONE. Your focus? ABSOLUTE. 🎧"* + 12 hashtags
  - Cold brew: *"What if perfect mornings were delivered to your door?"* + 11 hashtags

### Single Downloadable MP4 — ffmpeg merge (`4994c6b`, `89d70b3`, `f21ae6d`)
- Migration `004_video_merge.sql` — `merged_video_url`/`merge_status`/`merge_error` columns on `render_jobs`, Storage bucket `merged-videos` (public read), Realtime publication
- `worker/processors/video-merge.ts` — parallel downloads → ffmpeg stream-copy video + amix → Supabase Storage upload. Captures full stderr (2000 chars) + exit code AND signal
- `worker/index.ts` — third Worker instance, concurrency = WORKER_CONCURRENCY/2 (ffmpeg CPU-heavy), parallel shutdown
- `src/lib/queue.ts` — `videoMerge` queue + `VideoMergeJobData` payload + helper
- `nixpacks.toml` — `[phases.setup] nixPkgs = ["nodejs_22", "ffmpeg-full"]`
- `/api/generate` — after SSE done, flips merge_status='pending' + enqueues job
- `/video/generate` page — Realtime subscription on render_jobs row → swaps `<video src>` + Download button + Copy Link when ready
- 3-attempt iteration log:
  1. `4994c6b`: failed with `weights=1 0.7` parse error in amix (space in arg)
  2. `89d70b3`: dropped weights= + linearized volume; still failed with truncated stderr
  3. `f21ae6d`: full stderr + signal capture + simpler command (stream-copy, drop `-stream_loop -1`, drop libx264, drop `+faststart`, drop `pix_fmt yuv420p`) — **succeeded in 2.843 seconds**
- Live verification: craft-beer prompt → merged MP4 at `supabase.co/storage/v1/object/public/merged-videos/{userId}/9eae7c3a-4cc1-420b-a3ea-1d72bb49cd29.mp4` played; Download button updated to "Download (with audio)"; green chip "Audio merged — single MP4 ready to download"

### Diagnostic endpoints (remove pre-public-beta)
- `/api/debug/auth` — Clerk JWT + Supabase RPC
- `/api/debug/raw` — hand-built fetch to PostgREST
- `/api/debug/rls-test` — admin vs user-authed count compare
- `/api/debug/cleanup` — delete orphan brand rows
- `/api/debug/health` — 8-check connection probe
- `/api/debug/sentry-test` — Sentry probe
- `/api/debug/failed-jobs` — DB record of failed jobs

---

## Outstanding Tasks

| # | Status | Task |
|---|---|---|
| #11/#13 | pending | Wire Sentry source-map upload — `SENTRY_AUTH_TOKEN` + `SENTRY_ORG=ottoflow` + `SENTRY_PROJECT=javascript-nextjs` to Vercel with **Sensitive=OFF** (build-time access required), redeploy |
| #18 | pending | Wire Analytics page to real DB — `getAnalyticsData()` is mock |
| #30c | pending | Rotate Railway Redis password — Vercel env var still old |
| #34 | pending | Polish: Gemini blog output mixes HTML tags with markdown — tighten prompt OR pipe body through markdown parser |
| #36 | pending | Polish: Imagen 3 model 404 on v1beta API for both `generate-002` and `fast-generate-001` — investigate Imagen tier access OR alternate model id. Pipeline degrades gracefully |

---

## Known Issues

1. **`/api/debug/*` endpoints exposed** — auth-gated but remove pre-public-beta (7 endpoints)
2. **142 pre-existing TS errors** in `worker/processors/brand-research.ts`, `src/agents/*`, `src/app/studio/page.tsx`. Vercel build pipeline ignores
3. **Source-map upload not wired** — stack traces show minified code
4. **Blog body has literal `<ul><li>` HTML tags** — content readable but messy until prompt/renderer fix
5. **`/content` Pipeline Workflow diagram is static** — cosmetic
6. **Veo 3 video generation not yet shipped in `@google/genai` v0.3.0** — SDK exposes `generateImages` only
7. **Imagen 3 hero frame 404** — both `generate-002` and `fast-generate-001` return NOT_FOUND on v1beta API
8. **Provider toggle is cosmetic** — `Veo 3 Lite` / `Higgsfield` / `Imagen 3` buttons in `/video/generate` UI are not branched on; Pexels is the only actual video source

### Out of scope (deferred to v1)
- `/billing` — Stripe integration
- `/settings` — full UI (Clerk manages core)
- `/projects` — no brand-to-project flow
- Content Strategy Engine, UGC, Real Estate Mode
- Content retry endpoint POST `/api/content/[id]/retry`
- Video retry endpoint
- Content edit / approve / publish workflow stages
- "Send to Video Pipeline" CTA on video-script content
- Persist video generations to `render_jobs` with `output_url` browser history view

---

## Constraints / Standing Orders

**Security (hard rules — apply even with explicit user authorization)**
- DO NOT paste secret values into chat — user pastes themselves; confirm "captured"
- DO NOT enter API keys / passwords / credentials into form fields — user must paste. Exception: `NEXT_PUBLIC_*` semi-public values (e.g. Sentry DSN) acceptable inline
- Mask GitHub PAT in `git remote -v` output: `sed 's,://[^/]*@,://***@,'`
- Never skip git hooks (`--no-verify`) or bypass signing unless explicitly requested

**Commits**
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- All commits authored as `josephottoflow`
- Always include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- Pass commit messages via heredoc

**Scope**
- DO NOT start new feature development beyond agreed scope without explicit `/goal` direction
- UI polish + ops endpoints (retry, debug) are in scope under "production quality"
- Content + Video pipelines are now active scopes (user directed both via `/goal`)

---

## Critical File Paths

```
ottoflow-ai/
  nixpacks.toml                          NIXPACKS_NODE_VERSION=22, ffmpeg-full
  railway.json                           buildCommand: npm run build:worker
  next.config.ts                         withSentryConfig, tunnelRoute "/monitoring"
  sentry.server.config.ts                @sentry/nextjs (nodejs runtime)
  sentry.edge.config.ts                  @sentry/nextjs (edge runtime)
  src/
    instrumentation.ts                   Next 15 register() + onRequestError export
    instrumentation-client.ts            Next 15.3+ client init
    middleware.ts                        Clerk auth gate; /monitoring + favicon public
    app/
      layout.tsx                         try/catch around auth() for static paths
      page.tsx                           Dashboard
      error.tsx, global-error.tsx        ErrorBoundary
      brands/
        page.tsx, new/page.tsx
        [id]/page.tsx                    SSR fetch
        [id]/BrandDetailClient.tsx       Realtime + FailureCard with Retry
      content/
        page.tsx, ContentPageClient.tsx
        generate/page.tsx, ContentGenerateClient.tsx
        [id]/page.tsx, ContentItemDetailClient.tsx
      video/
        VideoPageClient.tsx
        generate/page.tsx                SSE consumer, audio + music players, SEO card, merged-video Realtime
      projects/, analytics/
      api/
        brands/route.ts                  POST: idempotency + rate limit + create
        brands/[id]/retry/route.ts       POST: auth + own + queue.remove + queue.add (202)
        content/generate/route.ts        POST: auth + rate limit + brand-profile-required + enqueue (202)
        generate/route.ts                POST SSE: 7-stage video pipeline + post-pipeline merge enqueue
        debug/{auth,raw,rls-test,cleanup,health,sentry-test,failed-jobs}/route.ts
    lib/
      env.ts, worker-env.ts              Zod + isHeaderSafe
      supabase-server.ts                 safeToken + tryCreateClient
      supabase.ts                        Admin client
      db.ts, db-brands.ts                safe()-wrapped
      domain-allowlist.ts
      rate-limit.ts, idempotency.ts      Redis-backed
      queue.ts                           3 queues + getRedisClient
      gemini.ts                          generateContentPiece + generateVideoScript + generateVideoStoryboard + generateHeroFrame + generateVideoSEO
      elevenlabs.ts                      synthesizeNarration() → Rachel + eleven_turbo_v2
      jamendo.ts                         findTrackByVibe() → CC instrumental
      pexels.ts                          findStockVideoByPrompt() → 12 domain overrides + keyword extractor
      observability.ts                   Vendor-neutral shim, globalThis singleton
    components/
      Sidebar.tsx                        Clerk UserButton bottom-left
      SupabaseProvider.tsx               Clerk JWT to Realtime
  worker/
    index.ts                             Boot → 3 Workers (brand-research + content-generation + video-merge)
    observability.ts                     @sentry/node init + flushSentry
    build.mjs                            esbuild bundler
    recovery.ts                          Stuck-job sweep + stall handler
    processors/
      brand-research.ts                  5-step pipeline
      content-generation.ts              3-step pipeline
      video-merge.ts                     ffmpeg stream-copy + amix + Storage upload
  supabase/migrations/
    001_initial.sql                      projects/content/render_jobs, current_clerk_user_id()
    002_foundation.sql                   brands, brand_research_jobs
    003_content_pipeline.sql             content_generation_jobs, append_content_log(), brand_id traversal
    004_video_merge.sql                  render_jobs merge columns + Storage bucket + Realtime publication
  docs/
    PROJECT_MEMORY.md                    THIS FILE
```

---

## Sentry Reference

**Activation status:** ✅ Live. DSN set on Vercel + Railway.

**Singleton storage:** Handler state on `globalThis.__ottoflow_observability__`.

**Tunnel route:** `/monitoring` via `withSentryConfig`; middleware public matcher includes `/monitoring(.*)`.

**Capture labels (stable, for Sentry grouping)**
- `gemini.call.exhausted`
- `supabase-server.token.shape_invalid` / `.header_unsafe`
- `supabase-server.auth_header.unsafe`
- `supabase-server.createClient.threw`
- `supabase-server.clerk_getToken.threw`
- `db.<queryName>.threw` / `db-brands.<queryName>.threw`
- `brands.retry.enqueue_failed` / `.client_failed`
- `content.generate.enqueue_failed` / `.client_submit_failed`
- `video.generate.failed` / `video.generate.job_insert_failed` / `video.merge.enqueue_failed`
- `sentry.activation.test` / `.direct`

**Breadcrumbs:** `gemini.retry` (attempt, retryable, error)

**Tags:** `runtime`: `nextjs-node` | `nextjs-edge` | `nextjs-client` | `worker`; `fallback.label`; worker also `queue`, `job.id`, `brand.id`

**Sample rate:** `0.1` default, env-tunable

**Source-map upload:** Opt-in via `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`. Must be **non-Sensitive** on Vercel. Token already generated from "Vercel Source Maps" internal integration

---

## Sentry Issue Reference

| ID | Title | Status |
|---|---|---|
| JAVASCRIPT-NEXTJS-1 | TypeError in sentry/scripts/views.js | 1 event, SDK glitch |
| JAVASCRIPT-NEXTJS-2 | Clerk: auth() was called but Clerk can't detect | Fixed by `84d3697`, stuck at 12 events |
| JAVASCRIPT-NEXTJS-3 | Sentry activation probe — direct path | Intentional probes |
| JAVASCRIPT-NEXTJS-4 | ServerError 503 (Gemini) from worker | `fallback.label:gemini.call.exhausted` |

---

## Recent Commits (newest first)

```
1e7cf82  docs(memory): Video Pipeline fully shipped — SEO + merged MP4 live
f21ae6d  fix(video-merge): simpler ffmpeg command + capture signal + full stderr
89d70b3  fix(video-merge): drop amix weights= param + linearize volume
4994c6b  feat(video): ffmpeg merge — single downloadable MP4 with audio baked in
e3ad6b0  feat(video): generate upload-ready SEO copy (title + description + hashtags)
d8643df  docs(memory): Pexels topic-relevant stock-clip fix verified live
0c851fa  fix(video): topic-relevant stock clip via Pexels (was always Big Buck Bunny)
3a071fe  docs(memory): snapshot session — Video Pipeline MVP live with real Voice + Music
d1f5e5a  feat(video): real ElevenLabs narration + Jamendo music in /api/generate
4f01733  fix(video): playable placeholder MP4 + retry Imagen 3 with fast variant
ed6e7d2  feat(video): MVP /api/generate SSE — real Gemini brain, placeholder render
78e7339  docs(memory): snapshot session — Content Pipeline MVP live + detail view
4e9ee9f  feat(content): clickable content-item detail page
ab2d3dd  fix(gemini): correct BrandProfile field names in generateContentPiece
ad23ca2  feat(content): MVP content pipeline — pick brand + platform → ready draft
76b440e  fix(brands/retry): remove existing BullMQ job before re-adding
7e77ccb  fix(brands): update local state immediately on retry success
de3457f  feat(brands): add /api/brands/[id]/retry + Retry Research button
63f6263  fix(ui): wire the four remaining dead buttons surfaced by click-test
e6b73f7  fix(ui): wire 7 dead buttons across all routes
84d3697  fix(layout): guard root auth() so favicon requests stop throwing
58e3afc  chore(sentry): bump default tracesSampleRate 0.05 → 0.1
604814e  fix(observability): back handler state with globalThis singleton
d4c290b  fix(middleware): exclude /monitoring tunnel from Clerk auth gate
096fb85  feat(observability): wire Sentry scaffolding for Next + worker
```

---

## Next Steps

1. **Decide on provider toggle** — `/video/generate` UI shows Veo 3 Lite / Higgsfield / Imagen 3 but Pexels is the only real source. Three paths: wire Higgsfield as primary with Pexels fallback, hide the toggle until real AI video lands, or leave cosmetic + add tooltips
2. **Polish content body rendering** (#34) — tighten Gemini blog prompt to "markdown only, no HTML" OR pipe body through markdown parser
3. **Resolve Imagen 3 access** (#36) — investigate whether key needs Imagen tier enabled in Google AI Studio OR alternate model id
4. **Finish secret rotations** — Task #30c (Railway Redis password → update Vercel REDIS_URL)
5. **Wire source-map upload** — paste `SENTRY_AUTH_TOKEN` + `SENTRY_ORG=ottoflow` + `SENTRY_PROJECT=javascript-nextjs` to Vercel with Sensitive=OFF
6. **Optional Content Pipeline polish** — retry endpoint, approve/publish workflow stages, "Send to Video Pipeline" CTA
7. **Optional Video Pipeline polish** — persist video runs to `render_jobs` history view, retry endpoint, musicVibe/voiceStyle selectors
8. **Decision point** — promote to limited-access staging (5-10 users), monitor Sentry + retry flows + Gemini availability for 7 days
9. **Pre-public-beta cleanup** — remove 7 `/api/debug/*` endpoints, address 142 pre-existing TS errors
