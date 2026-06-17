# DECISIONS.md

Current decisions only. Superseded approaches noted in one line, not expanded.

## Video composition: FFmpeg, not Remotion (ADR-002)
- **ADR-001 Hybrid Remotion — REVERSED** (Remotion+Chrome OOM'd at ~800 MB on the 1 GB worker).
- **ADR-002 (current): FFmpeg multi-agent pipeline.** Smart selection/pacing/QC before a low-memory **multi-pass** filtergraph (normalize→concat→captions/branding→encode). Hard cuts at 1 GB; xfade needs ≥4 GB. Render gated only by the 2 GB RAM bump. Prod gotchas: input `-r` for CFR (xfade), `fps` after `setpts`, `-threads 2`.
- Known defect: `06-diversity.ts` has no intra-video dedup → repeated footage (cheap greedy-distinct fix deferred).

## Video generation: Seedance is a PROVIDER, not a renderer (ADR-003)
- **Seedance generates brand-neutral scenes only; FFmpeg remains the sole compositor; branding stays deterministic.** Seedance slots into the existing `VideoProvider` registry (`Seedance → Runway → Luma → Pexels`) — additive, no rewrite of orchestrator/queues/composer.
- **Ark contract:** params (`--ratio --resolution --duration --seed`) are **text suffixes inside a `content` array**, not flat JSON; poll task → `content.video_url`; status queued/running/succeeded/failed/cancelled. Base URL + model id are account/region-specific (env).
- **AI-first path** reuses the live tension/metaphor engine → problem/tension/solution/outcome scenes. Narration **optional** in V1 (silent launch acceptable). Scene clips copied to **R2 immediately** (provider URLs expire ~1 h); a render with no durable R2 URL **fails fast** (no expiring URL into compose) → **R2 is mandatory for Video V1** (no Drive fallback).
- **Status: code-complete, validation-pending — NOT build-pending.** All Video V1 code is wired + build-green; nothing left to build. The Ark contract above is verified on paper only; the one gating engineering action is a **single live `createTask`→`pollTask`** to confirm `id` + `content.video_url` + the `--`-suffix shape against the operator's real model/region.

## Seedance commercial/legal: NO-GO until written vendor confirmation (separate from engineering)
- **Verified (official BytePlus docs):** AUP bars use to "create a … offering … directly or indirectly competing with … BytePlus"; the general ToS does **not** grant the user ownership of generated output and grants BytePlus a perpetual license over uploaded inputs. No ModelArk-specific SLA located.
- **Unverified (no official numbers / no written vendor response):** output ownership, commercial-resale permission, applicability of the competing-offering clause to Ottoflow, official pricing + billing unit (per-second vs per-minute). Market moved to Seedance **1.5/2.0**; the default model id `seedance-2-0-t2v` is unproven live.
- **Decision:** a paid, customer-facing video product is **NOT authorized** on Seedance until BytePlus confirms in writing (a) commercial rights to output, (b) resale permitted, (c) competing-offering clause N/A, (d) official pricing/billing. Engineering fit is strong; the block is purely commercial/legal verification.

## Creative Orchestrator
- **Two-layer, safety-first.** AI = strategy + background only; uploaded assets are locked, immutable, **never sent to a model**; composited deterministically with `sharp` (resize/crop/mask/position whitelist). Imagen = **`imagen-4.0-fast-generate-001`** (3.0 retired), background only, **no `seed`**, multimodal-validated, deterministic gradient fallback (`background_source`).
- **Approval gate before Imagen** (`generating` only from `approved`).
- **Deterministic hierarchy priority** `founder_led > data_led > quote_led > brand_led` (not score-ranked); scores only feed the confidence display; `<0.55` forces `brand_led`.
- **Creative Brief jsonb = source of truth**; `creative_hierarchy`/`creative_confidence` denormalized for attribution. **Platform-native px** (1200×627 / 1200×630 / 1600×900 / 1080×1350).

## Brand identity: deterministic-first (Phase 2A — Brand Pattern Library)
- **Brand identity is STAMPED deterministically (FFmpeg/sharp), never delegated to the stochastic generator.** AI produces brand-neutral material; per-brand DNA (`brand_patterns`, migration 023) drives color grade + motif overlay + composition template + typography in the compositor. Goal: recognizable with the logo removed.
- **Implementation weighting follows the doctrine:** recognition-critical, exactly-specifiable dimensions (color/type/transition/motif/composition) are deterministic; semantic ones (worldview/metaphor) stay prompt-side. Prompt-injected identity is a bonus, not the backbone.
- **Honest ceilings:** system fonts cap typography identity (needs brand-font upload); abstract metaphor backgrounds have a lower recognition ceiling than branded imagery.

## Phase 2A acceptance experiment (corrected, frozen)
- **Automated gate = NECESSARY, not sufficient.** Rollout requires the pre-screen **AND** human recognition (3-way blind attribution ≥67% + same-brand coherence ≥70%).
- **Isolate the BPL:** identical topic/tension/metaphor/copy across brands; vary only brand_id/brand_colors/active pattern. Metrics computed on a common neutral reference (z0-independent) + decomposed into grade/motif/template/typography + a BPL Signal Ratio.
- **Fixes baked in:** motif scored at **production opacity under a scrim** (no false-pass on invisible motifs); **typography excluded** from the gated `isolated` score (no false-fail from the shared-font ceiling); **fallback-backed renders excluded** (controls the Imagen-fallback confound); 3 brands → **3 descriptors**. z0 cannot be eliminated within scope → controlled via fallback exclusion + same-brand coherence + the ratio.

## Platform / infra
- **Migrations-first deploy.** Apply the migration (Supabase dashboard SQL editor; confirm the additive "destructive operation" modal from DROP-IF-EXISTS guards) **before** pushing code that writes the column. No CLI/DDL token on the machine.
- **BullMQ custom jobIds: no `:`** (use `creative-${id}`).
- **sharp on Vercel: don't depend on it loading** — upload route validates by magic bytes + lazy `await import("sharp")`; keep `serverExternalPackages:["sharp"]` + `@img/sharp-linux-x64` lockfile entry. Worker runs sharp fine.
- **Embeddings:** `gemini-embedding-001` @768, L2-normalized.
- **"Videos Rendered" KPI** counts only `merged_video_url IS NOT NULL`.
- **No fabricated results, ever.** Acceptance/validation numbers come only from real runs; verify from git/API/DB, never from assertions (repeated "it's deployed/upgraded" claims proved false on inspection).

## Standing constraints
Commits authored `josephottoflow` + `Co-Authored-By: Claude`. **Never `git add -u`/`git add .`** (sweeps DO-NOT-COMMIT stragglers: `docs/BETA_READINESS_SPRINT.md`, `docs/LAUNCH_CHECKLIST.md`, `docs/SESSION_*`, `docs/PHASE_1A_*`, `scripts/*.local.*`) — stage explicit paths. Local gates before deploy: `npx tsc --noEmit` (ignore the 2 known untracked-script errors) + `npm run build:worker`. Local `next build` fails at env collection (expected).
