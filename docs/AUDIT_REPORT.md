# Ottoflow AI — Architecture Audit Report (2026-06-03)

Authored from a Senior Staff Engineer review against `docs/PROJECT_MEMORY.md` + live code. Findings are concrete, with file paths + line ranges. Severity: **🔴 Critical** / **🟠 Medium** / **🟡 Low**.

---

## Critical Issues

### 🔴 C1 · Provider toggle is cosmetic — no actual AI video generation

**Location:** `src/app/api/generate/route.ts:73, 152, 173` + `src/app/video/generate/page.tsx` AI Provider buttons.

**Problem:** Zod accepts `"veo3" | "higgsfield" | "imagen3"` but the value is only stored in `render_jobs.template` and tagged in Sentry. **No code path branches on `provider` to select a different video source.** Every render calls `findStockVideoByPrompt()` (Pexels). User-facing controls misrepresent system capability.

**Impact:** Promises of "AI Video" to users are false. Provider claims could be misrepresentation if shown to customers/investors.

**Fix:** Implement `VideoProvider` interface (Phase 5), wire real providers, or remove the toggle. **Scaffold added in this PR.**

---

### 🔴 C2 · Veo 3 stub silently appears in every render

**Location:** `src/app/api/generate/route.ts:303-306`.

**Problem:** Pipeline emits `"Per-scene Veo 3 generation — stub: @google/genai v0.3 ships generateImages only, no generateVideos yet"` as a warn log on every run. Looks like a feature; is actually a permanent unimplemented stub.

**Fix:** Replace with the new VideoProvider abstraction. **Scaffolded in this PR.**

---

### 🔴 C3 · No persistence of generated videos for history view

**Location:** `render_jobs` row IS created and updated, BUT:
- No `script_json` column — generated scripts are lost
- No `storyboard_json` column — storyboards are lost
- No `seo_json` column — SEO copy is lost
- No `keyword_overlay_json` column — (and the feature doesn't exist yet)
- Page state is the only place this data lives

**Impact:** Users can't revisit past generations. A page reload destroys context. Phase 7 explicitly addresses this.

**Fix:** Extend `render_jobs` schema in a follow-up migration to persist all SSE event payloads.

---

### 🔴 C4 · Imagen 3 hero frame perpetually 404s in every render

**Location:** `src/app/api/generate/route.ts:284-301`, `src/lib/gemini.ts:801-832`.

**Problem:** Hero frame step calls `imagen-3.0-fast-generate-001` which returns `NOT_FOUND` on v1beta API for our key tier. Every pipeline emits a warn log; users see a perpetual broken stage.

**Fix:** Either (a) gate the hero-frame attempt behind an explicit `enableImagen3` config flag, or (b) move it to Imagen 4 / Vertex AI when access is provisioned, or (c) drop it entirely until a real value-add exists. **Recommended: gate behind env flag** (low effort, removes noise).

---

## Medium Issues

### 🟠 M1 · `/video/generate` page is monolithic + has no Brand context

**Location:** `src/app/video/generate/page.tsx` (~870 lines).

**Problem:** Single client component with prompt textarea, provider toggle, scenes count, vibe picker, SSE consumer, 6-stage timeline, video player, audio players, SEO card, merge state, copy logic, AND state for every field. No Brand selection. No Topic selection. No brand voice influence on generated script.

**Impact:** Decoupling Video Pipeline from Brand Research wastes the brand profile asset. Generated scripts could be brand-aligned but currently aren't.

**Fix:** Phase 2 rebuild — `Brand selector → Topic selector → Style → Generate`. Break into smaller composed components.

---

### 🟠 M2 · Provider field in render_jobs is a string, not an enum

**Location:** `render_jobs.template` (TEXT).

**Problem:** `template` column receives `"veo3"` / `"higgsfield"` / `"imagen3"` / `"product-video"` / `"cinematic"` etc. No DB constraint, no validation of what's a valid provider vs a Remotion composition id (from the root project).

**Fix:** Either rename to `video_provider` + add CHECK constraint, or document that `template` is "best-effort provider hint" and don't trust it.

---

### 🟠 M3 · Per-prompt audio is computed but never persisted

**Location:** `src/lib/elevenlabs.ts` returns base64 data URL inline.

**Problem:** Inline base64 audio (574KB-1MB per render) flows through the SSE stream and lives only in the page's `useState`. Never written to Supabase Storage. If user reloads, narration is gone forever.

**Impact:** Page reload mid-flow destroys assets. Cannot re-merge if merge worker fails. Cannot link to narration externally.

**Fix:** Persist narration MP3 to `merged-videos` bucket as `{userId}/{renderJobId}-narration.mp3`. Persist music URL on render_jobs row.

---

### 🟠 M4 · No retry endpoint for failed merges

**Location:** Worker `processVideoMerge` failure path.

**Problem:** If ffmpeg merge fails after the SSE pipeline closed, user has no UI to retry. Has to regenerate the whole video (expensive — Gemini + ElevenLabs cost).

**Fix:** POST `/api/video/[renderJobId]/retry-merge` that re-enqueues the merge job with current asset URLs.

---

### 🟠 M5 · Brand Research is the entry point but Topics are not surfaced

**Location:** `src/app/brands/[id]/BrandDetailClient.tsx` shows profile + competitors + keywords + pillars. **Does not show suggested topics, hooks, or "Generate Video" CTAs.**

**Impact:** User finishes brand research → no obvious next step → flow dies.

**Fix:** Phase 1 brand_topics + Phase 2 UI rebuild address this. **brand_topics ships in this PR.**

---

### 🟠 M6 · `getAnalyticsData()` is mock

**Location:** `src/app/analytics/page.tsx`, uses `mockChartData`.

**Problem:** Analytics page shows fake data. Customer demo risk.

**Fix:** Wire `getAnalyticsData()` against `content_items`, `render_jobs`, `brand_research_jobs` aggregations. Already tracked as task #18.

---

## Low Priority

### 🟡 L1 · Gemini blog body sometimes mixes HTML + markdown
**Location:** `src/app/content/[id]/ContentItemDetailClient.tsx`. Whitespace-preserved rendering exposes literal `<ul><li>` tags. Already tracked as #34.

### 🟡 L2 · 142 pre-existing TS errors
**Location:** `worker/processors/brand-research.ts`, `src/agents/*`, `src/app/studio/page.tsx`. Vercel build pipeline ignores. Should be cleaned pre-public-beta.

### 🟡 L3 · `/api/debug/*` endpoints (7) exposed
**Location:** `src/app/api/debug/*`. Auth-gated but should be removed pre-public-beta.

### 🟡 L4 · `/content` Pipeline Workflow diagram is static
**Location:** `src/app/content/ContentPageClient.tsx`. Steps 5-7 always grey regardless of state.

### 🟡 L5 · `provider` defaults to `"veo3"` (line 157 in route.ts)
Cosmetic but compounds C1 — defaults to a provider that doesn't exist.

### 🟡 L6 · No structured logging for `/api/generate` SSE events
SSE log events are sent to the browser but not persisted server-side. Hard to debug user reports without asking them to copy-paste logs.

### 🟡 L7 · Music looping decision is fragile
`amix=duration=first` follows narration. If narration is 26s and music is 50s, music gets cut at 26s with no fade-out. Add `afade` filter pre-mix for graceful endings.

### 🟡 L8 · `/projects` page has no functional brand→project flow
Static UI. Already documented as out-of-scope-for-v1.

---

## Counted Findings

| Severity | Count |
|---|---|
| 🔴 Critical | 4 |
| 🟠 Medium | 6 |
| 🟡 Low | 8 |
| **Total** | **18** |

---

## Recommended Order of Operations

1. **Phase 1 (brand_topics)** — foundational, unblocks Phase 2 UI
2. **Phase 3 (extractImportantWords)** — small, independent, ready for Phase 4 consumer
3. **Phase 4 (rendering)** — FFmpeg drawtext recommended (see `docs/VIDEO_GEN_ARCHITECTURE.md`)
4. **Phase 5 (provider research + scaffold)** — interface ready, real provider needs key + decision
5. **Phase 2 (UI rebuild)** — depends on 1, 4
6. **Phase 6 (scene-based generation)** — depends on 5
7. **Phase 7 (history view)** — small, can ship anytime after 1
8. **Fix C2, C4, M3, M4** as follow-ups
