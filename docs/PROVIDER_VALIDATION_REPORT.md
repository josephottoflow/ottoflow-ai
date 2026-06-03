# Provider Validation Report

Status: **AWAITING API KEYS**

Last filled: never. The report below is the TEMPLATE that will be
populated with real production data once `RUNWAYML_API_SECRET` and
`LUMA_API_KEY` land in Vercel + Railway.

This document MUST be filled with real numbers — no estimates — before
the launch checklist can move R1 (provider health) from UNKNOWN to PASS.

---

## Validation methodology

When run, this protocol must be followed exactly:

1. Provision both keys as Sensitive env vars on Vercel and Railway, Production + Preview.
2. Wait for Railway worker to redeploy (~3-5 min). Verify Active status.
3. Confirm registry chain order in deployed code: Runway → Luma → Pexels.
4. Generate 20 videos minimum (4 scenes each = 80 scene attempts) via the live `/video/generate` brand-driven flow. Use varied topics across at least 3 brands.
5. Wait for all 20 merges to complete (or fail).
6. Run the verification queries below against `scene_generations`.
7. Paste verbatim results into "Run results" section.
8. Make the YES/NO determination at the bottom.

---

## Verification queries

### Per-provider stats over the validation window
```sql
SELECT
  provider,
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE clip_url IS NOT NULL) AS successes,
  ROUND(100.0 * COUNT(*) FILTER (WHERE clip_url IS NOT NULL) / COUNT(*), 1) AS success_pct,
  ROUND(AVG(generation_time_ms)::numeric, 0) AS avg_ms,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY generation_time_ms)::numeric, 0) AS p50_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms)::numeric, 0) AS p95_ms,
  ROUND(SUM(cost_usd)::numeric, 2) AS total_cost_usd,
  ROUND(AVG(cost_usd)::numeric, 3) AS avg_cost_usd,
  COUNT(*) FILTER (WHERE fallback_reason IS NOT NULL) AS fallback_count
FROM scene_generations
WHERE created_at >= '<START_ISO>'   -- fill with the validation start time
  AND created_at <  '<END_ISO>'     -- fill with the validation end time
GROUP BY provider
ORDER BY attempts DESC;
```

### Failure-mode catalog
```sql
SELECT provider, fallback_reason, COUNT(*) AS occurrences
FROM scene_generations
WHERE created_at >= '<START_ISO>' AND fallback_reason IS NOT NULL
GROUP BY provider, fallback_reason
ORDER BY occurrences DESC;
```

### End-to-end success
```sql
SELECT
  COUNT(*) AS total_render_jobs,
  COUNT(*) FILTER (WHERE merged_video_url IS NOT NULL) AS merged_successfully,
  ROUND(100.0 * COUNT(*) FILTER (WHERE merged_video_url IS NOT NULL) / COUNT(*), 1) AS end_to_end_pct
FROM render_jobs
WHERE created_at >= '<START_ISO>' AND created_at < '<END_ISO>';
```

---

## Run results

> Replace `_NOT YET RUN_` with the actual run results once keys are
> provisioned and 20 generations complete.

**Validation window:** _NOT YET RUN_
**Total render_jobs in window:** _NOT YET RUN_
**End-to-end success rate:** _NOT YET RUN_

### Provider performance table

| Provider | Attempts | Successes | Success % | Avg gen | P50 | P95 | Total Cost | Avg Cost | Fallbacks |
|---|---|---|---|---|---|---|---|---|---|
| runway | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ |
| luma | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ |
| pexels | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ |
| failed | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ | _NOT YET RUN_ |

### Failure modes observed
_NOT YET RUN_

---

## Acceptance criteria for "validated"

| Criterion | Threshold | Status |
|---|---|---|
| Runway success rate | ≥ 85% | UNKNOWN |
| Luma success rate | ≥ 85% | UNKNOWN |
| Pexels success rate (fallback) | ≥ 99% | UNKNOWN |
| End-to-end pipeline success | ≥ 90% | UNKNOWN |
| Runway P95 latency | ≤ 90s | UNKNOWN |
| Luma P95 latency | ≤ 60s | UNKNOWN |
| Per-video cost (Runway-primary path) | ≤ $1.50 | UNKNOWN |
| No untracked failure modes | n/a | UNKNOWN |

---

## Pre-existing baseline (Pexels-only, the only path tested at scale today)

These come from the live `scene_generations` table as of 2026-06-03.

| Provider | Attempts | Successes | Success % | Avg gen | P50 | P95 | Cost |
|---|---|---|---|---|---|---|---|
| pexels | 7 | 7 | 100% | 0.1s | 0.0s | 0.3s | $0.00 |

7 scenes is far below the 80-attempt floor this report requires. The
existing baseline is informative but not sufficient — the protocol
above must still run end-to-end once keys arrive.

---

## What this report does NOT cover

- ElevenLabs and Gemini reliability — covered by existing Sentry tags `gemini.call.exhausted` and the ElevenLabs catch path in `/api/generate`. Both have been observed under prior testing; no validation rerun required for them.
- Pexels CDN flakiness — known M5 in `BETA_READINESS_REPORT.md`; documented as accepted risk for beta.
- Higgsfield — intentionally not validated (no public REST API). Documented in `VIDEO_GEN_ARCHITECTURE.md`.
