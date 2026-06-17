# Phase 2A — Staging Provisioning Runbook

**Goal:** stand up the minimum isolated environment to run the Deterministic Brand Identity acceptance test (18 renders) from branch `staging/brand-pattern-2a` **without touching production.**
**Branch:** `staging/brand-pattern-2a` (origin/main + 3 Phase 2A commits `3b9542a`, `3aeed6b`, `2aadf65`; **no Video V1**).
**Who does what:** Sections 1–3 are **operator-only** (account/billing/deploy — I cannot create cloud projects or deploy). Sections 4–7 I can drive once 1–3 exist (SQL + harness + review package). I will not fabricate results.

> **Migration note:** this branch contains migrations **001–021 + 023** and intentionally **NOT 022** (022 is Video V1; Phase 2A doesn't use its columns). Apply exactly the files present on the branch, ascending.

---

## 1 · Staging Supabase (operator)
Create a **new, separate** Supabase project (not `ddozknywcdpyfdokmfrp`).

1. New project → capture `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. In the SQL editor, run **every file in `supabase/migrations/*.sql` in ascending order** as listed on the branch:
   `001 → 002 → … → 021 → 023` (skip 022; it isn't on the branch). Run each as-is; they're idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`). The "destructive operation" modal fires on `DROP POLICY` guards — safe to confirm.
3. Verify schema:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('brands','content_items','content_creatives','brand_assets','brand_patterns')
   ORDER BY 1;                                   -- expect 5 rows
   SELECT * FROM information_schema.tables WHERE table_name='brand_patterns';  -- expect 1 row
   ```
4. Storage buckets (the worker uploads composites): create public buckets **`content-creatives`** and **`brand-assets`** (017/018 create them if their storage statements ran; if not, create manually).

**Rollback:** delete the staging Supabase project.

## 2 · Staging Redis (operator)
Provision a **dedicated** Redis (e.g. Upstash) — **must not share with prod** (separate `REDIS_URL`, separate keyspace).
- Capture `REDIS_URL` (must start `redis://` or `rediss://` — Upstash uses `rediss://`).
- Verify after the worker boots (Section 3): worker log shows `redis.ready`; a queue key appears on first job.

**Rollback:** destroy the Redis instance.

## 3 · Staging worker (operator)
Run the `staging/brand-pattern-2a` branch as a worker, isolated from prod. Two options:

**A — Railway staging service:** new service → connect repo `josephottoflow/ottoflow-ai` → **branch `staging/brand-pattern-2a`** → start command `npm run start:worker` (build `npm run build:worker`). *(Branch must be pushed first — see end.)*
**B — Local worker:** create `.env.staging` with the vars below → `npm run build:worker && node worker/dist/index.js` (or `npm run dev:worker`).

Required env:
```
NEXT_PUBLIC_SUPABASE_URL   = <staging>
SUPABASE_SERVICE_ROLE_KEY  = <staging>
REDIS_URL                  = <staging, dedicated>
GOOGLE_API_KEY             = <Imagen-enabled key>
```
Optional (durable render storage — else Supabase Storage is used):
```
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL
```
> **R2 isolation:** the prod R2 creds point at bucket `ottoflow-renders`. For staging, either a **separate bucket** or leave R2 unset (creative images upload to the staging Supabase `content-creatives` bucket, which is the image path anyway — R2 is used by the *video* pipeline, absent here). **Recommend: leave R2 unset for the image acceptance test.**

Verify startup: worker log shows Redis connected, workers registered (brand-research, content-generation, video-merge, ffmpeg-compose, **creative-generation**), no boot exception. (This branch has **no** `scene-generation` worker — correct.)

**Rollback:** remove the deployment / stop the local process.

## 4 · Database setup — insert patterns (I can drive)
Run the **TASK-1 staging SQL** (from the prior plan) against the **staging** DB: create the disposable Stripe-like + HubSpot-like test brands, insert the 3 patterns active, set `brand_colors`. Use the three pilot JSONs already produced (Basecamp `center_convergence`/`interlocking_hub`, Stripe-like `diagonal_precision`/`diagonal_bars`, HubSpot-like `orbital_growth`/`orbital_dots`).

Verify:
```sql
SELECT b.name, p.version, p.is_active, p.pattern->'composition_dna'->>'template' AS template
FROM brand_patterns p JOIN brands b ON b.id=p.brand_id
WHERE p.is_active=true ORDER BY b.name;            -- expect 3 rows
```
**Rollback:** the TASK-1 rollback SQL (delete pattern rows; drop the two test brands).

## 5 · Smoke test — backward compatibility (I can drive)
Generate ONE creative for a brand **with no active pattern** (e.g. a 4th plain brand). Confirm it renders and matches the production baseline (the `loadActiveBrandPattern` fetch returns null → unchanged compositor path). **Gate: if it differs from baseline, STOP** — backward-compat broke.
**Rollback:** delete the generated creative row + storage object.

## 6 · Acceptance renders — 18 (needs a trigger path)
3 brands × 3 topics × {Control, Masked} = **18**. **This is the heaviest step** because creative generation is triggered by the *content→brief→approve* flow, not a single worker call. Two ways:

- **6a (app-driven):** also deploy the staging **Next app** (Vercel preview on the branch + staging env) → use the UI to create content for each topic per brand → approve → worker renders. Faithful but heavy.
- **6b (seed harness, recommended for determinism):** a small seed script inserts, per (brand, topic), a `content_items` + `content_creatives` row with a hand-authored **brief** (same hierarchy `brand_led`; topic headline; palette from the brand; **Control:** `logo_usage.use=true`,`company_name_usage.use=true`; **Masked:** both `=false`) at `status='approved'`, then enqueues a `creative-generation` job. The worker renders. *(This is a tiny test harness, not a product feature — I can draft it on request.)*

Verify each render: `content_creatives.status='ready'`, `image_url` set, and `brand_pattern_version` populated (proves the pattern was applied). Spot-check the PNGs: **motif visible, template layout applied, color grade applied**. No scoring yet.
**Rollback:** delete the generated `content_creatives` / `content_items` rows + storage objects.

## 7 · Review package (I can drive)
From the 18, take the **9 Masked** renders → apply the **top-65% crop** (1200×408) → **randomize filenames** (strip brand/topic) → build the reviewer sheet (Q1 pairwise "different brands?", Q2 single "which descriptor?"). Recruit **≥5 reviewers** (and/or a vision-LLM panel). Collect → I compute **Blind Attribution % / Distinctiveness % / Pairwise %** per the formulas.

## 8 · GO / NO-GO (environment health, pre-scoring)
**GO** (proceed to blind review): staging Supabase has `brand_patterns` (1 table) + 3 active patterns; worker booted clean; smoke test matched baseline; **all 18 renders `ready`** with `brand_pattern_version` set and motif/template/grade visibly applied; review package prepared.
**NO-GO:** any render failure · pattern not loaded (`brand_pattern_version` null) · worker boot failure · migration/schema mismatch · smoke test diverged from baseline.

---

## What I can do now vs. what's blocked
- **Operator-only (1–3):** create the staging Supabase + Redis + worker deploy. I cannot create cloud projects, provision Redis, or deploy.
- **I can drive (4,5,7) + draft (6b):** once 1–3 exist and I have the staging `SUPABASE_*`/`REDIS_URL`/`GOOGLE_API_KEY`, I can run the pattern-insert SQL, the smoke test, draft the seed harness, and assemble the review package.
- **Prerequisite for Railway option (3A):** the branch must be pushed (`git push origin staging/brand-pattern-2a`) — harmless (no service deploys from it until you point one at it). I have not pushed; say the word.
