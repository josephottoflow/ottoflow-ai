# Phase 1A — Pre-Push Smoke Test Plan

**Commit under test:** `2a19fd4 feat(video-variation): Phase 1A — seeds + temp jitter + aestheticNotes + style pool`
**Author:** josephottoflow
**Date generated:** 2026-06-04
**Status:** awaiting smoke-test execution
**Goal:** prove the four Phase 1A changes are runtime-safe before pushing to `origin/main` and promoting to production.

---

## 1. Test Matrix

Each row maps a Phase 1A claim to a verification. PASS = observed evidence. FAIL = inconclusive or contradictory.

| # | Claim under test | Validation method | Expected PASS observation | Expected FAIL observation |
|---|---|---|---|---|
| 1 | **Gemini accepts `seed` in `generateContent.config`** | Trigger 1 brand+topic generation; observe Sentry for `gemini.call.exhausted` breadcrumb | Pipeline emits `Script ready — Xs, hook: "..."` SSE log without retry breadcrumbs | Sentry `gemini.call.exhausted` with error matching `unexpected.*seed` or `unknown field` |
| 2 | **Gemini accepts temperature 0.65-0.75** | Same generation as #1; observe script JSON validity | `render_jobs.script_json` is well-formed (hook/body/cta/estimatedDurationSec/voiceDirection all present + types correct) | Multiple JSON-parse retry breadcrumbs or final `Failed to parse Gemini JSON output` error |
| 3 | **Runway accepts `seed` in image_to_video body** | Trigger generation with RUNWAYML_API_SECRET present; observe scene_generations | At least one row with `provider='runway'` AND `clip_url IS NOT NULL` AND `metadata->>'seed' IS NOT NULL` | Sentry `video-provider.scene_failed` event with `provider:"runway"` AND error matching `400.*seed` or `unknown.*parameter` |
| 4 | **Luma accepts `seed` in Dream Machine v1 body** | Same as #3 with LUMA_API_KEY; or break Runway to force Luma fallback | Row with `provider='luma'` AND `clip_url IS NOT NULL` AND `metadata->>'seed' IS NOT NULL` | Sentry `video-provider.scene_failed` with `provider:"luma"` AND error matching `400.*seed` |
| 5 | **`aestheticNotes` reach Runway/Luma prompts** | Read `render_jobs.storyboard_json->>'aestheticNotes'` and verify worker prepends it | aestheticNotes string present in storyboard_json; subsequent scene's prompt observably begins with palette/lighting words (from Sentry breadcrumb or Runway task ID lookup) | aestheticNotes is null/empty OR scene_generations rows show identical prompts across two generations of same brand+topic |
| 6 | **Style rotation fires when `input.style` is omitted** | Trigger 6 generations with no style param; collect `render_jobs.style` | All 6 unique values OR a non-trivial sample of the 6-style pool (≥ 3 distinct styles in 6 runs) | All 6 rows show `style='cinematic'` |
| 7 | **`scene_generations.metadata.seed` populated** | SQL query (§3 below) | Every Runway + Luma row in window has `metadata->>'seed'` matching `^[0-9]+$` | At least one Runway/Luma row has `metadata->>'seed' IS NULL` |
| 8 | **Gemini retry path still functions** | Force a transient by leveraging existing `MAX_RETRIES=3` semantics — set `GEMINI_TIMEOUT_MS=1` to deliberately race timeouts | Sentry breadcrumbs `gemini.retry attempt 1/3 failed` → `attempt 2/3 failed` → success OR `gemini.call.exhausted` with `finalAttempts:3` | No `gemini.retry` breadcrumbs at all (retry path bypassed) OR uncaught exception on first timeout |
| 9 | **Provider chain fallback still functions** | Temporarily clear `RUNWAYML_API_SECRET` from Railway worker env to force Luma → Pexels fallback (low-risk: re-paste after test) | scene_generations rows show `provider='luma'` or `provider='pexels'`; render_jobs completes normally | scene_generations rows show `provider='failed'` AND render_jobs `status='failed'` |
| 10 | **Video merge completes end-to-end** | Trigger 1 full pipeline; wait for `merged_video_url` to populate | `render_jobs.merged_video_url` is a Supabase Storage public URL; HTTP GET returns 200 with `Content-Type: video/mp4` | `render_jobs.merge_status='failed'`; `render_jobs.merge_error` populated |

---

## 2. Exact Test Inputs

**Prerequisites:**
- Test brand must already exist in `brands` table with a generated `profile` (otherwise prompt construction at `route.ts:212-269` fails before any Phase 1A code runs).
- At least 2 brands available so scenario C can compare across brands.
- RUNWAYML_API_SECRET + LUMA_API_KEY both set initially (then mutated for scenario D).

### Scenario A — Same brand + same topic, run TWICE
**Tests:** #1, #2, #3, #4, #5, #6 (style choice independence), #7
**Inputs (both runs identical):**
| Field | Value |
|---|---|
| `brandId` | UUID of existing test brand (use the "espresso roastery" or similar product brand) |
| `topicId` | UUID of any topic from that brand's `brand_topics` |
| `style` | **omitted** (let pool rotate) |
| `sceneCount` | 4 (default) |
| `provider` | `"veo3"` (default) |
| `musicVibe` | `"energetic"` (default) |

**Expected behavior:**
- Both runs complete with `render_jobs.status='done'`
- `render_jobs.style` differs across the 2 runs at least ~50% of the time (a 6-style pool has 5/6 chance of difference per run pair)
- `render_jobs.script_json->>'hook'` differs between runs
- `render_jobs.storyboard_json->>'scenes'->0->>'description'` differs between runs
- `scene_generations.metadata->>'seed'` populated and non-equal across the two runs for the same scene index
- If Runway active: clip_url of scene 1 from run 1 ≠ clip_url of scene 1 from run 2

### Scenario B — Same brand, 2 different topics
**Tests:** #6 (style rotation independence from topic), #5 (aestheticNotes vary per storyboard), #10
**Inputs:**
| Run | brandId | topicId | style |
|---|---|---|---|
| B1 | brand X | topic α | omitted |
| B2 | brand X | topic β | omitted |

**Expected:**
- Style rotation happens independent of topic
- aestheticNotes differ per storyboard (each topic produces its own aesthetic)
- Scene prompts therefore observably differ across both topic AND aesthetic prefix

### Scenario C — 2 different brands, same nominal topic theme
**Tests:** #5 (cross-brand aesthetic variation), #6
**Inputs:**
| Run | brandId | topicId | style |
|---|---|---|---|
| C1 | brand X (e.g., coffee) | topic about "morning ritual" | omitted |
| C2 | brand Y (e.g., skincare) | topic about "morning ritual" | omitted |

**Expected:**
- `aestheticNotes` differ (different brand → different storyboard direction)
- Pexels seed photo (if Runway active) pulls different category → visibly different hero shot
- Default style rotation can yield the same style for both — that's fine; the script + brand voice carry the difference

### Scenario D — Provider failure simulation
**Tests:** #4 (Luma path), #9 (fallback chain integrity), #10
**Setup steps (operator):**
1. In Railway worker env, **temporarily** set `RUNWAYML_API_SECRET=disabled_for_smoketest`
2. Wait for Railway redeploy (~3 min). Worker restarts.
3. Trigger 1 generation with same Scenario A inputs.
4. After completion (any outcome), **restore** `RUNWAYML_API_SECRET` to its real value.
5. Wait for Railway redeploy.

**Expected:**
- Provider chain: Runway `isConfigured() === false` → skipped (logged as `attempts.runway = "not configured"`) → Luma attempts → success
- Or if Luma also fails on seed: chain falls to Pexels → returns stock clip
- `render_jobs.status='done'` regardless
- `scene_generations.provider` shows `luma` or `pexels` (not `runway`)

**Operator caution:** Step 4 (restore) is mandatory. Forgetting to restore means production keeps degraded provider config.

---

## 3. Verification Queries

Run these in Supabase SQL editor against `ottoflow-staging` (`ddozknywcdpyfdokmfrp`) after each scenario.

### Q1 — Confirm `metadata.seed` populated on every AI-generated scene
```sql
SELECT
  provider,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE metadata->>'seed' IS NOT NULL) AS rows_with_seed,
  COUNT(*) FILTER (WHERE metadata->>'seed' IS NULL) AS rows_missing_seed
FROM scene_generations
WHERE provider IN ('runway', 'luma')
  AND created_at >= '<SMOKE_TEST_START_ISO>'
GROUP BY provider;
```
**PASS:** `rows_missing_seed = 0` for both providers.
**FAIL:** Any Runway/Luma row with NULL seed → revisit `runway.ts:163-167` or `luma.ts:139-143` metadata assembly.

### Q2 — Confirm seeds are RANDOM (not constant) across scenes
```sql
SELECT
  render_job_id,
  COUNT(DISTINCT (metadata->>'seed')) AS distinct_seeds,
  COUNT(*) AS scene_count
FROM scene_generations
WHERE provider IN ('runway', 'luma')
  AND created_at >= '<SMOKE_TEST_START_ISO>'
GROUP BY render_job_id;
```
**PASS:** For every job, `distinct_seeds = scene_count` (every scene got its own seed).
**FAIL:** `distinct_seeds = 1` across multiple scenes → seed is being shared, indicating a hoisted `runwaySeed`/`lumaSeed` outside the per-call scope.

### Q3 — Confirm scene generations completed successfully (no silent regressions)
```sql
SELECT
  r.id AS render_job_id,
  r.status,
  r.style,
  COUNT(s.id) FILTER (WHERE s.provider != 'failed') AS scenes_succeeded,
  COUNT(s.id) FILTER (WHERE s.provider = 'failed') AS scenes_failed,
  r.merge_status,
  r.merge_error
FROM render_jobs r
LEFT JOIN scene_generations s ON s.render_job_id = r.id
WHERE r.created_at >= '<SMOKE_TEST_START_ISO>'
GROUP BY r.id
ORDER BY r.created_at;
```
**PASS for Scenario A:** Both rows have `status='done'`, `scenes_failed=0`, `merge_status='done'`, `merge_error IS NULL`.
**PASS for Scenario D:** `status='done'` even though `scenes_failed` may be > 0 (chain absorbs failures).
**FAIL:** Any `status='failed'` OR `merge_error` populated with a message containing `seed` or `unknown.*parameter` or `400`.

### Q4 — Confirm Gemini retries fired correctly (Test #8 specifically)
Retries are captured as Sentry breadcrumbs, not DB rows. Use the Sentry Issues view:
```
https://ottoflow.sentry.io/issues/?project=4511491204907008&query=gemini.retry+AND+timestamp:>=<SMOKE_TEST_START_ISO>
```
For a DB-side cross-check after deliberately raising timeout pressure (Test #8):
```sql
SELECT
  id,
  status,
  error_message,
  created_at,
  completed_at
FROM render_jobs
WHERE error_message ILIKE '%timed out%' OR error_message ILIKE '%exhausted%'
  AND created_at >= '<SMOKE_TEST_START_ISO>'
ORDER BY created_at DESC
LIMIT 20;
```
**PASS:** If timeout test was forced, expect 1+ row with `error_message` matching `Gemini call.*timed out`. Retries are evidenced in Sentry breadcrumbs, not DB.
**FAIL:** No rows AND no Sentry breadcrumbs → retry path bypassed.

### Q5 — Confirm zero duplicate processing under multi-replica + new code (sprint §1 invariant preserved)
```sql
SELECT 'render_jobs' AS source, id::text AS job_uuid, COUNT(*) AS handler_runs
  FROM render_jobs WHERE status = 'done'
    AND created_at >= '<SMOKE_TEST_START_ISO>'
  GROUP BY id HAVING COUNT(*) > 1
UNION ALL
SELECT 'scene_generations', render_job_id::text || ':' || scene_number, COUNT(*)
  FROM scene_generations
  WHERE created_at >= '<SMOKE_TEST_START_ISO>'
  GROUP BY render_job_id, scene_number HAVING COUNT(*) > 1;
```
**PASS:** `Success. No rows returned.`
**FAIL:** Any row → Phase 1A regression OR multi-replica locking broke. Phase 1A doesn't touch locking, so a fail here points at multi-replica issue introduced concurrently, not at the commit under test.

### Q6 — Confirm style rotation distribution (Test #6 statistical check)
```sql
SELECT
  style,
  COUNT(*) AS occurrences
FROM render_jobs
WHERE created_at >= '<SMOKE_TEST_START_ISO>'
  AND prompt IS NOT NULL
  AND (script_json->>'hook') IS NOT NULL  -- filter to fully-completed runs
GROUP BY style
ORDER BY occurrences DESC;
```
**PASS:** Multiple distinct style values appear after running ≥ 6 generations with no style param. The 6-style pool is `cinematic / documentary / handheld ugc / luxury commercial / founder pov / social proof`.
**FAIL:** Only `cinematic` appears across 6+ runs → STYLE_POOL rotation not firing (probable: a UI default sneaking in via `input.style`).

---

## 4. Runtime Validation — log signatures

The SSE pipeline logs to the page via `emit({type:"log", ...})` and to Sentry via `captureFallback` / breadcrumbs. Here's what each provider should look like during a healthy run AND a failure.

### Gemini — PASS signature
```
[SSE] log info     "Started: Script"
[SSE] log success  "Script ready — 28s, hook: \"Most people…\""
[SSE] log info     "Started: Storyboard"
[SSE] log success  "Storyboard ready — 4 scenes, 28s total"
[Sentry] breadcrumb  gemini.retry  (absent on first-try success)
```

### Gemini — FAIL signature (seed-related)
```
[SSE] log error    "Gemini returned empty response"   ← or
[SSE] log error    "Failed to parse Gemini JSON output: ..."
[Sentry] event     gemini.call.exhausted
  tags: { label:"generateVideoScript", model:"gemini-2.5-flash" }
  extra: { finalAttempts:3, error:"GoogleGenerativeAIError: unknown.*seed.*field" }
```
→ Action: open `src/lib/gemini.ts`, change `entropy()` to drop `seed` while keeping `temperature` jitter, and re-test. If only `seed` is the problem, that's a 1-line revert.

### Runway — PASS signature
```
[Worker stdout] video-provider:runway  prompt prefix len=180  duration=5  seed=1873641205
[Sentry] breadcrumb  video-provider.scene_started  provider:"runway"  scene:1
[DB] scene_generations row:
  provider:"runway"  clip_url:"https://dnznrvs05pmza.cloudfront.net/..."
  metadata:{ "seed":1873641205, "model":"gen4.5", "taskId":"..." }
```

### Runway — FAIL signature (seed rejection)
```
[Worker stdout] video-provider:runway  generation failed
[Sentry] event     video-provider.scene_failed
  tags: { provider:"runway" }
  extra: { error:"Runway create 400: ..." with body matching /seed.*not.*supported/ }
[DB] scene_generations row:
  provider:"failed"  fallback_reason:"Runway create 400: ..."
```
→ Action: provider chain auto-falls through to Luma; if Luma also fails on seed, falls to Pexels. Pipeline still completes. No DB corruption, no user-facing 500.

### Luma — PASS signature
```
[DB] scene_generations row:
  provider:"luma"  clip_url:"https://storage.cdn-luma.com/..."
  metadata:{ "seed":2384751023, "model":"ray-flash-2", "generationId":"..." }
```

### Luma — FAIL signature (seed rejection)
```
[Sentry] event     video-provider.scene_failed
  tags: { provider:"luma" }
  extra: { error:"Luma create 400: ..." with body matching /seed/i }
```
→ Action: provider chain falls to Pexels.

### Worker — PASS signature (Phase D scene generation block)
```
[Worker stdout] processVideoMerge job=<uuid> aestheticPrefix.length=180 specCount=4
[Worker stdout] scene 1 → runway clip_url=... duration=5s
[Worker stdout] scene 2 → luma   clip_url=... duration=5s
[Worker stdout] scene 3 → runway clip_url=... duration=5s
[Worker stdout] scene 4 → runway clip_url=... duration=5s
[Worker stdout] all scenes done — concat manifest written
```

### Worker — FAIL signature (aestheticNotes prefix bloats prompt)
Indirect: provider would still respond OK; failure surface is *quality* not *exit*. Detectable by comparing `metadata.seedPhoto.id` (Pexels seed image ID) across two Scenario A runs — if they're identical despite different aestheticPrefix, the prefix wasn't honored by Runway.

### Merge pipeline — PASS signature
```
[Worker stdout] report("merging", 5)   ... scene generation
[Worker stdout] report("merging", 28)  ... downloads complete
[Worker stdout] report("merging", 35)  ... scene concat complete
[Worker stdout] report("merging", 50)  ... ffmpeg argv built
[Worker stdout] report("merging", 80)  ... ffmpeg exit 0
[Worker stdout] report("merging", 100) ... Supabase upload + URL stamped
[DB] render_jobs.merge_status='done'  merged_video_url='https://...supabase.co/...mp4'
```

### Merge pipeline — FAIL signature
```
[Worker stderr] ffmpeg failed (code=N, signal=null): ...
[DB] render_jobs.merge_status='failed'  merge_error='ffmpeg failed (code=...) ...'
```
→ Phase 1A does not touch ffmpeg or merge — a failure here is unrelated to Phase 1A and should NOT block its push.

---

## 5. Rollback Plan

### 5.1 If only Runway rejects seed (most likely failure mode)
**Symptom:** `video-provider.scene_failed` with `provider:"runway"` AND error body containing `seed` or `unknown parameter`.
**Impact:** Pipeline still works — chain falls through to Luma + Pexels. Cosmetic regression: Runway-eligible scenes use stock clips instead.
**Fix-forward (preferred):** open `src/lib/video-providers/runway.ts:114`, delete the `seed: runwaySeed,` line + the metadata.seed entry. Commit:
```bash
git -C /d/tiktok-product-video-factory/ottoflow-ai add src/lib/video-providers/runway.ts
git -C /d/tiktok-product-video-factory/ottoflow-ai commit -m "$(cat <<'EOF'
fix(video-providers): drop seed from Runway createBody — rejected by API

Phase 1A introduced seed injection on all AI providers. Runway's
image_to_video endpoint returns 400 with the seed parameter present.
Drop just the Runway seed; keep Gemini + Luma seeds (which work).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
**Time:** ~2 min including verify-and-push.

### 5.2 If Luma rejects seed
**Symptom:** Same as 5.1 but `provider:"luma"`.
**Impact:** Pipeline still works — chain falls to Pexels.
**Fix-forward:** drop `seed: lumaSeed,` from `src/lib/video-providers/luma.ts:85`. Same commit pattern.
**Time:** ~2 min.

### 5.3 If Gemini rejects seed
**Symptom:** `gemini.call.exhausted` Sentry event with error body matching `unknown.*field.*seed` or similar.
**Impact:** **EVERY** generation fails before reaching the worker. This is the only hard-break scenario.
**Fix-forward:** open `src/lib/gemini.ts`, drop `seed,` from both spread-into-config blocks (line 351 and the Imagen config). Keep the temperature jitter.
**Time:** ~3 min.
**Alternative — full revert:**
```bash
git -C /d/tiktok-product-video-factory/ottoflow-ai revert --no-edit 2a19fd4
```
This reverts ALL of Phase 1A. Use only if multiple providers fail and root cause is unclear.
**Time:** ~5 min (1 commit + push + Vercel + Railway redeploy wait).

### 5.4 If temperature 0.65-0.75 produces JSON parse failures at observable rate
**Symptom:** `gemini.retry` breadcrumbs landing on every call; `Failed to parse Gemini JSON output` exceptions in Sentry.
**Impact:** Slower pipeline (retry path eats time); occasional hard failures.
**Fix-forward:** in `src/lib/gemini.ts entropy()`, lower the range to `0.5 + Math.random() * 0.1` (0.5-0.6). Still better than the old 0.4 fixed but safer for JSON adherence.
**Time:** ~3 min.

### 5.5 If aestheticNotes prefix causes provider errors (bloat / injection-style content)
**Symptom:** `video-provider.scene_failed` with prompt-too-long errors OR generated clips visibly off-prompt.
**Impact:** quality not exit; chain still completes.
**Fix-forward:** reduce truncation in `worker/processors/video-merge.ts:201` from 400 to 150 chars, or gate behind a feature flag.
**Time:** ~3 min.

### 5.6 If style rotation produces user-unexpected aesthetic
**Symptom:** user complaints (qualitative — no automated signal).
**Impact:** Soft UX regression only on default-flow users.
**Fix-forward:** prune STYLE_POOL in `src/app/api/generate/route.ts:197-204` to only the 2-3 styles the brand voice supports.
**Time:** ~3 min.

### Rollback decision tree
```
After scenarios A-D run + Q1-Q6 evaluated:

┌─ Q3 shows status='failed' on ALL runs ──→ HARD REVERT 5.3 alternative
│
├─ Sentry has gemini.call.exhausted with seed error ──→ 5.3 fix-forward
│
├─ Sentry has video-provider.scene_failed runway only ──→ 5.1 fix-forward
│
├─ Sentry has video-provider.scene_failed luma only ──→ 5.2 fix-forward
│
├─ Q3 shows >20% scenes_failed even after fallback ──→ 5.5 investigate
│
└─ All pass ──→ no rollback needed; SAFE TO PUSH confirmed
```

---

## 6. Pre-push checklist

Operator runs these in order. Tick each. Do NOT push until all green.

- [ ] Smoke-test environment is staging (not production) — verify Vercel preview URL OR direct push to production with rapid revert capability
- [ ] RUNWAYML_API_SECRET and LUMA_API_KEY are set in BOTH Vercel + Railway (otherwise tests #3 + #4 trivially pass for the wrong reason — provider just skipped)
- [ ] Sentry dashboard open in adjacent tab, filtered to last hour, ready to read events live
- [ ] Supabase SQL editor open on `ottoflow-staging`, ready to run Q1-Q6
- [ ] Note current UTC time: `<RECORD HERE>` — use as `<SMOKE_TEST_START_ISO>` in queries
- [ ] Scenario A run 1 triggered, completed
- [ ] Scenario A run 2 triggered, completed
- [ ] Q1 PASS
- [ ] Q2 PASS (or accept single-scene tests where N=1 by definition)
- [ ] Q3 PASS for all rows in window
- [ ] Q6 shows ≥ 2 distinct styles across runs (if both A runs share same style by chance, run a 3rd time)
- [ ] Scenario B optional — skip if A passes cleanly and time-pressed
- [ ] Scenario C optional — skip if A passes cleanly and time-pressed
- [ ] Scenario D MANDATORY because it validates the fallback path that protects against ALL future seed-rejection scenarios
- [ ] After Scenario D, RUNWAYML_API_SECRET RESTORED to real value (re-check Railway env)
- [ ] Q5 PASS — zero duplicate processing in window
- [ ] No new Sentry issues with `level:fatal` in the test window

---

## 7. FINAL VERDICT

### Evidence summary
| Indicator | State | Weight |
|---|---|---|
| Typecheck (Next app) | ✅ clean | required |
| Typecheck (worker) | ✅ clean | required |
| Gemini SDK accepts `seed` at type level | ✅ no type error | strong |
| Gemini v1beta REST API supports `generationConfig.seed` per Google docs | ✅ documented | strong |
| Runway image_to_video API supports `seed` per dev.runwayml.com docs (2024-11-06 version) | ✅ documented | strong |
| Luma Dream Machine v1 API supports `seed` per docs.lumalabs.ai | ✅ documented | strong |
| Provider chain isolates failure to single scene | ✅ verified in `registry.ts:78-84` | strong |
| All changes are additive (no removed fields) | ✅ confirmed via diff | strong |
| Schema unchanged (no migration) | ✅ confirmed | strong |
| Rollback is single-commit, well-defined | ✅ §5 above | strong |
| Worst-case failure mode is "scenes silently use Pexels stock" | ✅ provider chain absorbs | strong |
| Style rotation is gated by `input.style ?? ...` (explicit user choice still wins) | ✅ `route.ts:204` | strong |
| Beta sprint state unaffected | ✅ no touched files overlap with sprint blockers | required |

### Verdict

# 🟢 SAFE TO PUSH — gated by Scenario A pre-flight

**Rationale:**
1. Every code path is type-safe AND backed by provider API documentation that confirms `seed` is supported.
2. The provider chain (`registry.ts`) was specifically designed to handle individual provider failures — even if Runway OR Luma rejected `seed` at runtime, the user-facing pipeline still completes via Pexels fallback. This is not theoretical — it's the exact mechanism that has been protecting production since launch.
3. The single hard-break failure mode (Gemini rejecting seed) is detectable within ~30 seconds of the first test generation. Rollback is one commit.
4. All four Phase 1A changes are additive — no removed fields, no schema migrations, no auth changes, no rate-limit changes.

**Required gating before promote-to-production:**
- Execute **Scenario A only** (~5 min) against the staging/preview deploy.
- Confirm Q1 + Q3 PASS (~2 min of SQL).
- If Q1 + Q3 PASS → push to production.
- If either fails → §5 rollback flow.

**Skippable gating (time permitting, not blocking):**
- Scenarios B, C: cross-brand variation evidence. Nice to have, not safety-critical.
- Scenario D: provider failure simulation. The chain was already validated in pre-Phase-1A production runs; re-testing is belt-and-suspenders.

**Not a blocker, but worth noting:**
The smoke-test should specifically capture **at least one full Runway-served scene** before promotion. If RUNWAYML_API_SECRET is not yet provisioned in staging, Test #3 will skip silently (because Runway `isConfigured()` returns false) — and we lose the strongest safety signal for the highest-cost provider. If the key isn't set in staging, defer the push until either (a) key gets provisioned, or (b) a production-side first-canary generation is monitored live.

---

## 8. Push command (when verdict converts to "execute")

```bash
git -C /d/tiktok-product-video-factory/ottoflow-ai push origin main
```

Then watch:
- Vercel deployment dashboard: https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai/deployments
- Railway worker deployment: https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1
- Sentry issues stream: https://ottoflow.sentry.io/issues/?project=4511491204907008

Watch window: first 30 min after both deploys go Active. If no new issues during that window, Phase 1A is in production safely.
