# OTTOFLOW_VIDEO_V1_UX_SPEC.md

**Buildable UX/UI spec for the Video V1 layer that sits on the existing backend.** Backend is fixed (AtlasCloud live-proven, Redis fix pending, R2/FFmpeg/strategy as-is). Findings live in [OTTOFLOW_VIDEO_V1_AUDIT.md](OTTOFLOW_VIDEO_V1_AUDIT.md); this doc is the implementation spec.

**Anchors (real, verified):**
- API: `POST /api/video/generate {brandId, contentItemId, platform?, dryRun?, approve?}`. `dryRun:true`→`{mode:'dry-run', strategy, scenePlan, compositionPlan, estimate}` (200, no spend). neither flag→`{mode:'estimate', requiresApproval:true, estimate}` (200). `approve:true`→creates `render_jobs` + enqueues, returns **202** `{renderJobId}`.
- `estimate = {provider:'seedance', sceneCount, perSecondUsd:0.1, totalBillableSeconds, estimatedCostUsd, perScene[]}`.
- Tables: `brand_topics` · `content_items(title,brand_id,status)` · `content_creatives(creative_brief jsonb: visual_tension, visual_metaphor, palette, cta, headline, logo_usage; background_source; storage)` · `render_jobs(id,name,status,progress,render_kind='ai-first',scene_provider,merge_status,merged_video_url,video_strategy,brand_id,user_id)` · `scene_generations(render_job_id, sceneId, provider, status, storage_url)` · `brand_assets(id, asset_role?, storage_path)`.
- All routes Clerk-protected (`auth.protect()`). Existing reusable: `CreativePanel` (~2.5s polling), `Sidebar`, `DashboardLayout`, `ActivityFeed`, `RenderQueue`, `KPICard`.
- **Hard UX rule:** Video generation requires a `content_item` whose latest `creative_brief` has `visual_tension` AND `visual_metaphor`. The "Generate Video" affordance must be **gated on that** and explain itself when disabled.

---

## 1. VIDEO V1 — UX AUDIT
| Area | What user sees TODAY | What user EXPECTS | Missing | Redesign |
|---|---|---|---|---|
| Start a video | nothing (route is API-only); `/video/generate` = legacy prompt→SSE | "Generate Video" from a ready creative | entry point | add gated trigger on Content/Creative + Topic |
| Progress | nothing | stages + scene thumbnails + ETA | all of it | Video Job screen (§4) |
| Status/queue | nothing for ai-first | "queued / processing / N ahead" | all of it | Activity/Queue (§5) |
| Cost | nothing | estimate + approve before spend | all of it | Cost modal (§10) |
| Preview/download | `/video/[jobId]` legacy-oriented | player + download | ai-first player | §4 |
| Failure | silent (logs only) | reason + retry | all of it | Error UX (§11) |
| First-run | blank forms | guided empty states | all of it | Empty states (§12) |

## 2. VIDEO V1 — UI (COMPONENT) AUDIT
**Reuse:** `CreativePanel` polling pattern, `Sidebar`, `DashboardLayout`, `ActivityFeed`, `RenderQueue` (repoint), `KPICard`.
**Build (8 components):** `GenerateVideoButton` (gated) · `CostApprovalModal` · `VideoJobHeader` (status badge) · `RenderStageStepper` · `SceneGrid` (4 tiles) · `VideoPreviewPlayer` · `JobErrorPanel` (reason+retry) · `QueueList` (Activity).
**Build (routes):** `/video/[jobId]` (ai-first view), `/activity`, `/library`, `/topics`, `/topics/[id]`; upgrade `/brands/[id]`.

## 3. NAVIGATION AUDIT (object-centric)
```
Dashboard · Topics · Brands · Library · Activity · Analytics · Settings
```
Collapse `/content/generate` + `/video/generate` into **Topic → Choose Output**. Demote/relabel legacy `/video/generate`. (Rationale in audit doc.)

## 4. VIDEO JOB SCREEN SPECIFICATION  ← the core
**Route:** `/video/[jobId]`. **Auth:** owner only (`render_jobs.user_id = userId`). **Poll:** ~2.5s until terminal (`completed`/`failed`), reuse `CreativePanel` mechanism.
**Data reads:**
- `render_jobs WHERE id=:jobId` → `status, progress, merge_status, merged_video_url, video_strategy, name`.
- `scene_generations WHERE render_job_id=:jobId ORDER BY sceneId` → `[{sceneId, provider, status, storage_url}]`.
**Layout (top→bottom):**
1. `VideoJobHeader` — topic name + brand + **status badge** (mapped per §6) + elapsed time.
2. `CostCard` — provider=seedance, `$/s`, billable seconds, total (from `estimate`; persist estimate on the job or recompute from `video_strategy`).
3. `RenderStageStepper` — **Strategy ✓ → Scenes (k/4) → Compose → Ready**; derive current stage from §6 mapping.
4. `SceneGrid` — 4 tiles; each tile state from `scene_generations[i].status`; when `storage_url` present, render the R2 clip as a `<video muted loop>` thumbnail.
5. `ComposeRow` — when `merge_status` in progress, show compose progress; when `merged_video_url` set → `VideoPreviewPlayer`.
6. `VideoPreviewPlayer` + `DownloadButton` (href = `merged_video_url`).
7. `JobErrorPanel` (conditional) — see §11.
**Empty/pending:** if no `scene_generations` yet and `status='queued'` → "Queued — waiting for a worker" + position (if derivable).

## 5. QUEUE MONITORING SPECIFICATION
**Route:** `/activity`. **Reads:** `render_jobs WHERE user_id=:me ORDER BY created_at DESC` + a join/count of `scene_generations` per job. **UI:** `QueueList` rows = {job name, kind badge (ai-first), status, scenes k/4, created, link to `/video/[jobId]`}; filter chips `Queued · Processing · Completed · Failed`. **Repoint** the existing dashboard `RenderQueue`/`ActivityFeed` at `render_jobs`/`scene_generations` (today they read legacy/merge). **Health strip:** "worker last seen" (optional; needs a heartbeat — P1).

## 6. RENDERING STATUS SPECIFICATION (state model → UI)
Single source of truth = `render_jobs.status` + `scene_generations[].status` + `render_jobs.merge_status` + `merged_video_url`.
| User-facing stage | Derived from |
|---|---|
| **Queued** | `render_jobs.status='queued'` AND 0 scene rows |
| **Generating scenes (k/4)** | `status='processing'`; k = count(`scene_generations.status` in done) |
| **Composing** | all scenes done AND `merge_status` in (`pending`/`processing`) AND no `merged_video_url` |
| **Ready** | `merged_video_url` present (+ `merge_status='complete'`) |
| **Failed** | `status='failed'` OR a scene `status='failed'` OR `merge_status='failed'` |
Badge colors: Queued=slate, Generating/Composing=amber(progress), Ready=green, Failed=red. **Stuck detection:** `status='queued'` for >N min with 0 scenes → surface "not picked up — check worker" (would have caught the Redis split).

## 7. ASSET LIBRARY SPECIFICATION
**Route:** `/library` (brand-scoped). **Model:** a **union read-view** over three stores (no new write tables):
- Uploads (immutable, role-tagged): `brand_assets {asset_role: logo|founder|screenshot|product, storage_path}`.
- Images: `content_creatives {storage, background_source}`.
- Videos: `render_jobs {merged_video_url}` + `scene_generations {storage_url}`.
**UI tabs:** `Uploads · Images · Videos`; each item = thumbnail + source badge (`uploaded`/`generated`) + status + "used in" (topic/content link). **Invariant surfaced:** uploads are marked "locked — never sent to AI." **V1 minimum:** read-only listing; reuse/drag-in = P1.

## 8. TOPIC-TO-VIDEO WORKFLOW SPECIFICATION
**Route:** `/topics/[id]` (Topic hub). **Reads:** `brand_topics` + its `content_items` + `content_creatives` + `render_jobs`. **Flow:** Topic → its Content/Creative → **`GenerateVideoButton`** (enabled iff latest brief has tension+metaphor) → §10 cost modal → §4 job screen. **Entry point = Topic detail (primary) + the ready Creative (trigger).** NOT `/content/generate`.

## 9. BRAND-TO-VIDEO WORKFLOW SPECIFICATION
**Route:** `/brands/[id]` upgraded to a **hub**. **Reads:** brand + its topics/content/creatives/render_jobs. **Tabs:** Overview (palette preview) · Topics · Content · Images · **Videos** (render_jobs list → `/video/[jobId]`) · Analytics. Makes `Brand → … → Video` legible from one place.

## 10. COST APPROVAL WORKFLOW
1. User clicks `GenerateVideoButton` → call `POST /api/video/generate {brandId, contentItemId, dryRun:true}`.
2. `CostApprovalModal` shows `estimate`: provider=seedance, `sceneCount`, `$/s`, `totalBillableSeconds`, **estimatedCostUsd** (+ per-scene), and the 4-beat `strategy` preview (problem→tension→solution→outcome).
3. **Approve** → `POST … {approve:true}` → 202 `{renderJobId}` → route to `/video/[jobId]`.
4. Cancel → no spend. (Backend already enforces `approve:true`; the modal is the human gate — never auto-approve.)

## 11. ERROR HANDLING UX
| Failure | Detect | UX |
|---|---|---|
| Job not picked up | `queued` >N min, 0 scenes | "Not picked up — worker/queue issue" + support link |
| Scene failed | `scene_generations.status='failed'` | per-tile error + **Retry job** (re-enqueue; worker skips already-stored scenes) |
| Compose failed (OOM) | `merge_status='failed'` | "Render failed (compose)" + Retry |
| Provider/Cloudflare | worker error surfaced on job | generic "generation error" + Retry; details in an expandable |
| Rate limit (429) | route 429 | "Too many renders this hour — try later" |
**Retry semantics:** scene-gen is `attempts:1` (no auto-retry by design — spend safety); Retry is an explicit user action.

## 12. EMPTY STATE UX
| Context | Empty state |
|---|---|
| No topics | "Start with a Topic" → create/import |
| Topic, no content | "Generate content first" CTA |
| Content, no creative brief | "Create the creative first" (video needs an approved brief) |
| Brief missing tension/metaphor | disabled Generate Video + tooltip "needs visual tension + metaphor" |
| No videos yet (Activity/Library) | "No renders yet — generate your first video" |
| Job queued | "Queued — waiting for a worker" (not a blank screen) |

## 13. LAUNCH READINESS SCORE (UX layer)
| Layer | Today | Post-spec build |
|---|---|---|
| Entry point | 5% | 100% (gated trigger) |
| Cost/approve | 0% | 100% (modal on existing estimate) |
| Job/render visibility | 0% | 100% (§4–6) |
| Queue/activity | 10% (legacy only) | 100% (repoint) |
| Preview/download | 10% | 100% |
| Asset library | 0% | 80% (read-only V1) |
| Error/empty states | 0% | 90% |
| **UX layer overall** | **~10%** | **~95%** |
**Build estimate (functional, not polished):** Video Job screen + cost modal + entry trigger + status model = **~5–7 dev-days** (P0); Activity + Library + Topic/Brand hubs = **~5–7 more** (P1). All on the existing `CreativePanel` polling pattern and real tables — **no backend changes.**

---
**Launch-ready definition:** the moment Redis is fixed, a user can: pick a Topic with an approved creative → Generate Video → see + approve a cost → watch a 4-stage timeline + 4 scene thumbnails fill → preview + download a 9:16 MP4 — with queue position, failures, and retries visible throughout, and sensible empty states — all inside OttoFlow.
