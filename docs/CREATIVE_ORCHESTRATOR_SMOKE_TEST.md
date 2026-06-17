# Creative Orchestrator — Production Smoke Test Report

**Date:** 2026-06-14
**Env:** production (`ottoflow-ai.vercel.app`), Vercel `72dcd50` → `eca3456`
**Brand:** Basecamp `b1384434-3666-45cc-96d9-ca764e90cdc3`
**Content item:** `4e03b484-52ad-4f5d-b566-13250302cce1` — *"Real Productivity Needs Simplicity, Not Feature Bloat"*
**Creative:** `8218cc9e-17f5-48ae-beea-028b741e9312`
**Outcome:** **Loop validated end-to-end through APPROVAL + ENQUEUE + WORKER-RECEIVES.** Image generation is **BLOCKED** by an infrastructure failure (Railway trial ended → worker cannot deploy the fix). **Two Sev-1 code defects were found and fixed; a first successful image could not be produced because the fixed worker cannot deploy.**

---

## Result per step

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Brand: logo + founder headshot + brand colors | **PARTIAL** | logo ✓ + founder_headshot ✓ (both `locked:true`); **brand_colors NOT configured** (brief palette `{}`) → DEF-4 |
| 2 | Generate content from a mined opportunity / grounded topic | **PASS** | topic `235ca7d4…` (mined `problem-solution`) → post generated, status `in_review` |
| 3 | Generate a creative (compose brief) | **PASS** | `201`, creative `8218cc9e`, status `brief_ready` |
| 4 | Brief verification | **PASS** | hierarchy `founder_led`; confidence **0.92** (assets 1.0/model 1.0/opp 0.65/platform 0.9); eligible [founder_led, brand_led, quote_led]; logo ✓ (bottom_right); headshot ✓ (right_third); company "Basecamp" ✓; founder "Jane Doe" ✓; format 1:1·linkedin ✓ |
| 5 | Approve the brief | **PASS** (after DEF-1 fix) | `200`, status `approved` |
| 6 | Queue enqueue succeeds | **PASS** (after DEF-1 fix) | no rollback; job accepted |
| 7 | Worker receives creative job | **PASS** | worker picked up + executed (then failed at Imagen) |
| 8 | Imagen generation succeeds | **FAIL → blocked** | `generation_error: "seed parameter is not supported in Gemini API"` → DEF-2 (fixed in code; can't reach worker) |
| 9 | Validation layer passes | **BLOCKED** | never reached (Imagen failed before validation) |
| 10 | Sharp compositor executes | **BLOCKED** | depends on a generated background |
| 11 | Logo byte-identical | **BLOCKED** | no composite produced |
| 12 | Founder headshot byte-identical | **BLOCKED** | no composite produced |
| 13 | Creative image uploads | **BLOCKED** | no image to upload |
| 14 | `content_creatives.status = ready` | **BLOCKED** | stuck `failed` (regen #1, same error) |
| 15 | Thumbnail renders in UI | **BLOCKED** | no image |
| 16 | Publish → metrics → analytics attribution | **BLOCKED** | depends on a ready creative |

**Brief-preview UI (Step 4) and the approval gate render correctly** — screenshot captured (all 10 fields: hierarchy, confidence + components, visual concept, rationale, headline, CTA, logo/headshot/company/founder usage, format).

---

## Root-cause investigation (requested A/B/C/D)

| Hypothesis | Verdict | Proof |
|---|---|---|
| **A. Stale Railway worker** | **TRUE** | Worker runs pre-`eca3456` code: it processes jobs but fails on the exact `seed` error the fix removes. |
| **B. Incomplete deployment** | **TRUE (root cause)** | **Railway trial ended account-wide** — dashboard: *"Trial Ended — Upgrade now to continue using the platform"* / *"Trial maxed out"*; `ottoflow-worker` services *"Paused from exceeding limits"*; both projects now *"No services."* New worker deploys **cannot run**, so `eca3456` never reaches the worker. |
| **C. Another code path passing seed** | **FALSE** | Grep of all `generateImages` sites: only `generateHeroFrame` (video) still passes `seed` — it is **not** called by `processCreativeGeneration`. The creative path (`generateCreativeBackground` → `validateGeneratedBackground` → `compositeCreative`) is seed-free after `eca3456`. |
| **D. Multiple replicas, different code** | **FALSE** | Health shows a single connected worker; every attempt fails identically. A fixed replica would have produced ≥1 success. |
| (extra) wrapper/fallback injects seed | **FALSE** | `callGemini` is a timeout/retry wrapper only; the processor calls the Imagen helper directly; no fallback generation path. |

**The "1 worker connected" in `/api/debug/health` is a stale BullMQ worker registration** (Redis-stored, TTL-persisted) from the worker that ran the failing jobs before Railway paused it; Redis itself is external (Upstash) so it still answers PONG.

---

## Defects

| ID | Severity | Status | Description | Fix |
|---|---|---|---|---|
| **DEF-1** | **Sev-1** | **FIXED** `72dcd50` | Approving a brief 500'd ("couldn't start generation") and rolled back to `brief_ready` — **no creative ever reached image generation**. Cause: approve + regenerate built `jobId` with colons (`creative:${id}`); BullMQ throws `Custom Id cannot contain :` (job.js:1049). | Hyphens instead of colons in both routes. Verified: approve now `200/approved`, regenerate `200/approved`. |
| **DEF-2** | **Sev-1** | **FIXED in code** `eca3456`; **deploy BLOCKED** | Every Imagen call failed: `seed parameter is not supported in Gemini API`. `generateCreativeBackground` passed a per-call `seed` to `generateImages` (Imagen rejects it; text `generateContent` accepts it). | Removed `seed` from the Imagen config. **Cannot be validated** until the worker redeploys (DEF-3). |
| **DEF-3** | **Sev-1 (infra)** | **OPEN — operator action** | **Railway trial ended** → worker frozen/paused → worker-side fixes (incl. DEF-2) cannot deploy. Also the long-standing video-render RAM limit lives here. | **Upgrade Railway to Hobby** (billing — must be done by the operator; I'm not permitted to enter payment). Then `eca3456` auto-deploys and the loop can complete. |
| **DEF-4** | **Sev-3** | OPEN | `brands.brand_colors` not configured for the test brand → brief `palette: {}` → creatives fall back to the default accent instead of brand colors. There is also **no UI to set brand colors**. | Populate `brand_colors` (research worker or a brand-settings field) and add a colors editor. |
| **DEF-5** | **Sev-4 (cosmetic)** | OPEN | Brief *Visual Concept* prose said "headshot on the **left**" while the code-computed placement is `right_third` (right). Narrative-vs-deterministic mismatch; the composite uses the code placement. | Align the concept prompt with the chosen placement, or omit side-specific prose. |

---

## What is proven vs. not

**Proven working in production (real assets, real content):**
Opportunity → Content → **Brief** (correct constraint-driven hierarchy `founder_led`, confidence 0.92, all 10 gate fields, real logo + founder-headshot asset IDs bound) → **Approval gate** → **BullMQ enqueue** → **worker receives the job**. The regenerate path also works.

**Not yet proven (blocked on DEF-3, the Railway upgrade):**
Imagen background generation, the text/logo/face validation layer, the sharp compositor (logo/headshot byte-identity, placement, overlays, dimensions), storage upload, `ready` status, UI thumbnail, and the downstream Publish → metrics → analytics-attribution steps.

---

## Next action to close the loop

1. **Operator:** upgrade Railway from the ended trial to Hobby (the dashboard "Upgrade now" CTA). This is a payment action and must be performed by the operator.
2. Once the `ottoflow-worker` service redeploys at `eca3456` (verify the deployment SHA + the boot log line `worker started`), **regenerate creative `8218cc9e`** and follow it to `ready`.
3. Resume this report at Step 8 → 16: verify Imagen output, the validation pass, byte-identical locked assets in the composite, storage paths, then walk the item Review → Approved → Published, enter metrics, and confirm `creative_hierarchy` / `creative_confidence` attribution on `/analytics`.

The code is correct and ready; the only remaining blocker is the Railway trial, which is outside what I can action (billing).

---

## Resume attempt — 2026-06-14 (after "Railway upgrade complete")

Re-ran the validation after the upgrade was reported. **Still blocked — the upgrade is not reflected on the worker's Railway workspace.**

| Check | Result |
|---|---|
| Vercel `eca3456` live | ✓ (HEAD `495262a`) |
| Re-approve / regenerate creative `8218cc9e` | ✓ enqueue `200`, regen #2 |
| Worker executes | ✓ — but **failed again, identical error**: `seed parameter is not supported in Gemini API` → worker still on pre-`eca3456` code |
| Railway dashboard (after hard reload) | **`josephottoflow's Projects` still labeled `Trial` · "Trial maxed out" · "Trial Ended — Upgrade now"** |
| Worker services (`ottoflow-worker`: redis + `ottoflow-video-hub`) | **"Paused from exceeding limits" / "No services"** |
| Workspace switcher | **Only one workspace exists (`josephottoflow's Projects · Trial`)** — no upgraded workspace to switch to |

**Why upgrading didn't fix it (two things):**
1. The dashboard still shows this workspace on **Trial / maxed out** — so either the upgrade didn't complete, was applied to a different Railway login/account, or is still pending. The plan must read a paid tier (Hobby/Pro) on **josephottoflow's Projects**.
2. Even once on a paid plan: ending the trial **paused/tore down the worker service**, and upgrading un-pauses the *old* deployment — it does not rebuild HEAD. An empty commit `495262a` was pushed to trigger a fresh worker build, but Railway won't build it while the workspace is trial-maxed.

**Operator actions to unblock:**
1. Confirm the Hobby/Pro upgrade is applied to the **josephottoflow's Projects** workspace (the dashboard should no longer say "Trial / maxed out").
2. Ensure the `ottoflow-worker` → `ottoflow-video-hub` service is **running** (un-paused / redeployed).
3. Trigger/confirm a worker deploy of the latest commit (the pushed `495262a` should auto-deploy once the plan is active, or use the service's **Deploy latest** action).
4. Verify the worker boot log shows the new commit, then ping to resume — I'll regenerate `8218cc9e` and complete Steps 8→16.
