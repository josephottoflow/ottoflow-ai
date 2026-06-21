# ARCHITECTURE.md

All components merged in `origin/main` (`564ffd3`). Publishing dark by unset flag; Video V1 flag-on but blocked on Redis transport (see [PROJECT_STATE](PROJECT_STATE.md)). Rationale in [DECISIONS](DECISIONS.md).

## Topology
- **Web/API — Vercel** (Next.js 15 App Router). UI + `src/app/api/*`. Synchronous only (auth, DB, brief composition, Gemini strategy, OAuth, **enqueue**). Must not load native modules (sharp/ffmpeg) at import time.
- **Worker — Railway** service `ottoflow-video-hub` (`worker/index.ts`, esbuild → `worker/dist/index.js`, `npm run start:worker`). All async/heavy work via BullMQ. nixpacks installs `ffmpeg-full` + fonts + chromium. Node 22, **single replica** (do NOT scale >1).
- **Redis** — BullMQ broker + distributed lock. ⚠️ **Worker uses `redis://redis.railway.internal:6379` (internal, no auth, no public proxy); Vercel `REDIS_URL` is empty.** They do NOT currently share a reachable Redis → Vercel enqueues never reach the worker. Fix = one shared Redis (Upstash recommended) on both surfaces.
- **Supabase** `ddozknywcdpyfdokmfrp` — Postgres (RLS by Clerk JWT `sub` via `current_clerk_user_id()`), Storage, Realtime (unreliable on content tables → ~2.5s polling fallback).
- **Clerk** — auth via **Supabase Third-Party Auth** (Clerk session JWT verified through Clerk JWKS; no JWT template, no webhooks). DEV keys in prod (debt). `src/middleware.ts` runs `auth.protect()` on all non-public routes → unauthenticated requests get `notFound()` (404), not a redirect.
- **Cloudflare R2** — render/scene-clip store (worker, SigV4 over fetch). Bucket `ottoflow-videos`, account `4b53de9208a4ecc628a9bad59b2272e4`.
- **Gemini** (`@google/genai`): `gemini-2.5-flash` (text), `gemini-embedding-001` @768-dim L2-normalized, `imagen-4.0-fast-generate-001`. `GOOGLE_API_KEY`.
- **AtlasCloud** — Seedance 2.0 text-to-video (worker scene generation).

## Request → work split
Route does auth + validation + DB + (for video) the Gemini strategy, then **enqueues a BullMQ job**; worker processes + writes status; client polls/subscribes.

## Worker boot order (`worker/index.ts` — do not reorder)
1. dotenv → **2. `worker-env` validation (throws+exits if `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`REDIS_URL`/`GOOGLE_API_KEY` missing)** → 3. Sentry init (no-op if `SENTRY_DSN` unset) → 4. BullMQ → 5. Redis logger → 6. stuck-job sweep (5 min; covers brand/content/merge — **NOT scene-generation**) → 7. Workers + signal handlers.

## Worker queues (`src/lib/queue.ts`; `Worker` instances in `worker/index.ts`)
| Queue | Purpose | Gating |
|---|---|---|
| `brand-research` | Gemini research → evidence + embeddings | always |
| `content-generation` | post body from brand+topic | always |
| `creative-generation` | Imagen bg → validate → sharp composite → storage | always |
| `video-merge` | legacy Pexels+narration+music merge | always |
| `ffmpeg-compose` | ADR-002 12-agent compose+QC → R2 | always |
| `drive-sync` | copy creative/video to user's Drive | always |
| `publish` | publish one job to its destination | only if `PUBLISHING_ENABLED` |
| `scene-generation` | Video V1: provider clip per scene → R2 → CompositionPlan → enqueue `ffmpeg-compose` | only if `VIDEO_RENDER_ENABLED` (**registered now**) |

BullMQ default `attempts:2` (publish/scene-gen use `attempts:1`). **Custom jobIds must NOT contain `:`** → hyphens.

## Intelligence loop (V2) — LIVE
research_runs/research_documents (pgvector 768 + HNSW + FTS, content-hash dedupe) → brand_topics (`source='evidence-mined'`) → content_items (status machine) → content_metrics → recommendations (`src/lib/recommendations.ts`, pure rule engine).

## Creative Orchestrator (`src/lib/creative/`) — LIVE, two-layer, safety-first
- **hierarchy.ts** deterministic priority `founder_led>data_led>quote_led>brand_led`; `<0.55` → brand_led.
- **brief.ts** `composeCreativeBrief` → Zod `CreativeBrief` jsonb (hierarchy, visual_tension, visual_metaphor, concept, headline/cta, background_prompt, palette).
- **gemini.ts** Imagen background only (no `seed`); `validateGeneratedBackground` (≤3 attempts → deterministic sharp gradient fallback; `background_source` imagen|fallback).
- **compositor.ts** deterministic `sharp` whitelist + SVG typography + scrim.
- **Invariants:** uploaded logo/headshot bytes immutable, never sent to a model; Imagen = background only; image-gen reachable only from an `approved` brief.

## Video pipeline (Video V1, AI-first) — merged, flag-on, blocked on Redis
`POST /api/video/generate` (Vercel): reads creative brief (visual_tension/metaphor/cta/palette) → `buildVideoStrategy` (1 Gemini call → 4-beat arc problem/tension/solution/outcome, abstract-safe 9:16 prompts; brand assets NEVER described) → dryRun/cost-approval gate → `render_jobs` (`render_kind='ai-first'`) + enqueue `scene-generation`.
⚠️ The `/video/generate` **UI page** drives the *legacy* `/api/generate` SSE path, NOT this route — invoke T0/T1 by direct `fetch`, not that UI.
Worker `scene-generation`: per scene `registry.generateScene({preferProvider:"seedance"})` → copy clip to **R2** (durability gate fails fast if R2 unconfigured) → upsert `scene_generations` → `buildAiFirstPlan` → enqueue `ffmpeg-compose`.
- **Provider registry** (`src/lib/video-providers/`): `getChain()` — live `[Seedance, (Runway?), (Luma?), Pexels]`. **`seedance.ts` targets AtlasCloud Seedance 2.0** (`name="seedance"`): `POST api.atlascloud.ai/api/v1/model/generateVideo` (Bearer + browser UA for Cloudflare) `{model:"bytedance/seedance-2.0/text-to-video",prompt,duration,resolution,ratio,generate_audio:false,watermark:false}` → `{data:{id}}`; poll `GET /api/v1/model/prediction/{id}` → `data.status` (completed|succeeded) → `data.outputs[0]`. Reads `ATLASCLOUD_*` (SEEDANCE_* fallback). Provider-agnostic downstream — FFmpeg/R2 only see clip URLs.
- **branding.ts** (`renderCtaCard`, `fetchLogoBytes`): deterministic FFmpeg overlay assets. **Imports `sharp` lazily inside `renderCtaCard`** — top-level import crashes the Vercel route at module-init (route → orchestrator → agent11 → branding). sharp runs worker-only.
- **ffmpeg-compose** (ADR-002): 12 agents (`src/lib/ffmpeg-pipeline/agents/01..12`), multi-pass FFmpeg, libass captions, QC + bounded 1-pass regen → R2 (primary) / Drive (fallback) → `render_jobs.merged_video_url`. Needs **2 GB RAM** (OOMs at 1 GB). Known defect: `06-diversity.ts` no intra-video uniqueness.

## Integrations + Publishing (`src/lib/integrations/`, `src/lib/publishing/`) — merged, dark
Generic `ProviderDefinition` registry (google-drive/linkedin/meta) + `[provider]` routes; OAuth (auth-code+PKCE); tokens AES-256-GCM at rest (`INTEGRATIONS_ENC_KEY`, AAD `provider:userId`); ownership=`user_id`. `publish_jobs` per-destination; at-most-once (CAS claim + `attempts:1` + `external_post_id` guard; ambiguous→`needs_review`); DB-driven scheduler + reaper, Redis-locked. PUB-1 posts nothing live.

## Storage buckets (Supabase public-read, service-role writes)
`merged-videos` · `brand-assets` · `content-creatives`. Renders/scene clips → Cloudflare R2 (`ottoflow-videos`).
