# Brand Creative Planning — `/content/generate`

**Objective:** every generated post immediately produces a reviewable, brand-aligned **creative strategy** — before any image is rendered. Worker / Imagen / compositing / storage are **Phase C, explicitly deferred**. Everything below runs **synchronously on Vercel** and works with the Railway worker offline.

Date: 2026-06-15 · Branch: `feat/ffmpeg-multi-agent-pipeline` · Gates: `tsc` clean (except the 2 known untracked scripts), `build:worker` clean.

## What changed in this pass
| # | Spec item | Change | Files |
|---|---|---|---|
| 1 | Strategy appears **immediately** | Brief auto-composes once on panel mount when the post is ready and no creative exists (one Gemini concept call, no image cost). Manual "Generate Creative" remains as a fallback. | `CreativePanel.tsx` |
| 4/5 | Creative preview + **brand color system** | Added a palette-swatch row; when no brand colors are configured shows *"Brand colors not configured. Creative will use a fallback palette."* | `CreativePanel.tsx` |
| 6 | **Asset readiness** | New block: Logo ✓/Missing · Founder Headshot ✓/Missing, plus the four hierarchies with lock/unlock state (and which one was chosen). Backed by a new `assets_available` field on the brief. | `types.ts`, `brief.ts`, `CreativePanel.tsx` |
| 7 | **Approval works offline** | Approval no longer rolls back when the BullMQ enqueue fails. The creative stays `approved`, the deferral is recorded on `status_history`, and the response flags `generationDeferred`. | `review/route.ts` |
| 7 | Honest `approved` UI | `approved` renders a calm "Strategy approved & locked — image is a separate later step" state; the spinner is reserved for `generating` (worker actually working). | `CreativePanel.tsx` |

Already present from prior Deltas (verified, unchanged): hierarchy + confidence + components, visual concept/rationale, headline/subheadline/CTA, company/founder/expert name usage, logo/headshot placement, platform format; branding controls (company/founder/expert names + use-logo/use-headshot) on the form; the brand-alignment concept prompt already forbids generic stock and requires a *why-this-brand/idea/platform* rationale.

## End-to-end workflow (Vercel-only)
```
Research a brand ─▶ mine opportunities ─▶ pick an idea (brand_topic)
        │
        ▼
/content/generate
  • brand + idea + platforms + extra direction
  • branding controls: company / founder / expert names, use-logo, use-headshot
        │  POST /api/content/generate  → content_generation job (worker writes the post body)
        ▼
Post body ready (per platform card)
        │  CreativePanel auto-fires once:
        ▼
POST /api/content/[id]/creative   (synchronous, Vercel, ~5–15s)
  1. rankHierarchies()  — pure code: eligibility + scores
  2. generateCreativeConcept()  — ONE Gemini call (asset DESCRIPTIONS only, never bytes)
  3. background-prompt safety validation (forbidden tokens → fallback)
  4. confidence < 0.55 → force brand_led
  5. code computes logo/headshot/name usage + assets_available
  → inserts content_creatives row, status = brief_ready
        │
        ▼
CREATIVE APPROVAL GATE  (rendered beneath the post)
  hierarchy · confidence (+components) · concept · rationale · headline ·
  subheadline · CTA · company/founder/expert usage · logo/headshot placement ·
  asset readiness · brand colors · platform format
        │
        ├─ Reject ─▶ status = rejected  (archived; compose a fresh one)
        └─ Approve ─▶ POST /api/creatives/[id]/review
                        status = approved   (DB write — ALWAYS succeeds)
                        try enqueue creative-generation job
                          ├─ worker online  → job queued → [Phase C]
                          └─ worker OFFLINE → enqueue fails, NO rollback;
                             status stays approved, deferral logged,
                             generationDeferred:true returned
        ─────────────────────── Phase C boundary (deferred) ───────────────────────
                        approved ─▶ generating ─▶ ready  (Imagen + sharp + storage)
```

## Data flow
```
brands(positioning, voice, brand_colors, creative_preferences)┐
brand_topics(title, hook_angle, opportunity_kind, category) ──┤
content_items(title, preview, body, platform, creative_branding)┤
brand_assets(logo, founder_headshot — descriptions only) ─────┤
                                                              ▼
                                            composeCreativeBrief()
                                   ┌────────────┴─────────────┐
                          rankHierarchies()           generateCreativeConcept()
                          (pure code, 0.40 assets      (Gemini: concept, rationale,
                           +0.20 opp +0.10 platform)    headline, subheadline, cta,
                                   │                     background_prompt)
                                   └────────────┬─────────────┘
                                                ▼
                                   CreativeBrief (Zod-validated jsonb)
                                                ▼
                                content_creatives row (brief_ready)
                                  • creative_brief (source of truth)
                                  • creative_hierarchy, creative_confidence (denormalized → attribution)
                                                ▼
                                       CreativePanel (the gate)
```
**Safety invariant (unchanged):** uploaded logo/headshot bytes never reach any AI model — the concept call receives text descriptions only; the bytes are touched only by the deterministic sharp compositor in Phase C.

## Success criteria — met (Vercel-only)
A user generating a post immediately sees, without any image rendered:
- **what** image should be created → visual concept + headline/subheadline/CTA + background intent
- **why** it matches → visual rationale (brand · idea · platform), confidence + components
- **how branding is used** → logo/headshot placement, company/founder/expert name usage, asset readiness
- **which hierarchy** → chosen + the unlocked/locked set with reasons
- **what dimensions** → platform-native format (LinkedIn 1200×627 · FB 1200×630 · X 1600×900 · IG 1080×1350)

…and can **approve the strategy independently of image generation** — approval succeeds with Railway offline.

## Remaining worker-only tasks (Phase C — deferred until Railway funded)
1. `creative-generation` BullMQ processor: Imagen background → multimodal validation → sharp composite (logo+headshot byte-identical) → Storage upload → `ready`.
2. Reconciliation for **deferred approvals**: when the worker returns, (re)start generation for creatives sitting in `approved` with no live job — a "Generate image" action on the approved card (idempotent jobId `creative-${id}`) is the intended trigger.
3. Backfill asset `width/height` (null on Vercel uploads — sharp doesn't load there; the worker fills it).
4. Per-hierarchy compositor layout tuning once images are visible.

(See [OPEN_TASKS.md](OPEN_TASKS.md) for the broader sequence and the Railway funding blocker.)

## Screenshots
Not captured in this pass — the new UI states require a deployment to exercise (the changes are committed locally, not pushed). Once deployed to `ottoflow-ai.vercel.app`, capture: (a) auto-composing state, (b) the full gate with asset-readiness + palette, (c) the "brand colors not configured" warning on a brand with no colors, (d) the calm `approved` deferred state. The planning flow itself needs no worker, so these are all reproducible on Vercel alone.
