# Video Generation Architecture (2026-06-03)

Senior Staff Engineer recommendations for Phases 4 (overlay rendering) and 5 (AI video providers).

---

## Phase 4 · Dynamic Text Overlay — Recommendation: FFmpeg `drawtext`

### Decision: FFmpeg `drawtext` for MVP. Defer Remotion.

### Evaluated options

| | FFmpeg `drawtext` | Remotion |
|---|---|---|
| **Animations supported** | Fade in/out (via `alpha=if(...)`), timed appearance/removal, font size, weight, color, border, shadow | Full React animation: scale pop, slide, glitch, mask reveal, springs |
| **Dependency cost** | 0 — already in Railway nixpacks image | Headless Chromium (~250MB) + Lambda function or worker setup |
| **Render time impact** | +0–5s (stays in stream-copy mode IF text is pre-baked into a separate stream) | +30-90s (programmatic browser render per frame) |
| **Worker memory** | Same as current (~200MB ffmpeg) | +1-2GB during render |
| **Operational risk** | Low — same toolchain we already debugged | New attack surface (Chromium CVEs, render-server crash modes) |
| **Animation richness** | "Good enough" for viral TikTok keyword overlays | Premium feel, agency-grade |

### Why drawtext wins for *this* product

The user explicitly requested **keyword-only overlays in TikTok viral style**. Look at the highest-performing examples:

- @mrwhosetheboss, @marquesbrownlee: BOLD CAPS, single keyword, ~0.8-1.2s fade in/out
- @huberman_clips: yellow highlight, no animation
- @hormozi clips: white text + black stroke, instant pop, no easing

**None of these need Remotion.** They need bold text appearing at the right millisecond, with a soft fade. FFmpeg `drawtext` does this natively with the `enable='between(t,start,end)'` expression + `alpha` envelope.

When/if we want premium motion (multi-line stagger, mask reveal, brand-themed templates), Remotion becomes worth the operational lift. Defer that decision until product validates demand.

### Drawtext filter pattern

For each keyword in `extractImportantWords()` output:

```
drawtext=
  fontfile='/path/to/Inter-Black.ttf':
  text='DESTROYING':
  fontcolor=white:
  fontsize=92:
  borderw=6:
  bordercolor=black:
  x=(w-text_w)/2:
  y=h*0.62:
  enable='between(t,1.2,2.0)':
  alpha='if(lt(t,1.2),0, if(lt(t,1.35),(t-1.2)/0.15, if(lt(t,1.85),1, if(lt(t,2.0),(2.0-t)/0.15, 0))))'
```

The `alpha` expression encodes: fade in 0.15s → hold → fade out 0.15s. Multiple keywords are chained as separate `drawtext` filters in the same filter_complex.

### Worker integration

Add a new stage in `worker/processors/video-merge.ts` BEFORE the audio merge:
1. Pre-bake the text overlay onto the video stream (re-encodes once)
2. Continue with existing audio merge (stream-copy video, mix audio)

Trade-off: we lose the stream-copy speed advantage we gained in `f21ae6d`. New merge time: ~5-15s instead of 2.8s. Acceptable.

### Font shipping

Bundle a font with the worker. **Recommend Inter Black or Anton Regular** (both Apache 2.0). Place at `worker/assets/fonts/Inter-Black.ttf`. esbuild config will need a `loader: { ".ttf": "file" }` rule. Path is resolved at runtime from `import.meta.url` or `__dirname`.

---

## Phase 5 · AI Video Providers — Recommendation: Runway primary + Pexels fallback

### Decision

1. **Primary:** Runway Gen-3 Alpha Turbo (text-to-video API)
2. **Fallback:** Pexels stock clip search (existing path)
3. **Deferred until SDK ships:** Google Veo 3
4. **Not implementing yet:** Higgsfield, Kling, Pika

### Provider landscape

| Provider | API status | Pricing (approx.) | Clip length | Vertical 9:16 | Concerns |
|---|---|---|---|---|---|
| **Runway Gen-3 Alpha Turbo** | ✅ Production REST API | ~$0.05/sec ($0.25 for 5s clip) | 5-10s | ✅ | Most mature; well-documented |
| **Luma Dream Machine** | ✅ Production REST API | ~$0.40 for 5s clip | 5s | ✅ | Slower queue; less control |
| **Higgsfield** | ⚠️ MCP exists in our `.mcp.json` | Unknown | Variable | ⚠️ Check | Early API; reliability unknown |
| **Veo 3** | ⏸️ Not in `@google/genai` v0.3.0 SDK | TBD | TBD | TBD | Will integrate when SDK lands |
| **Pika 2.0** | ⚠️ Invite-only API | N/A publicly | 3s | ✅ | Can't ship publicly |
| **Kling 1.6 / 2.0** | ⚠️ Bytedance / Kuaishou | Region restrictions | 5-10s | ✅ | Data sovereignty concerns for US customers |

### Pricing math for a 30s TikTok ad

- **Runway:** 6 × 5s scenes × $0.25 = **$1.50/video**
- **Luma:** 6 × 5s scenes × $0.40 = **$2.40/video**
- **Pexels fallback:** Free

If we render 500 videos/month at $1.50 = $750/month. Acceptable for a paid SaaS tier.

### VideoProvider interface

```ts
// src/lib/video-providers/types.ts
export interface SceneRequest {
  prompt: string;           // visual description
  durationSec: number;      // 3-10
  style?: string;           // cinematic / ugc / minimal / etc
  aspectRatio?: "9:16" | "16:9" | "1:1";
}

export interface SceneResult {
  url: string;              // direct MP4 URL
  durationSec: number;
  provider: string;         // 'runway' | 'pexels' | etc
  cost?: number;            // for billing aggregation
  metadata?: Record<string, unknown>;
}

export interface VideoProvider {
  name: string;
  isConfigured(): boolean;
  generateScene(request: SceneRequest): Promise<SceneResult>;
}
```

### Implementation order

1. ✅ Scaffold interface + `PexelsFallbackProvider` (this PR — re-uses `findStockVideoByPrompt`)
2. ⏳ Add `RunwayProvider` once `RUNWAY_API_KEY` is provisioned (user paste required)
3. ⏳ Add `HiggsfieldProvider` after Runway is validated (lower priority)
4. ⏸️ `VeoProvider` when `@google/genai` ships `generateVideos`

### Fallback chain

```
generateScene(request):
  for provider in [Runway, Higgsfield, Pexels]:
    if not provider.isConfigured(): continue
    try:
      return await provider.generateScene(request)
    catch (err):
      log warn + Sentry capture
      continue
  throw "all providers exhausted"
```

Order is configurable per-user-tier in the future. For MVP: Runway → Pexels.

### Why not Higgsfield first

We have the MCP server but no documented production API SLA. Validating against Runway (a known quantity) de-risks the abstraction, then we add Higgsfield in a follow-up once we have real failure-mode data.

---

## Phase 6 · Scene-Based Composition (Sketch)

Depends on Phase 5 landing real providers. High-level:

1. `generateVideoStoryboard()` already outputs 3-6 scenes with `durationSec`, `description`, `shotType`
2. New flow: storyboard → for each scene, `generateScene(provider, scene.description)` in parallel
3. Concatenate via `ffmpeg concat` filter with optional crossfade transitions
4. Single merged track of narration + music applied as today

Worker concurrency: cap at 3 parallel scene generations per render to avoid hammering Runway rate limits.

---

## Open Questions for the User

1. **Provider keys** — paste `RUNWAY_API_KEY` to Vercel (Sensitive, Production+Preview) when ready
2. **Font choice** — Inter Black, Anton Regular, or upload your own?
3. **Cost guardrails** — should we add a per-user daily generation cap? (Currently 20/hr rate limit only)
