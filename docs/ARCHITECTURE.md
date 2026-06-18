# ARCHITECTURE.md

## Topology
- **Web/API — Vercel** (Next.js 15 App Router). UI + `src/app/api/*`. All *synchronous* work (auth, DB, brief composition, OAuth flows, enqueue).
- **Worker — Railway** (`worker/index.ts`, esbuild → `worker/dist/index.js`, `npm run start:worker`). All *async/heavy* work via BullMQ.
- **Redis** — BullMQ broker + distributed lock (`REDIS_URL`). Shared app↔worker.
- **Supabase** — Postgres (RLS by Clerk JWT `sub` via `current_clerk_user_id()`), Storage (public buckets), Realtime.
- **Clerk** — auth (DEV keys in prod — debt). **Cloudflare R2** — render/asset object store (worker, SigV4 over fetch).
- **Gemini** (`@google/genai`): `gemini-2.5-flash` (text), `gemini-embedding-001` @768-dim L2-normalized (vectors), `imagen-4.0-fast-generate-001` (images). `GOOGLE_API_KEY`.

## Request → work split
Route handler does auth + validation + DB, then **enqueues a BullMQ job**; the worker processes it and writes status back; client subscribes via Supabase Realtime (content tables fall back to polling — Realtime unreliable there).

## Worker queues (`src/lib/queue.ts`; `Worker` instances in `worker/index.ts`)
| Queue | Processor | Purpose |
|---|---|---|
| `brand-research` | `processBrandResearch` | Gemini research → evidence + embeddings |
| `content-generation` | `processContentGeneration` | post body from brand+topic |
| `video-merge` | `processVideoMerge` | legacy Pexels+narration+music merge |
| `ffmpeg-compose` | `processFfmpegCompose` | ADR-002 12-agent video compose+QC |
| `creative-generation` | `processCreativeGeneration` | Imagen bg → validate → sharp composite → storage |
| `drive-sync` | `processDriveSync` | copy creative/video to user's Google Drive (Phase 3) |
| `publish` | `processPublish` | publish one `publish_job` to its destination (Phase 3, flag-gated) |

Plus two worker intervals (flag-gated, Redis-locked single-instance): **publish scheduler** (30s; `scheduled`→`queued` atomic claim) and **publish reaper** (5m; stuck `publishing`→`needs_review`). BullMQ: `attempts:2` default (publish uses `attempts:1`). **Custom jobIds must NOT contain `:`** → use hyphens.

## Intelligence loop (V2) — LIVE
research_runs/research_documents (pgvector 768 + HNSW + FTS, content-hash dedupe) → brand_topics (`source='evidence-mined'`, grounded_on) → content_items (status machine draft→in_review→approved/rejected→scheduled→published; status_history jsonb) → content_metrics (snapshots; engagement_rate frozen at write) → recommendations (`src/lib/recommendations.ts`, pure rule engine).

## Creative Orchestrator (`src/lib/creative/`) — LIVE, two-layer safety-first
- **hierarchy.ts** — pure engine; deterministic priority `founder_led > data_led > quote_led > brand_led`; blended confidence (display) `<0.55` forces brand_led.
- **brief.ts** `composeCreativeBrief` — ranks hierarchy + ONE Gemini concept call (asset *descriptions* only) → Zod `CreativeBrief` jsonb (source of truth: hierarchy, confidence, visual_tension, visual_metaphor, concept, headline/subheadline/cta, background_prompt, usage, palette). Background prompt guarded vs forbidden tokens → deterministic gradient fallback.
- **gemini.ts** — `generateCreativeConcept` (text incl. visual_tension/metaphor), `generateCreativeBackground` (Imagen, **background only**, no `seed`), `validateGeneratedBackground` (multimodal; ≤3 attempts then sharp fallback).
- **compositor.ts** — deterministic `sharp` **whitelist: resize/crop/circular-mask/position** + SVG typography + scrim. Platform-native px: LinkedIn 1200×627, FB 1200×630, X 1600×900, IG 1080×1350.
- **Safety invariants:** uploaded logo/headshot bytes are immutable, never sent to any model; Imagen = background only; compositor never enhances/recolors/regenerates; image-gen reachable only from an `approved` brief.

## Integrations framework (Phase 3, `src/lib/integrations/`) — branch only
- **registry.ts** — single provider lookup (`getProvider`/`getOAuthProvider`). **providers/{google-drive,linkedin,meta,meta-oauth,instagram}.ts** + **types.ts** (`ProviderDefinition` with optional hooks: `enumerateDestinations`, `refresh`, `revoke`, `exchangeToken`, `publish`, `uploadMedia`, `status`; `Destination`, `MediaSpec`, `PublishError{phase}`).
- **oauth.ts** — generic auth-code(+PKCE) build/exchange/refresh/revoke (`scopeSeparator`, `authParams` per provider).
- **accounts.ts** — sole reader/writer of `connected_accounts` (service-role + user_id filter); encrypt-at-rest, `getValidAccessToken` (refresh via provider hook or generic; rolls Meta anchor), `disconnectAccount`, `logIntegrationAudit` (deep token/JWT redaction).
- **encryption.ts** — AES-256-GCM, `INTEGRATIONS_ENC_KEY`, `v1.iv.tag.ct`, AAD `provider:userId`.
- **Routes:** `src/app/api/integrations/[provider]/{connect,callback,folders,destinations}` + `[provider]` DELETE + `/api/integrations` (list) + `/api/drive/save`. UI: `/settings/integrations` (Drive/LinkedIn/Meta cards, connect/disconnect/discover-destinations).
- **Ownership = `user_id`** (no workspace table). Secret-bearing tables (`connected_accounts`, `oauth_states`, `publishing_destinations`) are RLS-enabled with **no client policies** (service-role only).

## Publishing layer (Phase 3, branch only, flag-gated `PUBLISHING_ENABLED`)
`src/lib/publishing/{flags,jobs,lock}.ts` + `worker/processors/publish.ts` + `src/app/api/publish/{route,[id],health}`.
- `publish_jobs` = per-destination fan-out + denormalized destination snapshot + capped `attempts` jsonb; `publishing_destinations` = write-through cache (P3.1c discovery still authoritative).
- **At-most-once:** compare-and-set claim (`queued`→`publishing`) + `external_post_id` guard + `attempts:1`; failures classified `pre_send→failed` / `post_send|unknown→needs_review` (never auto re-post).
- **Scheduler** = DB atomic claim (no BullMQ delay) under a Redis lock; **reaper** recovers orphans; both single-instance.
- LinkedIn `publish()` (text + single image; personal + company; `/rest/posts`+`/rest/images`) is the only live publisher.

## Storage buckets (Supabase, public-read, service-role writes)
`merged-videos` (004) · `brand-assets` (017) · `content-creatives` (018). Renders/scene clips → Cloudflare R2 (`ottoflow-renders`).

## Video (ADR-002, separate branch, RAM-blocked)
12 FFmpeg agents (`src/lib/ffmpeg-pipeline/agents/01..12`). Video V1 adds a Seedance provider + `scene-generation` queue on `feat/ffmpeg-multi-agent-pipeline`. Known defect: `06-diversity.ts` lacks intra-video uniqueness → repeated footage. See [DECISIONS.md](DECISIONS.md).
