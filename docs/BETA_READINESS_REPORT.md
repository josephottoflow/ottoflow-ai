# Beta Readiness Report (2026-06-03)

Honest production-readiness assessment. Written from a Senior Staff
Engineer review after Phase 6 (multi-scene composition) shipped. Sorted
by **launch-blocking severity**, not nice-to-have.

---

## Summary Verdict

**Recommendation: Limited beta — 25-50 invited users, 7-day soak, then
re-evaluate.**

- Functional pipeline works end-to-end. ✅
- All 8 P0 user actions verified live. ✅
- Cost controls absent. 🔴 (blocking public beta)
- Sentry runtime active; source maps unminified. 🟠
- Worker has 1 replica, no auto-scaling. 🟠
- No load testing past N=1. 🟠

The product is genuinely working. The gaps are operational, not
functional. They're addressable in ~5-10 engineering days before public
beta.

---

## Known Risks

### 🔴 P0 — Launch blockers for public beta

#### R1 · No cost ceiling per user
**Location:** Rate limit is request-count (20/hr) not USD spend.
**Worst case:** 20 Runway-default 4-scene videos × $1.00 = **$20/hr per
user**. 100 users × $20 = $2,000/hour worst-case burn.
**Mitigation:** Add `daily_usd_cap` and `monthly_usd_cap` columns on a
`user_billing` table. Query `SUM(scene_generations.cost_usd) WHERE
user_id=X AND created_at > NOW() - INTERVAL '1 day'`. Block
`/api/generate` POST when over.
**Effort:** 4-6h. Required before paid tier or public beta.

#### R2 · Worker memory headroom is tight
**Location:** Railway worker, ffmpeg libx264 normalize step. Fixed
in `af7f4eb` (720x1280, ultrafast, no-mbtree) after live SIGKILL on
1080x1920.
**Risk:** Any future change that touches the ffmpeg path can OOM again.
The error stays silent in user-facing UX until merge_status flips to
'failed' — they just see "Merging audio into MP4…" stuck forever.
**Mitigation:** Already partially in place (signal + full stderr
captured to Sentry as `video.merge.signal_kill`). Add explicit
ffprobe RAM budget check before the encode step.
**Effort:** 2h.

#### R3 · No source-map upload to Sentry
**Location:** `next.config.ts` `withSentryConfig`. Documented as task
#11/#13. `SENTRY_AUTH_TOKEN` was generated; never pasted as
non-Sensitive.
**Impact:** Every stack trace in Sentry shows minified webpack output.
Median time-to-diagnose triples.
**Mitigation:** See B section of this turn's plan.
**Effort:** 30min once user pastes the 3 build-time env vars.

---

### 🟠 P1 — Address before scaling past ~100 users

#### R4 · Single Railway worker replica
**Location:** Railway `ottoflow-ai` service, 1 replica.
**Capacity:** WORKER_CONCURRENCY=2 → 1 brand_research + 1
content_generation + 1 video_merge (capped at 1) running concurrently.
At 5 concurrent video generations the queue backs up.
**Mitigation:** Bump to 2 replicas + WORKER_CONCURRENCY=3 each → 6
concurrent merges. Railway auto-scales on CPU once configured.
**Effort:** 30min Railway dashboard config.

#### R5 · Vercel function timeout on multi-Runway runs
**Location:** `src/app/api/generate/route.ts maxDuration = 300`.
**Worst case:** Runway scene generation @ 60s × 4 scenes / concurrency 3
= ~150s. Add Gemini stages (~60s) → ~210s. Within budget, but Runway
SLA variance + retries can push past 300s.
**Mitigation:** Move scene generation to worker (audit C1/M2). See D
section.
**Effort:** 4-6h.

#### R6 · No per-provider failure budget
**Location:** Registry chain has no circuit-breaker. If Runway has a
30-minute outage, every video tries Runway first, eats 240s polling,
then falls through to Luma. User sees 4-minute waits for a Runway
outage.
**Mitigation:** Add `provider_health` Redis key with rolling failure
window. If Runway > 5 failures in last 5min → skip it for next 5min.
**Effort:** 3h.

#### R7 · No cron sweep of stuck merge jobs
**Location:** Worker `recovery.ts` sweeps stalled jobs at boot, but
not periodically. If a worker dies mid-merge, the job is BullMQ-stuck
until the next worker boot.
**Mitigation:** Add a periodic stuck-job sweep in worker boot
(every 5min interval) on top of the existing boot-time sweep.
**Effort:** 1h.

---

### 🟡 P2 — Address pre-public-launch

#### R8 · 7 `/api/debug/*` endpoints exposed
**Location:** auth-gated, but still publicly reachable. Each is a
potential RCE / info-disclosure vector.
**Mitigation:** Remove pre-public-launch.

#### R9 · 142 pre-existing TS errors in legacy code
**Location:** `worker/processors/brand-research.ts`, `src/agents/*`,
`src/app/studio/page.tsx`. Vercel build ignores them via
`typescript.ignoreBuildErrors`.
**Mitigation:** Fix or delete legacy modules pre-launch.

#### R10 · Higgsfield deferred without ETA
**Location:** Audit doc + registry comment.
**Impact:** Provider chain has 2 AI options not 3. Acceptable for beta.

#### R11 · No backup/restore plan for merged-videos bucket
**Location:** Supabase Storage bucket `merged-videos`.
**Impact:** If a user deletes their account, their merged MP4s are
orphaned. If Supabase has an outage, no fallback CDN.
**Mitigation:** Document the orphan policy. Defer CDN backup until
volume justifies cost.

---

## Scaling Limits

### Compute / API

| Service | Free tier ceiling | Paid escalation path |
|---|---|---|
| **Vercel** | 100 hours/mo function compute, 100GB bandwidth | Pro $20/mo, 1000hr |
| **Railway worker** | 1 replica × 8GB RAM | Add replicas; ~$10/mo each |
| **Supabase Postgres** | 8GB DB, 500MB Realtime | Pro $25/mo, 8GB→100GB |
| **Supabase Storage** | 1GB | Pro adds 250GB/mo egress |
| **Supabase Realtime** | 200 concurrent connections | Pro = 500 |
| **Redis** | Railway ~$5/mo | Same |
| **Sentry** | 5k errors/mo, 100% traces (we sample 10%) | Team $26/mo |
| **Gemini Flash 2.5** | 60 RPM, 1M tokens/day free | Paid $0.30/1M input, $1.20/1M output |
| **ElevenLabs** | 10k chars/mo free | Creator $22/mo, 100k chars |
| **Pexels** | 200 req/hr, 20k/mo | Free unlimited for credits |
| **Jamendo** | Unlimited reads | Free |
| **Runway** | n/a | Pay per use, ~$0.05/sec |
| **Luma** | n/a | Pay per use, ~$0.14/5s clip |
| **Clerk** | 10k MAU | Pro $25/mo, 25k MAU |

### Practical concurrent-user ceiling

| Bottleneck | Concurrent users | Bottleneck removed by |
|---|---|---|
| Worker single replica | ~5 | Add second Railway replica |
| Pexels 200 req/hr | ~12 (8 calls/video × 25 vids/hr) | Cached photo results per prompt OR upgrade |
| ElevenLabs 10k chars/mo | ~15 videos total/mo on free | Upgrade |
| Gemini 60 RPM | ~5 (8 calls/video × 7.5/min) | Upgrade |
| Sentry 5k errors/mo | n/a if we're not failing constantly | n/a |
| Realtime 200 conns | ~200 simultaneously open `/video/generate` | Upgrade |

**Realistic launch ceiling: 25-50 invited beta users without env-tier
upgrades. 100-250 users with $50/mo upgrades. 1000+ requires staged
infra.**

---

## Per-Video Cost Estimate

For a 4-scene, 30-second TikTok ad:

| Provider mix | Variable cost | Notes |
|---|---|---|
| **Pexels only** (today's default) | **$0.00** | Free path; no AI scene gen |
| **Luma only** | **$0.56** | 4 × $0.14/5s ray-flash-2 |
| **Runway-default with fallback** | **~$0.67** | 1 Runway + 3 Luma typical |
| **Runway only** (premium) | **$1.00** | 4 × $0.25/5s gen4.5 |

Fixed overhead per video (always):
- Gemini (script + storyboard + SEO + overlay): ~$0.02
- ElevenLabs narration (30s): ~$0.06
- Jamendo: $0.00
- Supabase Storage upload (~3MB): ~$0.00

**Bottom line per-video cost (current Pexels-default chain): $0.08
fixed.** With Runway: $1.08.

At 1,000 videos/month with Runway primary: ~$1,080/month variable cost.
Reasonable margin if charging $15-29/mo per user with usage caps.

---

## Failure Mode Catalog

| Mode | Detection | Current handling | Gap |
|---|---|---|---|
| **Gemini 503 (model overloaded)** | Captured at `gemini.call.exhausted` Sentry tag | Retry with exponential backoff; if all 3 attempts fail, brand stays in `failed` status | None |
| **ElevenLabs auth failure** | `ElevenLabsNotConfiguredError` instance check | Logs warn, skips voice stage, pipeline continues without audio | None — voice is optional |
| **Pexels CDN 503 mid-download** | `downloadToFile` non-200 throw | Worker job marked failed | 🟠 No retry — see audit M5 |
| **Runway 401/403** | HTTP non-200 in `runway.ts` | Registry falls through to Luma → Pexels | None |
| **Luma 429 rate limit** | HTTP 429 in `luma.ts` | Registry falls through to Pexels | None |
| **All providers exhausted** | `AllProvidersExhaustedError` | Scene marked failed in scene_generations, pipeline tries single-clip Pexels fallback at end | None for now |
| **Worker OOM (SIGKILL)** | `signal: "SIGKILL"` in ffmpeg result | Job marked failed with full stderr in `merge_error` | 🟠 Page shows "Merging..." until user reloads — see C7 |
| **Vercel function timeout** | Function killed at 300s | SSE stream closes mid-pipeline, no `done` event | 🔴 Page hangs on "Generating storyboard…" — see R5 |
| **Supabase Storage upload 5xx** | non-200 from `storage.upload` | merge_status → failed, error captured | None |
| **Clerk session expiry** | `auth()` returns null | 401 on API routes, redirect on pages | None |
| **Race: two concurrent merges for same job** | BullMQ jobId dedup | Second call silently ignored | None |

### New (Phase 6) failure modes

| Mode | Detection | Current handling | Gap |
|---|---|---|---|
| **Scene N fails entirely** | Try/catch around `generateScene()` | Persisted to `scene_generations` with `provider: 'failed'` + `fallback_reason`. Concat skips it. | None |
| **Mixed-resolution scenes** | Pre-encode normalize to 720x1280 | Scale+pad+setsar=1 normalizes everything | None |
| **Scene clip download mid-merge** | `downloadToFile` failure | Job fails | 🟠 Same as Pexels CDN retry gap |
| **All scenes fail → fallback Pexels also fails** | Try/catch wraps fallback | videoUrl stays at PLACEHOLDER_VIDEO_URL (Big Buck Bunny) | 🟡 Visible "wrong video" — acceptable for now |

---

## Recommended Monitoring

### Sentry dashboards to create

1. **Video Pipeline Error Rate**
   - Filter: `fallback.label IN (video.generate.*, video.merge.*)`
   - Visualization: stacked area, group by `fallback.label`
   - Alert: > 5 errors / 5min

2. **Provider Health**
   - Filter: `fallback.label:video-provider.scene_failed`
   - Group by provider tag
   - Alert: any provider > 20% failure rate over rolling 1h

3. **Worker Lifecycle**
   - Filter: `runtime:worker AND fallback.label:worker.*`
   - Alert: any `unhandledRejection` or `uncaughtException`

### Supabase queries to surface (Phase C deliverable)

1. **AI cost burn**: `SUM(scene_generations.cost_usd) GROUP BY DATE_TRUNC('day', created_at)`
2. **Provider success rate**: `COUNT(*) FILTER (WHERE clip_url IS NOT NULL) * 100.0 / COUNT(*) GROUP BY provider`
3. **Avg generation time**: `AVG(generation_time_ms) GROUP BY provider`
4. **Active brands**: `COUNT(DISTINCT brand_id) WHERE created_at > NOW() - INTERVAL '7 days'`
5. **Videos generated per user**: `COUNT(*) FROM render_jobs WHERE user_id = X AND created_at > today`

### External monitoring

| Service | Provider | Purpose |
|---|---|---|
| Uptime ping `/api/debug/health` | UptimeRobot free | 5-min health check |
| Status page | Statuspage / Better Stack | Public status for beta users |
| Cost alerts | Vercel + Supabase billing alerts | Catch runaway burn |

### Alert thresholds

- **P0 — page on-call:** `/api/generate` 5xx > 5 in 5min
- **P0:** Worker process exit (Railway healthcheck)
- **P1 — Slack:** Sentry new issue with `runtime:worker`
- **P1:** Provider failure rate > 30% for 15min
- **P2 — daily digest:** Cost above $50/day

---

## Beta Launch Checklist

- [ ] R1 — Cost ceiling per user
- [ ] R3 — Sentry source-map upload (this turn)
- [ ] R4 — Bump Railway to 2 replicas
- [ ] R5 — Move scene gen to worker (this turn)
- [ ] R7 — Periodic stuck-job sweep
- [ ] Create the 3 Sentry dashboards above
- [ ] Wire UptimeRobot + Statuspage
- [ ] Set Vercel + Supabase billing alerts at $100, $250, $500
- [ ] Audit + delete 7 `/api/debug/*` endpoints
- [ ] User-facing CHANGELOG.md auto-updated from commits
- [ ] Soft-launch to 5 internal users for 48h before opening beta
- [ ] Decision review at day 7 with metrics
