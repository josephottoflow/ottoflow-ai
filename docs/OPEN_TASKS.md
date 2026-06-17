# OPEN_TASKS.md

Current open work, priority-ordered. Status → [PROJECT_STATE](PROJECT_STATE.md). Bands: P0 Reliability · P1 Research · P2 Opportunities · P3 Content · P4 Creatives · P5 Publishing · P6 Analytics · P7 Recs · P8 UX.

## P0 — Reliability
- **Clerk DEV → prod keys** (operator-gated). Live app still runs `pk_test_`/`sk_test_`.
- Re-upload a **valid Basecamp founder headshot** (asset `cfdfc277` is a corrupt PNG; compositor skips it cleanly, but founder_led creatives show no face).

## P4 — Creatives (active): Phase 2A — Brand Pattern Library
Built on `staging/brand-pattern-2a` (unmerged). To validate logo-free brand recognition:
1. Provision **staging** (separate Supabase + dedicated Redis + worker on the branch) — none exists today. Fill `.env.staging` from **`.env.staging.example`** (refuses the prod ref).
2. Apply migrations **001→021→023** on staging (skip 022 = Video V1).
3. Create 3 pilot brands incl. **`Basecamp`** (fresh staging has none) + `brand_colors` + activate 3 `brand_patterns` — one paste of **`scripts/phase2a-staging-setup.sql`** (verifies `active_patterns=3`).
4. Verify staging `GOOGLE_API_KEY` yields `background_source='imagen'` (not fallback).
5. Pass the preflight (PHASE_2A_STAGING_RUNBOOK) → `npx tsx --env-file=.env.staging scripts/phase2a-acceptance.local.ts run` → ≥5 reviews → `ingest`.
6. On GO: apply 023 to prod + merge Phase 2A only (cherry-pick is file-disjoint from Video V1).
- Later: brand-font upload (typography DNA), AI-derived DNA.

## Video V1 (Seedance → FFmpeg) — code-complete on `feat/…`, validation-pending (nothing to build)
1. **Legal gate (separate track, operator):** get **written BytePlus confirmation** — (a) Ottoflow owns/commercially licenses the output, (b) resale to paying customers permitted, (c) AUP **competing-offering** clause doesn't apply, (d) official pricing + billing unit. NO-GO to customer-facing use until cleared.
2. **Highest-value engineering task:** one live `createTask`→`pollTask` against the operator's real `SEEDANCE_MODEL`/`SEEDANCE_BASE_URL` → verify the Ark contract (`content`-array `--` suffixes, create `id`, `content.video_url`). The only unproven assumption.
3. **Infra:** Railway worker **2 GB RAM** (FFmpeg OOMs ~1 GB); set `SEEDANCE_API_KEY`/`SEEDANCE_MODEL`/`SEEDANCE_BASE_URL`; **all five `R2_*` MANDATORY** (durability gate hard-fails without `storage_url`).
4. First live `POST /api/video/generate` (Basecamp/LinkedIn, 4-scene, **silent**) → validate Seedance→R2→FFmpeg→MP4. Don't expose the UI trigger in prod until this passes.
- Deferred defect: `ffmpeg-pipeline/agents/06-diversity.ts` has no intra-video dedup → repeated footage (~30-line greedy distinct fix). Re-enable xfade once ≥4 GB.

## P5 — Publishing
- LinkedIn / X API publishing (design staged: `platform_connections` + worker auto-publish; operator creates the app + sets `LINKEDIN_CLIENT_ID/SECRET`). Today: manual mark-published.

## P6/P7 — Analytics / Recs
- Metrics automation once platform APIs exist (same `content_metrics` snapshot contract).
- Recommendation deep-links + write-back to `brands.creative_preferences`.

## P8 — UX backlog
Drag-and-drop asset uploader w/ preview; backfill asset `width/height` (null on Vercel uploads — worker fills); migrate inline `rgba()/hex` → design tokens; resolve "Projects (SOON)" dead nav; mobile pass on dense tables.

## Deploy hygiene
- Phase 2A (clean, file-disjoint) can merge to main independently of unvalidated Video V1. Do **not** ship the video UI trigger to prod until Video V1 is validated.

## Known debt (non-blocking)
Clerk DEV keys · hydration #418 · 2 untracked scripts (`create-sentry-alert-rules.ts`, `list-models.local.ts`) cause the only `tsc` errors — harmless, don't commit/fix.
