# Video Pipeline Architecture Audit (2026-06-03)

Honest review after shipping Phase 6 (scene-based composition + real
Runway/Luma providers). Findings sorted by **production impact**, not
nice-to-have.

---

## Current End-to-End Flow

```
POST /api/generate (SSE, Vercel Function, maxDuration=300s)
  ├─ Stage 1 · Gemini generateVideoScript                      ~6-12s
  ├─ Stage 2 · Gemini generateVideoStoryboard                  ~8-15s
  ├─ Stage 3 · ElevenLabs synthesizeNarration                  ~5-10s
  ├─ Stage 4 · Imagen 3 hero frame (always 404s currently)     <2s
  ├─ Stage 5 · Jamendo findTrackByVibe                         ~1-3s
  ├─ Stage 7 · Gemini generateVideoSEO                         ~5-10s
  ├─ Stage 7b · Gemini extractImportantWords                   ~5-10s
  ├─ Stage 6 · PER-SCENE generation (NEW)
  │    ├─ for each storyboard.scenes[i], in parallel-3:
  │    │    registry.generateScene() walks chain:
  │    │      Runway gen4.5  → ~30-60s if configured
  │    │      Luma ray-flash → ~25-45s if configured
  │    │      Pexels search  → ~0.5-1s always works
  │    └─ N rows persisted to scene_generations
  └─ emit SSE done event ; enqueue video-merge BullMQ job

Worker processVideoMerge (Railway, BullMQ)
  ├─ Download N scene clips + narration + music in parallel
  ├─ Normalize each scene to 1080x1920@30fps (libx264)         ~2-5s/scene
  ├─ ffmpeg concat demuxer → composite videoIn
  ├─ Drawtext overlay chain + audio mix (libx264 re-encode)    ~5-15s
  └─ Upload merged MP4 to Supabase Storage
```

**Total wall-clock for the user:**
- Without any AI provider keys: ~45-80s for the SSE + 5-15s for merge → ~1-2 min
- With Luma keys: +20-40s for parallel scene gen → ~2-3 min
- With Runway keys: +30-90s for parallel scene gen → ~2-4 min

---

## Critical Findings

### 🔴 C1 · Vercel Function timeout exposure on multi-scene runs with Runway

**Location:** `src/app/api/generate/route.ts` `maxDuration = 300` (5 min)

**Risk:** When Runway is configured, scenes generate at 30-60s each. With 4 scenes at concurrency 3, the math is:
- First batch (3 scenes): ~60s
- Second batch (1 scene): ~30s
- Plus Gemini calls before: ~50s
- **Total: ~140s** — within budget, but with rate-limiting + retries the worst case is ~200-280s.

**Mitigation already in place:** Concurrency cap of 3 prevents parallel-N spawning. Each provider has a 4-min polling deadline (`POLL_TIMEOUT_MS = 240_000` in runway.ts/luma.ts).

**Recommended fix:** Move per-scene generation to the worker (BullMQ has no SSE constraint). The SSE pipeline returns done immediately after Gemini stages; worker handles scenes + concat + overlay + upload. Pro: removes timeout pressure entirely. Con: page must wait on Realtime for `merged_video_url` to appear (already wired for the current flow).

### 🔴 C2 · No cost ceiling per user

**Location:** Rate limit only counts API calls (20/hr), not USD spend.

**Risk:** A single user could generate 20 4-scene videos in an hour with Runway = **$20/hr per user**. At scale, malicious or buggy clients could rack up bills.

**Recommended fix:** Add daily/monthly USD ceiling per user, query against `scene_generations.cost_usd` SUM. Block submission when above threshold.

### 🟠 M1 · Imagen 3 hero frame attempt is dead weight

**Location:** `src/app/api/generate/route.ts` Stage 4 + `src/lib/gemini.ts` `generateHeroFrame`

Returns 404 NOT_FOUND on every single run. Adds ~2s + a warn log + Sentry breadcrumb. Pure noise.

**Fix:** Gate behind `ENABLE_IMAGEN3 === "true"` env flag; ship `false` by default. Re-enable when Vertex AI access is provisioned.

### 🟠 M2 · Scene generation is in the SSE route, not the worker

Per C1 — moving scenes to the worker is the right architectural move once we hit production load. Today it's fine, but the trade is "page sees live scene-by-scene progress" vs "no timeout risk".

### 🟠 M3 · Drawtext overlay positions only ever land at y=h*0.65

`worker/processors/video-merge.ts buildDrawtextChain`. All overlays land in the same vertical band. For scene-aware overlays (e.g. CTA overlays moved to bottom-third for legibility under subtitles), we need positional metadata in the `KeywordOverlay` shape and surface it through to drawtext.

### 🟠 M4 · No scene-boundary alignment for overlays

Current overlay timing is based purely on narration timestamps. If a scene cuts at 4.0s and an overlay starts at 3.9s, it crosses the cut — looks jarring. **Fix:** post-process `KeywordOverlay[]` against `scenes[].durationSec` cumulative timeline; snap overlay starts within ±0.2s of a scene boundary.

### 🟠 M5 · No worker-side retry on Pexels CDN flakiness

`worker/processors/video-merge.ts` `downloadToFile` fails immediately on non-200. Pexels' CDN occasionally serves transient 503. Single retry with 2s backoff is the standard fix.

---

## Cost Estimates per Video

For a 4-scene, 30-second TikTok ad:

| Path | Provider mix | Cost | Notes |
|---|---|---|---|
| Pexels only | 4× Pexels | **$0.00** | Existing free path |
| Luma only | 4× Luma ray-flash | **$0.56** | 4 × $0.14/5s clip |
| Mixed (1 Runway + 3 Luma) | | **$0.67** | Default fallback when Runway fails on 3 scenes |
| Runway only | 4× Runway gen4.5 | **$1.00** | Premium quality |
| Plus Gemini + ElevenLabs + Jamendo | (all paths) | **~$0.03-0.10** | Audio + script overhead |

**Monthly burn at 1,000 videos/month, Runway-default:** ~$1,000

---

## Scaling Concerns

### Q · Vercel Function memory budget
SSE route holds Gemini responses + narration data URL (up to ~1MB base64) in memory for the duration of the run. Node Function default is 1024MB; we're well under.

### Q · BullMQ worker concurrency
`worker/index.ts` defines `videoMergeWorker` with `concurrency: Math.max(1, Math.floor(WORKER_CONCURRENCY/2))`. Default WORKER_CONCURRENCY=2 → merge concurrency=1. **OK for current load**; once we hit >10 simultaneous merges we'll need a second Railway replica.

### Q · Supabase Storage egress
Each merged MP4 is ~2-5MB. At 1,000 downloads/month = 5GB egress. Supabase Pro tier includes 250GB/month — no concern until ~50k downloads.

### Q · Runway rate limits
Runway publishes ~60 req/min default for Gen-4. Our concurrency cap (3) + ~30-60s per task = max 9 active tasks → safe.

### Q · Luma rate limits
Luma documented limits unclear in our docs cache; conservative cap at concurrency 3 should stay under.

### Q · Pexels rate limit
200 req/hr free tier. Each scene needs 1 video search + (Runway path) 1 photo search = up to 8 calls/video. At 25 videos/hour we hit the cap. **Mitigation:** request higher quota or cache photo results per scene prompt.

---

## Recommended Optimizations (sorted by ROI)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | Gate Imagen 3 behind env flag (M1) | 15min | Removes per-run noise |
| 2 | Move scene generation to worker (C1, M2) | 2-4h | Eliminates timeout risk |
| 3 | Add USD ceiling rate limit (C2) | 1h | Cost control |
| 4 | Scene-aware overlay positioning (M3, M4) | 2h | Visual polish |
| 5 | Pexels CDN retry (M5) | 30min | Reliability |
| 6 | Cache Gemini outputs (prompt → script) | 4-6h | -50% cost on regenerates |

---

## What Got Cut Honestly From "Phase 6" Spec

- **HiggsfieldProvider** — Higgsfield exposes an SSE MCP server, not a documented REST API. Shipping a stub that pretends to call an API I haven't verified violates the project's "no fake API integrations" rule. Filed as future work behind an MCP-from-worker client (significant scope).
- **Scene-boundary overlay alignment** (M4) — included as a finding here; ship in a follow-up commit when product validates the basic multi-scene path.

---

## Provider Configuration Status

| Provider | Env var | Current state |
|---|---|---|
| Pexels | `PEXELS_API_KEY` | ✅ Configured (used today) |
| Runway | `RUNWAYML_API_SECRET` | ⏳ Not provisioned — scaffold ships, activates on paste |
| Luma | `LUMA_API_KEY` | ⏳ Not provisioned — scaffold ships, activates on paste |
| Higgsfield | n/a | ❌ Deferred — no documented REST |
| ElevenLabs | `ELEVENLABS_API_KEY` | ✅ Configured |
| Jamendo | `JAMENDO_CLIENT_ID` | ✅ Configured |
| Gemini | `GOOGLE_API_KEY` | ✅ Configured |
