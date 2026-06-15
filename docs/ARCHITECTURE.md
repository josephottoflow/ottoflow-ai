# ARCHITECTURE.md

## Topology
- **Web/API — Vercel** (Next.js 14 App Router). UI + `src/app/api/*` route handlers. All *synchronous* work (auth, DB reads/writes, brief composition, enqueue jobs).
- **Worker — Railway** (`worker/index.ts`, bundled by esbuild → `worker/dist/index.js`, run via `npm run start:worker`). All *async/heavy* work via BullMQ.
- **Redis** — BullMQ broker (`REDIS_URL`). Shared by app (enqueue) + worker (consume).
- **Supabase** — Postgres (RLS scoped by Clerk JWT `sub` via `current_clerk_user_id()`), Storage (public buckets), Realtime.
- **Clerk** — auth (DEV keys in prod — known debt).
- **Gemini** (`@google/genai`): `gemini-2.5-flash` (text), `gemini-embedding-001` @ 768-dim L2-normalized (vectors), `imagen-3.0-fast-generate-001` (images). `GOOGLE_API_KEY`.

## Request → work split
Route handler does auth + validation + DB, then **enqueues a BullMQ job**; the worker processes it and writes status back to Postgres; the client subscribes via Supabase **Realtime** (content tables fall back to polling — Realtime unreliable there).

## Worker queues (`src/lib/queue.ts`, 5 `Worker` instances in `worker/index.ts`)
| Queue | Processor | Purpose |
|---|---|---|
| `brand-research` | `processBrandResearch` | Gemini research → evidence + embeddings |
| `content-generation` | `processContentGeneration` | Post body from brand+topic |
| `video-merge` | `processVideoMerge` | legacy Pexels+narration+music ffmpeg merge |
| `ffmpeg-compose` | `processFfmpegCompose` | ADR-002 12-agent video compose+QC |
| `creative-generation` | `processCreativeGeneration` | Imagen bg → validate → sharp composite → storage |

BullMQ: `attempts:2`, exp backoff. **Custom jobIds must NOT contain `:`** (BullMQ throws) — creative routes use `creative-${id}`.

## Intelligence loop (V2)
research_runs/research_documents (pgvector 768 + HNSW + FTS, content-hash dedupe) → brand_topics (`source='evidence-mined'`, opportunity_kind, grounded_on) → content_items (status machine: draft→in_review→approved/rejected→scheduled→published; status_history jsonb audit) → content_metrics (snapshots; engagement_rate frozen at write) → recommendations (`src/lib/recommendations.ts`, pure rule engine recomputed per /analytics load).

## Creative Orchestrator (two-layer, safety-first)
`src/lib/creative/`:
- **hierarchy.ts** — pure engine. Eligibility: `founder_led` needs a real `founder_headshot`; `data_led` needs a stat signal; `quote_led` needs a quoted line; `brand_led` always. Selection is **deterministic priority** `founder_led > data_led > quote_led > brand_led` (not score-ranked). Confidence (display) = 0.40 assets + 0.30 model + 0.20 opportunity + 0.10 platform; `<0.55` forces brand_led.
- **brief.ts** `composeCreativeBrief` — ranks hierarchy + ONE Gemini concept call (gets asset *descriptions* only). Outputs Zod-validated `CreativeBrief` (jsonb, source of truth): hierarchy, confidence(+components), visual_concept, visual_rationale, headline, **subheadline**, cta, background_prompt, logo/headshot/company/founder/**expert** usage, aspect_ratio, platform, palette. Background prompt validated against forbidden tokens (logos/text/faces) with deterministic fallback. Accepts per-creative `branding` overrides.
- **compositor.ts** — deterministic `sharp`. **Whitelist only: resize / crop / circular-mask / position** + SVG typography (headline/subheadline/CTA/wordmark/founder+expert credit) + legibility scrim on the generated bg. **Platform-native px:** LinkedIn 1200×627, Facebook 1200×630, X 1600×900, Instagram 1080×1350.
- **gemini.ts** — `generateCreativeConcept` (text), `generateCreativeBackground` (Imagen, **background only**, in-prompt negatives, **no `seed`**), `validateGeneratedBackground` (multimodal reject text/logo/face, ≤3 attempts).

### Safety invariants (enforced)
Uploaded logo/headshot bytes are **immutable**, **never sent to any AI model** (concept call gets text descriptions; worker downloads bytes only for the deterministic compositor). Imagen = background only. Compositor = resize/crop/mask/position only — never enhance/recolor/stylize/regenerate. `brand_assets.locked=true` always. Gate: image generation reachable **only** from an `approved` brief.

## Storage buckets (public-read, service-role writes)
`merged-videos` (004) · `brand-assets` (017) · `content-creatives` (018).

## Key paths
`worker/index.ts`, `worker/processors/*`, `src/lib/queue.ts`, `src/lib/gemini.ts`, `src/lib/creative/{types,hierarchy,brief,compositor}.ts`, `src/lib/recommendations.ts`, `src/lib/db.ts`, `src/lib/supabase.ts` (admin), `src/app/api/content/[id]/creative`, `src/app/api/creatives/[id]/{review,regenerate}`, `src/components/{CreativePanel,BrandAssets}.tsx`.

## Video (ADR-002, RAM-blocked)
12 agents (`src/lib/ffmpeg-pipeline/agents/01..12`): strategist→script→scene-planner→multi-source-search→analysis→diversity→consistency→caption→timing→editor→ffmpeg-composer→QC. Known defect: `06-diversity.ts` penalizes only *cross-job* reuse (asset_history) — **no intra-video uniqueness** → repeated footage (see [DECISIONS.md](DECISIONS.md)).
