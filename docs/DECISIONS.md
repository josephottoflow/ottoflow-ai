# DECISIONS.md

Current decisions only. Superseded/abandoned approaches are noted as such in one line, not expanded.

## Video composition: FFmpeg, not Remotion
- **ADR-001 proposed Hybrid Remotion** — **REVERSED.** Remotion+Chrome was actually built and OOM-failed at ~800 MB on the 1 GB Railway worker (six hardening commits). That failure caused the pivot.
- **ADR-002 (current): FFmpeg 12-agent pipeline.** Smarter selection/pacing/QC before a single ffmpeg filter graph (zoompan + xfade). Render still blocked only by the 1 GB RAM cap (needs the 2 GB Hobby bump).
- Validation (`VIDEO_PIPELINE_VALIDATION.md` + `REMOTION_SPIKE_REPORT.md`): last real render = 4 scenes → **2 unique clips** (no intra-video dedup in `06-diversity.ts`). Recommendation **A: keep FFmpeg**, add the cheap intra-video dedup fix; do NOT re-adopt Remotion (heavier, RAM-marginal, reverses ADR-002 without new evidence).

## Creative Orchestrator
- **Two-layer, safety-first.** AI does strategy + background ONLY. Uploaded brand assets are locked, immutable, and **never touch a model**; they're composited deterministically with `sharp` (resize/crop/mask/position whitelist). Rationale: brand-asset integrity is non-negotiable; faces/logos are never synthesized.
- **Approval gate before Imagen.** A human approves the Creative Brief before any image-generation spend; `generating` is reachable only from `approved`.
- **Deterministic hierarchy priority** `founder_led > data_led > quote_led > brand_led` (not score-ranked) — predictable, explainable. Scores remain only for the confidence display. `<0.55` blended confidence forces `brand_led`.
- **Creative Brief jsonb is the source of truth**; `creative_hierarchy` + `creative_confidence` denormalized onto the row for attribution (answers best-hierarchy per brand/platform).
- **Platform-native pixel dimensions** (1200×627 / 1200×630 / 1600×900 / 1080×1350) — creatives must look made for the platform, not generic squares.
- **Branding overrides** (company/founder/expert name + use-logo/use-headshot) captured on /content/generate, persisted on the content item (migration 019), consumed by the brief.

## Platform / infra
- **Migrations-first deploy order.** When code writes a new column, apply the migration BEFORE pushing (else routes 500). Applied via the Supabase dashboard SQL editor (`monaco.editor.getEditors()[0].setValue(sql)` + Ctrl+Enter; confirm the additive "destructive operation" modal from DROP-IF-EXISTS guards). No CLI/DDL token exists on the machine.
- **BullMQ custom jobIds: no `:`.** BullMQ throws `Custom Id cannot contain :`. Use hyphens (`creative-${id}`). (Defect `72dcd50`.)
- **Imagen: no `seed` config.** `generateImages` rejects it ("seed parameter is not supported"); text `generateContent` accepts it. Variation comes from each brief's distinct prompt. (Defect `eca3456`.)
- **sharp on Vercel: don't depend on it loading.** The brand_assets upload route validates by **magic bytes** (authoritative) and reads dimensions via a *lazy, non-fatal* `await import("sharp")` — Vercel's build cache repeatedly shipped a node_modules without the linux binary, so module-scope `import sharp` 500'd the route. Also keep `serverExternalPackages:["sharp"]` + the `@img/sharp-linux-x64` lockfile entry. (Worker on Railway runs sharp fine.)
- **Embeddings:** `gemini-embedding-001` @ `outputDimensionality:768`, L2-normalized (text-embedding-004 404s on this key).
- **"Videos Rendered" KPI** counts only `merged_video_url IS NOT NULL` (status='done' over-counts planning completions).
- **Verify from real state (git/API/DB), never assertions.** Repeated "Railway is upgraded / tokens were added" reports were all false on inspection; trust the billing page / `git status` / DB catalog.

## Standing constraints
Commits authored `josephottoflow` + `Co-Authored-By: Claude`. Never `git add -u`/`git add .` (sweeps DO-NOT-COMMIT stragglers: `docs/BETA_READINESS_SPRINT.md`, `docs/LAUNCH_CHECKLIST.md`, `docs/SESSION_*`, `docs/PHASE_1A_*`, `scripts/*.local.*`) — stage explicit paths. Local `next build` fails at env collection (expected; Vercel has env). Local gates before deploy: `npx tsc --noEmit` (ignore the 2 known untracked-script errors) + `npm run build:worker`.
