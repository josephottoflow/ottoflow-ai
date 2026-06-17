# PROJECT_STATE.md

Current truth for Ottoflow AI (`ottoflow-ai/`). Companions: [ARCHITECTURE](ARCHITECTURE.md) (how) · [DECISIONS](DECISIONS.md) (why) · [OPEN_TASKS](OPEN_TASKS.md) (what's left) · [DEPLOYMENT](DEPLOYMENT.md) (how to ship). Date: 2026-06-17.

## What it is
SaaS "AI Content Operating System": pick brand + topic + platform → generate a post **and** a brand-aligned, topic-driven creative image. North star = self-improving loop: research → evidence → opportunity → content → creative → review → publish → metrics → attribution → recommendations.

## Live in production (verified)
- App `https://ottoflow-ai.vercel.app`; Vercel + Railway worker both deploy from `main` = `5753f5b`.
- **Full content + creative-image loop is LIVE.** Tension/metaphor engine → Imagen background → deterministic sharp composite (logo/headshot/CTA/headline) → ready. Palette-driven (no Ottoflow-purple), deterministic gradient fallback, `/content/generate` workspace persisted in localStorage.
- Upstream loop live: research/evidence (pgvector RRF), opportunity mining, review queue, publisher (manual mark-published), metrics ingestion, recommendations.
- **Migrations 001–022 applied to prod** (022 = Video V1 schema, applied + verified). **023 (brand_patterns) NOT applied anywhere.**
- Railway billing resolved (Hobby); worker active.

## Built but NOT deployed (local branches, unpushed)
| Branch | HEAD | Contents |
|---|---|---|
| `feat/ffmpeg-multi-agent-pipeline` | `778bc39` | **Video V1** (8 commits) + Phase 2A (3) + docs (1) — 12 ahead of main |
| `staging/brand-pattern-2a` | `2aadf65` | **Phase 2A only** (cherry-picked, **zero Video V1**) — 3 ahead of main; current branch |
| stash@{0} | — | 3 pre-existing doc/type stragglers |

Both branches `tsc --noEmit` + `build:worker` green; neither pushed.

### Video V1 (Seedance → FFmpeg) — code-complete, validation-pending (NOT build-pending)
Seedance scene generator (registry provider) + `scene-generation` queue + AI-first orchestrator + FFmpeg multi-pass compose + deterministic branding/CTA — all wired end-to-end, stub-free, `tsc`+`build:worker` green. **No engineering left to build**; gating is provisioning + one live validation. Never run live.
- **Infra blockers:** Railway worker **2 GB RAM** (FFmpeg OOMs ~1 GB); `SEEDANCE_API_KEY`/`SEEDANCE_MODEL`/`SEEDANCE_BASE_URL`; **all five `R2_*` MANDATORY** (scene-gen durability gate hard-fails without `storage_url` — no Drive fallback, unlike compose). V1 ships **silent** (route omits narration/music); **no per-render cost ceiling** (only 20/hr rate limit).
- **Legal/commercial NO-GO** (separate track): BytePlus output ownership + commercial-resale rights **unverified**; AUP **competing-offering** clause unresolved for a video-gen SaaS; official pricing/billing **unconfirmed** (market moved to Seedance 1.5/2.0; default model id `seedance-2-0-t2v`, contract unproven live). Needs **written vendor confirmation** before customer-facing use.
- **Highest-value next engineering task:** one live `createTask`→`pollTask` against the operator's real model/region to verify the Ark contract (`content`-array `--` suffixes, create `id`, `content.video_url`) — the only unproven assumption.

### Phase 2A — Brand Pattern Library (deterministic image identity) — built, gated
Per-brand DNA (`brand_patterns`) drives a deterministic compositor layer (color grade + motif overlay + composition template) + BRS scoring. Goal: a creative reads as the brand with the logo removed. Acceptance harness `scripts/phase2a-acceptance.local.ts` implemented + corrected (motif@production-opacity, typography excluded from gate, fallback exclusion, 3-way attribution + same-brand coherence, two-arm rollout gate). **NOT READY to run** — no staging env, migration 023 unapplied, no pilot Basecamp brand/patterns, Imagen access on a staging key unverified.

## Hard constraints / gotchas
- **No separate staging env exists.** Supabase `ddozknywcdpyfdokmfrp` ("ottoflow-staging") **is the live prod DB**.
- Imagen 3.0 retired → **`imagen-4.0-fast-generate-001`** only.
- Clerk still on **DEV keys** (operator-gated).
- DDL path = Supabase dashboard SQL editor (no CLI/management token on the machine).
- sharp native unreliable on Vercel → upload route uses magic-byte validation + lazy `await import("sharp")`; worker runs sharp fine.

## Next
See [OPEN_TASKS.md](OPEN_TASKS.md). Highest-leverage near-term: provision staging → run Phase 2A acceptance test (validate logo-free brand recognition).
