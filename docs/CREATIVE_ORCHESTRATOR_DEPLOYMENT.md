# Brand Creative Orchestrator v1 — Deployment Checklist

**Date:** 2026-06-13
**Status:** Deployment-ready · **NOT deployed** · awaiting operator approval to push
**Scope:** Deployment readiness only — no feature development, no redesign.

Branch `feat/ffmpeg-multi-agent-pipeline` is **6 commits ahead of origin**, unpushed:

| SHA | Phase |
|---|---|
| `2e1c23d` | A — brand asset library |
| `06ca937` | B — strategy layer + approval gate |
| `eb07bc7` | C — generation (Imagen bg + sharp composite) |
| `36e0927` | D — hierarchy attribution & learning |
| `6d12adc` | A alignment — taxonomy → logo/founder_headshot/team_headshot + locked |
| `47b97a4` | B alignment — engine selects founder_headshot |

Local gates (re-verified this pass): `npx tsc --noEmit` clean except the 2 known pre-existing untracked-script errors (`scripts/create-sentry-alert-rules.ts`, `scripts/list-models.local.ts`); `npm run build:worker` clean (sharp externalized).

---

## 1. Migration verification

### 017_brand_assets.sql — ✅ verified
- `CREATE TABLE IF NOT EXISTS brand_assets` — idempotent.
- FK `brand_id → brands(id) ON DELETE CASCADE` — `brands` exists (002). ✓
- `kind` CHECK = `('logo','founder_headshot','team_headshot')` — matches spec; `team_headshot` future-ready. ✓
- `locked BOOLEAN NOT NULL DEFAULT true` — set true on every insert, no mutation path. ✓
- Index `IF NOT EXISTS`; RLS `ENABLE` + `DROP POLICY IF EXISTS` + `CREATE POLICY` (owner-read via `current_clerk_user_id()`). ✓ idempotent.
- `current_clerk_user_id()` dependency: used by live migrations 003/006/016 → exists in prod. ✓
- Storage bucket `brand-assets`: `INSERT … ON CONFLICT (id) DO UPDATE` + `DROP POLICY IF EXISTS` public-read — identical pattern to applied 004. ✓

### 018_content_creatives.sql — ✅ verified
- `CREATE TABLE IF NOT EXISTS content_creatives` — idempotent.
- FKs `content_item_id → content_items(id)` + `brand_id → brands(id)` `ON DELETE CASCADE` — both exist. ✓
- `status` CHECK (6 states), `creative_hierarchy` CHECK (all 5, incl. future `product_led`), `creative_confidence NUMERIC(4,3)` CHECK 0..1. ✓
- Indexes `IF NOT EXISTS` incl. partial `WHERE status='ready'` (Phase D read). ✓
- `DROP TRIGGER IF EXISTS … CREATE TRIGGER … set_updated_at()` — `set_updated_at()` defined in 001. ✓
- RLS owner-read via brand → `current_clerk_user_id()`. ✓
- Realtime: guarded `DO $$ … ALTER PUBLICATION supabase_realtime ADD TABLE content_creatives` — identical guard to applied 004 (publication is Supabase-managed). ✓
- `ALTER TABLE brands ADD COLUMN IF NOT EXISTS creative_preferences JSONB NOT NULL DEFAULT '{}'` — additive, idempotent. ✓
- Storage bucket `content-creatives` — same pattern as 004/017. ✓

**Both migrations are additive and idempotent.** No dependency on each other (apply 017 then 018 for tidiness). No destructive statements → the "destructive operation" dashboard modal should NOT appear (unlike DROP-guarded migrations). Safe to apply to prod **before** pushing code: the live app at `8a7601b` references neither table, so applying early creates a zero-impact window (this is the required migrations-first order — pushing code first would 500 the asset/creative routes on missing tables).

---

## 2. Synthetic hierarchy validation — ✅ executed, ALL PASS

Real run of the pure engine (`src/lib/creative/hierarchy.ts`), `CONFIDENCE_FLOOR = 0.55`:

| Scenario | Assets | Eligible | Chosen | Correct? |
|---|---|---|---|---|
| **Founder-asset brand** | logo + founder_headshot | founder_led, brand_led, quote_led | **founder_led** (0.957) | ✓ founder face → founder_led wins |
| **Logo-only brand** | logo | brand_led, quote_led | **brand_led** (0.936) | ✓ founder_led & data_led ineligible |
| **Statistic-only brand** | logo + stat in copy | brand_led, data_led, quote_led | **data_led** (0.871) | ✓ stat signal → data_led eligible & wins |

Assertions enforced and passed:
- S1 `founder_led` eligible.
- S2 `founder_led` INELIGIBLE (no headshot) **and** `data_led` INELIGIBLE (no stat); `brand_led` eligible.
- S3 `data_led` eligible (stat present); `founder_led` INELIGIBLE (no headshot).

Constraint-driven eligibility + the `< 0.55 → force brand_led` rule are confirmed present (the rule lives in `composeCreativeBrief`; the floor constant and blend weights 0.40/0.30/0.20/0.10 are unit-verified). The synthetic script was run and removed (no straggler committed).

---

## 3. Deployment steps (execute only after operator approval)

**Order is mandatory: migrations FIRST, then push, then verify worker.**

1. **Apply migrations via Supabase dashboard SQL editor** (operator — no CLI/token path on this machine):
   - [ ] Run `supabase/migrations/017_brand_assets.sql` → expect "Success".
   - [ ] Run `supabase/migrations/018_content_creatives.sql` → expect "Success".
2. **Verify schema** (REST probe or dashboard):
   - [ ] `brand_assets` and `content_creatives` tables exist; `brands.creative_preferences` column exists.
   - [ ] Storage buckets `brand-assets` and `content-creatives` exist and are public.
3. **Push** (auto-deploys Vercel UI/routes + Railway worker):
   - [ ] `git push origin feat/ffmpeg-multi-agent-pipeline && git push origin HEAD:main`
4. **Wait for Railway "Deployment successful"** before any worker-path test (the creative-generation Worker is new; a mid-swap job would run on the old worker).
5. **Confirm Vercel READY** for the new routes (`/api/brands/[id]/assets`, `/api/content/[id]/creative`, `/api/creatives/[id]/review`, `/api/creatives/[id]/regenerate`).

### Environment / infra
- [ ] **No new env vars.** Imagen + the multimodal validator reuse `GOOGLE_API_KEY` (already required by `worker-env.ts`). Upload + compositor use `sharp` (now in `dependencies`; Railway `npm ci` installs it; worker bundle externalizes it; Vercel supports it for the upload route).
- [ ] **Not gated on the Railway 2 GB upgrade.** Phase C generation is Imagen (API) + `sharp` image compositing (a few MB), not video/Chrome — it runs within the current ~1 GB worker. (The unrelated video-render RAM block is tracked separately.)

---

## 4. Post-deploy acceptance (smoke, one pass)

1. [ ] On a `ready` brand, open the Brand Assets section → upload a **logo** (PNG) and a **founder_headshot** → both appear in the grid with dimensions; `locked` true.
2. [ ] Open a published content item → Creative panel → **Generate Creative** → brief appears in `brief_ready` showing hierarchy, confidence (+ components), visual concept, rationale, headline, CTA, and logo/headshot/company-name/founder-name usage.
3. [ ] **Approve Brief** → status flips `approved → generating → ready` via Realtime; final image renders with the **real uploaded logo/headshot composited** (unmodified) over an Imagen background containing **no** text/logo/face.
4. [ ] **Regenerate** once → new background, same approved brief, `regen_count` increments.
5. [ ] Record metrics on the published item → `/analytics` "Creative hierarchy performance" shows the hierarchy row; a `creative` recommendation appears once ≥2 hierarchies have data.

---

## 5. Safety attestation (re-confirmed, unchanged)

- Uploaded logos/headshots: stored byte-exact; **no** regenerate/enhance/recolor/stylize/recreate path exists.
- Asset bytes never enter an AI model — the concept call receives text descriptions only; the worker downloads bytes solely for the deterministic `sharp` compositor.
- Imagen generates **background only** (in-prompt negatives + multimodal text/logo/face rejection, 3 attempts).
- Compositor operations restricted to resize / crop / mask / position (+ SVG typography on a separate layer; legibility scrim on the generated background only).

---

## 6. Rollback

- Migrations are additive — no rollback needed for safety. If desired, the tables/column/buckets can be dropped manually (nothing else references them).
- Code: revert the 6 commits or reset the remote branch; the live app at `8a7601b` is unaffected because the new tables/routes are self-contained.

---

## 7. Hold

**Do not push. Do not merge. Do not deploy.** This checklist is the readiness artifact; execution waits on explicit operator approval.
