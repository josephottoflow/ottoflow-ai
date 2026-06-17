# ARCHITECTURE.md

How Ottoflow AI is built. Status/branches → [PROJECT_STATE](PROJECT_STATE.md); rationale → [DECISIONS](DECISIONS.md); env/release → [DEPLOYMENT](DEPLOYMENT.md).

## Topology
- **Web/API — Vercel** (Next.js 14 App Router): UI + `src/app/api/*`. All *synchronous* work — auth, DB, brief composition, enqueue.
- **Worker — Railway** (`worker/index.ts` → esbuild `worker/dist/index.js`, `npm run start:worker`): all *async/heavy* work via BullMQ.
- **Redis** — BullMQ broker (`REDIS_URL`), shared by app (enqueue) + worker (consume).
- **Supabase** — Postgres (RLS by Clerk JWT `sub` via `current_clerk_user_id()`), public Storage buckets, Realtime.
- **Clerk** auth (DEV keys in prod — debt). **Gemini** `gemini-2.5-flash` + `gemini-embedding-001`@768 L2 + **Imagen `imagen-4.0-fast-generate-001`** (`GOOGLE_API_KEY`).

## Request → work split
Route handler: auth + validation + DB, then **enqueue a BullMQ job** → worker processes → writes status to Postgres → client via Supabase **Realtime** (content tables poll ~2.5s; Realtime unreliable there).

## Queues (`src/lib/queue.ts`; `Worker` instances in `worker/index.ts`)
| Queue | Processor | Purpose |
|---|---|---|
| `brand-research` | processBrandResearch | Gemini research → evidence + embeddings |
| `content-generation` | processContentGeneration | post body from brand+topic |
| `video-merge` | processVideoMerge | legacy stock+narration+music merge |
| `ffmpeg-compose` | processFfmpegCompose | ADR-002 multi-agent compose + QC |
| `creative-generation` | processCreativeGeneration | Imagen bg → validate → sharp composite → storage |
| `scene-generation` *(Video V1, unmerged)* | processSceneGeneration | per-scene provider gen → R2 → enqueue ffmpeg-compose |

BullMQ `attempts:2`, exp backoff. **Custom jobIds must not contain `:`**; creative routes use `creative-${id}`.

## Intelligence loop (V2)
research_runs/research_documents (pgvector 768 + HNSW + FTS, content-hash dedupe) → brand_topics (`source='evidence-mined'`, opportunity_kind, grounded_on) → content_items (status machine draft→in_review→approved/rejected→scheduled→published; status_history jsonb) → content_metrics (snapshots, engagement_rate frozen at write) → recommendations (`src/lib/recommendations.ts`, pure rule engine per /analytics load).

## Creative Orchestrator (two-layer, safety-first) — `src/lib/creative/`
- **hierarchy.ts** — pure engine. Eligibility: `founder_led` needs a real `founder_headshot`; `data_led` a stat; `quote_led` a quote; `brand_led` always. Deterministic priority `founder_led > data_led > quote_led > brand_led`. Display confidence = 0.40 assets + 0.30 model + 0.20 opportunity + 0.10 platform; `<0.55` forces brand_led.
- **brief.ts** `composeCreativeBrief` — ranks hierarchy + ONE Gemini concept call (asset *descriptions* only) → Zod `CreativeBrief` (jsonb, source of truth): hierarchy, confidence(+components), **visual_tension, visual_metaphor**, visual_concept/rationale, headline, subheadline, cta, background_prompt, logo/headshot/company/founder/expert usage, aspect_ratio, palette. Background prompt passes a forbidden-token guard (logos/text/faces) with a deterministic fallback.
- **gemini.ts** — generateCreativeConcept (text), generateCreativeBackground (Imagen, **background only**, in-prompt negatives, **no `seed`**), validateGeneratedBackground (multimodal reject text/logo/face, ≤3 attempts → deterministic gradient fallback, `background_source='imagen'|'fallback'`).
- **compositor.ts** — deterministic `sharp`. Layer stack: bg(Imagen) → [Phase 2A: color grade → motif] → scrim → headshot → logo → typography. **Whitelist on locked assets: resize/crop/circular-mask/position** only. Platform-native px: LinkedIn 1200×627, FB 1200×630, X 1600×900, IG 1080×1350.

### Visual Tension + Metaphor engine (P4 Phase 1, live)
Topic → `visual_tension` (e.g. "Chaos vs Clarity") → `visual_metaphor` → `background_prompt` → Imagen. Reused by both image and (Video V1) scene planning. Brand Color pipeline: palette (primary/secondary/accent/neutral) drives Imagen prompt + scrim + CTA + accents.

### Safety invariants (enforced)
Uploaded logo/headshot bytes are immutable, **never sent to any AI model** (concept gets text only; worker downloads bytes solely for the deterministic compositor). Imagen = background only. Compositor = resize/crop/mask/position only. `brand_assets.locked=true`. Image generation reachable **only** from an `approved` brief.

## Phase 2A — Brand Pattern Library (built, unmerged) — `src/lib/creative/`
Per-brand DNA `brand_patterns` (migration 023) consumed deterministically by the compositor — **AI stays brand-neutral; identity is stamped deterministically** (extends the two-layer doctrine):
- **types.ts** `brandPatternSchema`: color_dna (recomb 3×3 + modulate + duotone), composition_dna (template), motif_dna (family/opacity/scale/placement/blend), typography_dna, energy/spacing/framing_dna, do_not_use.
- **motifs.ts** — 5 parametric SVG families (interlocking_hub/diagonal_bars/orbital_dots/fine_grid/mono_line), palette-injected.
- **composition-templates.ts** — 5 spatial templates (center_convergence/diagonal_precision/orbital_growth/grid_authority/open_canvas); `getTemplateLayout(template,hierarchy)` → layout = template(brand) × hierarchy(content).
- **brs.ts** `computeBRS` — diagnostic recognition score. `creative-generation.ts` loads the active pattern (try/catch→null = backward-compatible), passes it to the compositor, writes BRS + `brand_pattern_version`.

## Video V1 (Seedance → FFmpeg, built, unmerged) + ADR-002
- **video-providers/** registry chain `Seedance → Runway → Luma → Pexels`; `SeedanceProvider` (BytePlus Ark: create→poll task→`content.video_url`, params as `--key value` text suffixes).
- **ffmpeg-pipeline/** orchestrator: Agents 1–10 (route) freeze a `CompositionPlan`; Agents 11 (compose) + 12 (QC) run in the worker. `buildAiFirstPlan` builds the plan from Seedance scenes (reuses tension/metaphor → problem/tension/solution/outcome). `ffmpeg.ts` = low-memory **multi-pass** (normalize each scene → concat → captions/logo/CTA → encode; hard cuts at 1 GB, xfade needs ≥4 GB). `branding.ts` = deterministic sharp CTA card + logo overlay. Prod gotchas: input `-r` for CFR (xfade), `fps` after `setpts`, `-threads 2` (OOM).

## Storage buckets (public-read, service-role writes)
`merged-videos` (004) · `brand-assets` (017) · `content-creatives` (018) · R2 `ottoflow-renders` (video, off Supabase).

## Key paths
`worker/index.ts`, `worker/processors/*`, `src/lib/queue.ts`, `src/lib/gemini.ts`, `src/lib/creative/{types,hierarchy,brief,compositor,motifs,composition-templates,brs}.ts`, `src/lib/ffmpeg-pipeline/*`, `src/lib/video-providers/*`, `src/lib/recommendations.ts`, `src/lib/db.ts`, `src/lib/supabase.ts`, `src/app/api/content/[id]/creative`, `src/app/api/creatives/[id]/{review,regenerate}`, `src/components/{CreativePanel,BrandAssets}.tsx`, `scripts/phase2a-acceptance.local.ts`.
