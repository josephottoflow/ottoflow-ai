# Creative Studio — Backend Design Proposal (SPEC ONLY — awaiting approval)

**Status:** Proposal. **Nothing here is implemented.** No table, column, endpoint,
or `src/lib` file has been changed. Per the operator directive, backend work
begins only after explicit approval of this document.

**Author context:** Premium UX initiative, Phases 1–7 shipped as UI-only commits
on `feat/caption-engine-v1`. The client-only slice of Creative Studio (Prompt
Studio: editable prompt + history + saved prompts via localStorage) is already
live. This proposal covers the **minimum backend surface** required to make the
*remaining* Creative Studio features real: creative **variations**, **side-by-side
compare**, **regenerate-from-a-previous-version**, and (Phase 3) **editable brief
controls** that actually affect output.

**Hard guardrails honored in this design:**
- No changes to generation *prompts*, Gemini prompt engineering, Story Agent,
  video strategy, FFmpeg, Seedance, rendering, queues, Redis, Railway.
- Additive only: new tables/columns/endpoints. No destructive migration, no
  refactor of existing pipeline logic.
- One item (Phase 3 output-affecting controls) unavoidably requires the
  **compositor** (`src/lib/creative/compositor.ts`) to *read* new brief fields.
  That file is in the LOCKED set — it is called out explicitly below as the one
  place approval is genuinely required to touch locked code, and it is read-only
  additive (read a new optional field; fall back to current behavior when absent).

---

## Current state (as built)

- `content_creatives` (one row per creative) carries: `status`
  (`brief_ready → approved → generating → ready/failed/rejected`),
  `image_url`, `creative_brief` (jsonb — the full strategy), `creative_hierarchy`,
  `creative_confidence`, `regen_count`, `generation_error`, `platform`,
  `content_item_id`, `created_at`.
- **Regenerate overwrites.** `POST /api/creatives/[id]/regenerate` replaces
  `image_url` and increments `regen_count`. Prior images are lost → no
  variations, no compare, no "restore version".
- Endpoints today: `POST /api/content/[id]/creative` (compose brief),
  `POST /api/creatives/[id]/regenerate`, `POST /api/creatives/[id]/review`.
- Prompt history / favorites currently live in `localStorage` (Prompt Studio) —
  per-device, per-browser.

---

## Feature → backend requirement map

| Feature | Needs backend? | Smallest change |
|---|---|---|
| Editable prompt (text direction) | **No** — already shipped | Uses existing `userPrompt` field; done client-side |
| Prompt history / saved prompts (per device) | **No** — already shipped | localStorage (Prompt Studio) |
| Prompt history / favorites **synced across devices** | Optional | 1 table `user_prompts` (only if cross-device is required) |
| Creative **variations** (keep every render) | **Yes** | 1 table `creative_variations` + change regenerate to INSERT |
| **Side-by-side compare** of variations | **Yes** (depends on variations) | `GET …/variations` (read-only) |
| **Regenerate-from / restore a version** | **Yes** (depends on variations) | `POST …/variations/[vid]/select` |
| Phase 3 **editable brief controls** (headline/CTA/palette/layout) that affect output | **Yes** | `PATCH …/brief` (whitelist) + compositor reads overrides |

---

## Proposal A — Variation history (enables variations, compare, restore)

### A.1 New table: `creative_variations`
```
creative_variations
  id              uuid pk default gen_random_uuid()
  creative_id     uuid  not null references content_creatives(id) on delete cascade
  content_item_id uuid  not null references content_items(id) on delete cascade  -- denormalized for RLS + fast list
  image_url       text  not null
  background_source text                                   -- 'imagen' | 'fallback' (mirrors existing field)
  brief_snapshot  jsonb                                    -- the brief used for THIS render (compare/why)
  regen_index     int   not null default 0                 -- 0 = first render, 1 = first regen, …
  is_selected     boolean not null default false           -- the one currently surfaced as creative.image_url
  created_at      timestamptz not null default now()
  -- RLS: same policy shape as content_creatives (authorize by owning content_item → brand → user)
  -- Index: (creative_id, created_at desc)
```

### A.2 Data flow
1. First successful generation and every regenerate **INSERT** a row into
   `creative_variations` (instead of only overwriting `content_creatives.image_url`).
2. `content_creatives.image_url` remains the pointer to the **selected** variation
   (unchanged contract for all existing readers — zero break).
3. Compare view = `GET /api/creatives/[id]/variations` (read-only list).
4. Restore/pick = `POST /api/creatives/[id]/variations/[vid]/select` → flips
   `is_selected` and copies that row's `image_url` into `content_creatives.image_url`.

### A.3 Endpoints
- `GET  /api/creatives/[id]/variations` → `{ variations: [...] }` (read-only).
- `POST /api/creatives/[id]/variations/[vid]/select` → sets selected + updates pointer.
- `POST /api/creatives/[id]/regenerate` — **modified**: after the (unchanged)
  image step, INSERT a variation row. No change to *how* the image is generated.

### A.4 Why necessary / why smallest
- Variations, compare, and restore are impossible while regenerate overwrites.
  A child table is the smallest correct model: it needs no change to the
  generation pipeline, keeps `content_creatives` backward-compatible, and RLS
  reuses the existing content-ownership chain.
- Rejected smaller option: a `variations jsonb[]` column on `content_creatives`.
  Cheaper migration but worse — unbounded row growth, no per-image RLS/index, and
  awkward "select" semantics. Child table chosen.

### A.5 Production impact
- Additive migration; existing rows unaffected (no backfill required — history
  simply starts accumulating).
- Storage: one small row per render (already storing the image in R2/storage;
  this only adds a DB pointer row).
- Risk: **low.** Existing readers untouched; new writes are best-effort and can
  be wrapped so a variation-insert failure never blocks the render.

---

## Proposal B — (Optional) Cross-device prompt library

Only if synced prompt history/favorites is a requirement. Otherwise **skip** —
the shipped localStorage version already covers single-device use.

### B.1 New table: `user_prompts`
```
user_prompts
  id         uuid pk default gen_random_uuid()
  user_id    text not null            -- Clerk user id
  brand_id   uuid null references brands(id) on delete set null  -- optional scoping
  text       text not null
  label      text null
  is_favorite boolean not null default false
  created_at timestamptz not null default now()
  -- RLS: user_id = auth.jwt() sub. Index: (user_id, created_at desc)
```

### B.2 Endpoints
- `GET /api/prompts` · `POST /api/prompts` · `PATCH /api/prompts/[id]` · `DELETE /api/prompts/[id]`.

### B.3 Why / impact
- Necessary only for cross-device/team reuse. Fully isolated (own table, own RLS),
  zero interaction with generation. **Low risk.** Recommend deferring unless
  cross-device is explicitly wanted.

---

## Proposal C — Phase 3 editable brief controls (the one locked-file touch)

Phase 3 asks for typography / layout / creative-direction controls that change
the rendered image. The brief already carries `headline`, `subheadline`, `cta`,
`palette`, `hierarchy`. To let users edit these **before** generation and have it
matter:

### C.1 Storage
- No new table needed — store overrides inside the existing
  `content_creatives.creative_brief` jsonb under a namespaced key, e.g.
  `creative_brief.user_overrides = { headline?, subheadline?, cta?, palette?, typography?, layout? }`.

### C.2 Endpoint
- `PATCH /api/creatives/[id]/brief` — accepts a **whitelist** of editable fields
  only; merges into `creative_brief.user_overrides`; allowed only while
  `status ∈ {brief_ready, approved}` (before/at the gate). Never accepts free-form
  prompt text that could rewrite generation instructions.

### C.3 The locked-file implication (needs explicit approval)
- For overrides to affect output, the **compositor** (`src/lib/creative/compositor.ts`,
  LOCKED) must *read* `creative_brief.user_overrides.*` and prefer it over the
  AI-composed value when present. This is:
  - **Additive & read-only to logic:** read an optional field; fall back to
    current value when absent → byte-identical output when no override is set.
  - **Not a prompt change:** it does not alter Gemini prompts or the image model;
    it changes which *typography/layout/color* values the deterministic compositor
    applies.
- **This is the single point in the whole proposal that touches locked code.**
  Recommend approving it narrowly (typography + palette + copy overrides first;
  layout later) or deferring Phase 3 output-controls entirely if the compositor
  must stay frozen. If deferred, the Phase 3 UI can still ship as a **preview-only**
  control panel that writes overrides for a *future* compositor read — but it
  will not change pixels until the compositor reads them.

---

## Recommended sequencing (smallest blast radius first)

1. **Proposal A** (variations) — highest value, zero locked-file touch, low risk.
   Unlocks variations + compare + restore in one additive table + 2 endpoints +
   1 modified endpoint.
2. **Proposal C.2 PATCH only** (store overrides) — additive endpoint, no pixel
   change yet; lets the Phase 3 UI persist intent.
3. **Proposal C.3** (compositor reads overrides) — the one locked-file change;
   approve narrowly when ready.
4. **Proposal B** (prompt sync) — only if cross-device is wanted.

## What I will NOT do without explicit approval
- Create/alter any table or column.
- Add/modify any API route.
- Touch `src/lib/**` — including the compositor read in C.3.
- Anything in the video/generation/infra frozen set.

Awaiting your go/no-go per item.
