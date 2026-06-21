# OTTOFLOW_VIDEO_V1_AUDIT.md

**Definitive Video V1 audit.** Scope: `Topic → Creative Strategy → AI Scene Planning → AtlasCloud/Seedance → R2 → FFmpeg → MP4 → Publishing → Analytics`, kept **inside** the OttoFlow OS (Topics remain the source of truth — NOT a standalone video editor).
**Build:** prod `564ffd3` · **Evidence:** live authenticated session (route 200s, `/video/generate` = legacy SSE, auth flow, full pipeline behavior, Redis enqueue gap, **T0 PASS / T1 BLOCKED**) + verified codebase.
**Phase-2 (excluded today):** ElevenLabs/voice, avatars, talking heads, CTA cards, multi-format, publishing automation, analytics enhancements.

> **LIVE VERIFICATION LOG (2026-06-21):**
> - **AtlasCloud = PASS (live).** Direct smoke test mirroring `seedance.ts`: `POST /api/v1/model/generateVideo` (4s, 9:16, 720p) → HTTP 200 `{data:{id}}`; poll → `processing`→`completed` ~92s; `data.outputs[0]` = a reachable MP4 (HEAD 200 `video/mp4`) on Aliyun OSS. The deployed provider contract is correct. **Provider URL is temporary (OSS)** → worker R2-copy is mandatory. Cost ~$0.40.
> - **Redis transport = FAIL** (Vercel `REDIS_URL=""` / worker Redis internal-only, not shared).
> - **R2 = configured, scene-clip write-path unproven** (T1 never ran). **FFmpeg = built, ai-first compose unproven** (needs T1→T3 + 2 GB RAM).
> - **Net:** the only gate between here and a first scene→R2 is the Redis fix. AtlasCloud is no longer a risk.

---

## 1. EXECUTIVE SUMMARY

OttoFlow's AtlasCloud video backend is **real and T0-proven**, but the **product is not deliverable**: the pipeline has **no UI entry point**, **no render/queue visibility**, and a **broken enqueue transport** (Vercel and the worker don't share a reachable Redis). A user cannot start an AI-first video, cannot see one run, and — even if started via API — the job never reaches the worker today.

**Can a user reliably achieve `Topic → Generate Video → Render MP4 → Preview` inside OttoFlow today? → NO.** Four P0 blockers (Redis transport, no entry point, no visibility, worker RAM for compose). Backend is the strong majority of the work; the 30-day path is **fix the transport, then surface and connect what's built.**

**Headline scores:** Pipeline (backend) **~62%** · Frontend **~8%** · Infrastructure **~65%** · Queue **~35%** · **Overall Video V1 ~38%**.

---

## 2. UX AUDIT

| Problem | Evidence | Sev |
|---|---|---|
| Flagship feature hidden | `/api/video/generate` has **no UI caller**; only reachable by direct fetch | 🔴 |
| Wrong "Video" door | `/video/generate` runs the **legacy** prompt→script→ElevenLabs→Pexels SSE flow, not AtlasCloud | 🔴 |
| "Nothing happens" failure | this session a real `render_job` sat `queued` forever, zero user signal | 🔴 |
| Dead end after creative | a ready brief is exactly the video input, but no "make a video" handoff exists | 🟠 |
| Decision fatigue | `/content/generate` is a blank multi-control form, no guided default, no Topic anchor | 🟠 |
| No cost transparency | API returns an estimate ($0.10/s, ~$2/4-scene); UI never shows it | 🟡 |

---

## 3. NAVIGATION AUDIT

**Today (tool-centric):** `Dashboard · Content · Video · Brands · Analytics · Settings · Billing · Help`.
**Problems:** two parallel generators (`/content/generate`, `/video/generate`) with overlapping inputs; "Video" points at the old pipeline; no Topics entry; no Activity/Queue surface; no Library.

**Recommended (object-centric):**
```
Dashboard
Topics      ← NEW spine: Topic → Content · Image · Video · Publish · Analytics (outputs attached)
Brands      ← hub, not settings
Library     ← NEW: uploaded source assets + generated images + videos
Activity    ← NEW: render/queue visibility (jobs, stages, failures, retries)
Analytics
Settings · Billing · Help
```
Collapse the two generators into **Topic → Choose Output (Content / Image / Video)**; demote/relabel the legacy `/video/generate` so it stops impersonating "Video."

---

## 4. TOPIC WORKFLOW AUDIT — where Video V1 should start

**Options:** A `/video` · B `/content/generate` · C **Topic Detail page**.
**Recommendation: C (primary) + trigger on a ready Creative.** The route *requires* a `content_item` whose `creative_brief` has `visual_tension`+`visual_metaphor`, so video is an **output of an approved brief**, not a fresh prompt. Therefore:
- **Primary entry:** Topic Detail → its Content/Creative → **"Generate Video"** (enabled once brief approved).
- **NOT** `/content/generate` (image/content only), **NOT** the legacy `/video`.

```
Topic (brand_topics; evidence-mined or manual) = source of truth
 ├ Content   (content_items)
 ├ Image     (content_creatives — Imagen + sharp)
 ├ Video     (render_jobs render_kind='ai-first' → scene_generations → MP4)
 ├ Publish   (publish_jobs — dark)
 └ Analytics (content_metrics → recommendations)
```

---

## 5. ASSET ARCHITECTURE AUDIT

**Current reality (3 disconnected homes, no unified view):**
| Asset class | Examples | Store | Table | Mutability |
|---|---|---|---|---|
| **Uploaded source** | logo, founder photo, screenshot, product image | `brand-assets` bucket | `brand_assets` | **immutable** — pixel-composited, **never sent to a model** (integrity-guarded) |
| **Generated image** | creative (Imagen bg + sharp composite) | `content-creatives` bucket | `content_creatives` | generated; `background_source` imagen\|fallback |
| **Generated video** | final MP4 + per-scene clips | **R2** (`ottoflow-videos`) | `render_jobs.merged_video_url`, `scene_generations.storage_url` | generated |

**Problems:** no Library/asset-manager UI; asset **types** (logo vs founder vs screenshot vs product) aren't first-class/role-tagged in the UI; no "where is this used"; no reuse across briefs; generated vs uploaded not visually separated; videos invisible.

**Recommended structure (don't over-build for V1):**
- **Keep the two-class invariant** (it's a safety feature): *uploaded source* assets are locked bytes used only as deterministic FFmpeg/sharp overlays (Phase 2 for video), **never to a model**; *generated* assets are pipeline outputs derived from a brief/topic.
- **DB:** keep `brand_assets` (add/confirm an `asset_role` enum: `logo|founder|screenshot|product`), `content_creatives`, `render_jobs`/`scene_generations`. **Add a read-model `assets` view** that unions them: `{kind:image|video, source:uploaded|generated, brand_id, topic_id, content_item_id, storage_url, mime, status, created_at}`. No new write tables needed for V1.
- **UI (Library, brand-scoped):** tabs `Uploads (role-tagged) · Images · Videos`; each item shows status + usage; uploads selectable into briefs/overlays.
- **V1 minimum:** read-only Library listing each brand's uploads + generated images + videos, sourced from the union view. Full reuse/drag-in = P1.

---

## 6. VIDEO WORKFLOW AUDIT — current vs ideal

**Current:** `prompt → image` on `/content/generate`; a separate legacy SSE `/video/generate`. **AtlasCloud pipeline absent from UI.**
**Ideal:** `Topic → Brand → Content+Creative (approved brief) → [Generate Video] (show cost, approve) → Render Job view (stages/scenes/cost) → Preview MP4 → (Publish/Download)` — one continuous, observable thread.

| Capability | Built? | Note |
|---|---|---|
| Strategy generation (Gemini 4-beat) | ✅ | **T0-proven** |
| AI scene planning (`scenePlan[4]`, `compositionPlan`) | ✅ | returned in T0 |
| Queue processing | 🔴 | enqueue doesn't reach worker (Redis) |
| Render tracking | ❌ | no surface reads `render_jobs`/`scene_generations` |
| Preview experience | ❌ (ai-first) | `/video/[jobId]` legacy-oriented |
| Job visibility | ❌ | invisible |

---

## 7. VIDEO JOB UX — full specification

**Route:** `/video/[jobId]` (ai-first), data from `render_jobs` + `scene_generations`, polled ~2.5s (reuse `CreativePanel` pattern).
**States to render explicitly:** `estimate-pending → awaiting-approval → queued → scene k/4 generating → composing → ready | failed(reason, retry)`.
**Layout:**
- **Header:** topic + brand + **status badge** (`queued/processing/rendering/composing/completed/failed`).
- **Cost card:** provider=seedance, $/sec, billable seconds, **total** (from API `estimate`); **Approve** gate before spend (API enforces `approve:true`).
- **Stage stepper (timeline):** `Strategy ✓ → Scenes (1–4) → Compose → Ready`, each with state + **elapsed/ETA**.
- **Scene grid (4 tiles):** fills with **R2 clip thumbnail** as each lands (`scene_generations.storage_url`); per-scene `queued/generating/uploaded/failed`.
- **Compose row:** FFmpeg progress → final **MP4 player** on `merged_video_url`.
- **Failure diagnostics:** explicit reason + **Retry** (surface BullMQ attempts) + **"job not picked up"** detection (would have caught this session's Redis gap instantly).

---

## 8. INFRASTRUCTURE AUDIT

| Component | State | Risk / bottleneck | Sev |
|---|---|---|---|
| **Vercel** | ✅ healthy (`564ffd3`) | sync-only; must never import sharp/ffmpeg at module top (fixed in `branding.ts`) | 🟢 |
| **Railway worker** | ✅ RUNNING, registered | **single replica (do not scale >1)**; **needs 2 GB RAM** for FFmpeg compose (OOM at 1 GB) | 🟠 |
| **Redis** | 🔴 misconfigured | internal-only, **no auth, no public proxy**; Vercel `REDIS_URL=""` → enqueues lost | 🔴 |
| **AtlasCloud** | ✅ key set, reachable | Cloudflare-fronted (browser UA required, handled); cost ~$0.10/s | 🟢 |
| **R2** | ✅ configured (`ottoflow-videos`) | verify `R2_PUBLIC_BASE_URL` maps to that bucket before trusting a storage_url | 🟡 |
| **FFmpeg** | ✅ built (ADR-002 12-agent) | RAM-gated; `06-diversity` no intra-video uniqueness | 🟠 |

**Infrastructure readiness: ~65%** (Redis transport + worker RAM are the holes).

---

## 9. QUEUE ARCHITECTURE AUDIT

Flow: `Vercel → Redis → Railway`. Wiring (BullMQ) is correct; **transport + observability are broken.**
| Question | Verified answer | Sev |
|---|---|---|
| Reliable? | 🔴 No — Vercel `REDIS_URL=""`, worker Redis internal-only → not shared; `.add()` buffers offline | 🔴 |
| Jobs lost? | 🔴 Yes, silently (proven: `e6ffb1b5` created, never enqueued, 0 scenes) | 🔴 |
| Retry handling? | 🟠 scene-gen uses `attempts:1` (no auto-retry); BullMQ attempts invisible | 🟠 |
| Visibility/observability? | 🔴 None — no DLQ surface, no monitoring, no heartbeat | 🔴 |
| Recovery? | 🟠 worker stuck-sweep covers brand/content/merge, **not scene-generation** | 🟠 |

**Recommendations:** (1) shared Redis (**Upstash `rediss://`** recommended) on both surfaces; (2) `env.ts` boot-guard on empty `REDIS_URL`; (3) repoint `RenderQueue`/`ActivityFeed` at `render_jobs`/`scene_generations`; (4) worker heartbeat; (5) consider `attempts:2` + scene-gen DB recovery.
**Queue readiness: ~35%.**

---

## 10. VIDEO PIPELINE AUDIT

`Topic → Gemini → Strategy → AtlasCloud → Scene Clips → R2 → FFmpeg → MP4`.
| Link | State | Weakness / missing |
|---|---|---|
| Topic→Gemini→Strategy | ✅ T0 | none material |
| Strategy→scene plan | ✅ T0 | `scenePlan[4]`, `compositionPlan` produced |
| AtlasCloud→clip | ⚠️ unproven | **T1 never ran** (Redis); polling/timeout/Cloudflare paths untested live |
| clip→R2 | ✅ gate | fail-fast if R2 unconfigured (good) |
| R2→FFmpeg→MP4 | ⚠️ RAM | unproven for ai-first; needs 2 GB; `06-diversity` defect |
| **Missing states/recovery** | 🔴 | no per-scene retry, no partial-failure handling, no scene-gen recovery, no user-facing states |

**Pipeline readiness: ~62%** (T0 solid; T1→T3 unproven + recovery gaps).

---

## 11. PUBLISHING COMPATIBILITY REVIEW (validate V1, do not design V2)

Future: `Final MP4 → Publishing Worker → LinkedIn / Facebook / Instagram / TikTok`.
- **Architecture compat:** ✅ The `publish_jobs` model (per-destination, at-most-once: CAS claim + `attempts:1` + `external_post_id` guard) is artifact-agnostic — a video URL fits as well as an image. The MP4 lands at `render_jobs.merged_video_url` (R2 public) = a clean handoff reference.
- **Required changes for video:** (1) **Provider `publish()` must implement VIDEO upload** — LinkedIn/Meta video is a multi-step register→chunked-upload→post flow, very different from image/text; current providers (google-drive/linkedin/meta) are not video-ready. (2) **TikTok provider does not exist** (registry = google-drive/linkedin/meta) → new provider needed for the product's TikTok north star. (3) **Pre-publish validation** of the MP4 against platform specs (9:16, h264+aac per AtlasCloud samples — compatible with TikTok/Reels/Shorts; check size/duration caps). (4) Publishing is **flag-dark** and PUB-1 posts nothing live.
- **V1 recommendation:** ship video **without auto-publish** — expose **Download** + manual "mark published," validate the MP4 meets specs. Auto-publish (incl. TikTok provider + per-platform video upload) = explicitly Phase 2. **No V1 blocker introduced.**

---

## 12. MISSING FEATURES — ranked for public launch

**P0 (blocks first reliable MP4 + basic usability):**
1. 🔴 Shared Redis transport + empty-`REDIS_URL` boot guard (so jobs actually run).
2. 🔴 Video entry point: "Generate Video" from a ready Creative → `/api/video/generate` with in-UI cost/approve.
3. 🔴 Video Job view (§7): stages/scenes/cost/queue/failure visibility.
4. 🔴 Worker **2 GB RAM** (FFmpeg compose / T3).

**P1 (credible SaaS):**
5. Topic hub as the spine + Topic-anchored entry.
6. Activity/Queue surface (repoint existing components).
7. Failure/retry surfacing + scene-gen recovery.
8. Brand Hub outputs rollup; Library (uploads/images/videos).
9. Cost transparency + history of past renders.

**P2 (post-launch / Phase 2):**
10. Video auto-publish (per-provider video upload + TikTok provider).
11. Asset reuse/drag-in; onboarding/guided first-run; analytics-per-Topic narrative.

---

## 13. VIDEO V1 READINESS SCORE

| Dimension | Score | Basis |
|---|---|---|
| Strategy engine | 95% | T0-proven |
| AtlasCloud provider | **92%** | **live smoke-test PASS (2026-06-21)**; only in-worker R2-copy integration unproven |
| R2 | 85% | configured; scene-clip write-path unproven |
| FFmpeg | 70% | built; RAM-gated; unproven ai-first |
| **Queue/transport** | 35% | broken today (Redis) |
| **Backend / Pipeline overall** | **~68%** | AtlasCloud de-risked |
| Frontend (entry/progress/status/preview/history) | **~8%** | essentially absent |
| Infrastructure | **~65%** | Redis + RAM holes |
| **OVERALL VIDEO V1** | **~42%** | backend de-risked; gated on Redis + frontend |

**Success-criteria verdict:** ❌ a user **cannot** reliably do `Topic → Generate Video → Render MP4 → Preview` today. Blockers ranked: **P0** = Redis transport, no entry point, no visibility, worker RAM; **P1** = Topic anchor, cost/approve UI, failure/retry surfacing, ai-first preview player; **P2** = asset library, video publishing, onboarding.

---

## RECOMMENDED EXECUTION ORDER & EXACT NEXT ACTIONS

**Order:** make it run → make it visible → make it reachable → make Topic the spine → close the loop.

**Exact next actions (concrete, sequenced):**
1. **Provision a shared Upstash Redis.** Set the **same** `rediss://…` `REDIS_URL` on Vercel **Production** + the Railway worker; **fresh git deploy** Vercel (redeploy reuses old env). [operator — secret]
2. **Add an `src/lib/env.ts` guard** that throws on empty `REDIS_URL` (boot-fail loudly).
3. **Re-run T1** from a logged-in browser (Basecamp `b1384434-3666-45cc-96d9-ca764e90cdc3` / content `4742f075-f48a-43a1-a547-00816ef816eb`); confirm `scene_generations.storage_url` is a reachable R2 URL → **first AtlasCloud→R2 proof.**
4. **Bump worker to 2 GB RAM**, run T2 (4 scenes) → T3 (`ffmpeg-compose` MP4, no OOM).
5. **Build the Video Job view** (§7) on the polling pattern; **repoint `RenderQueue`/`ActivityFeed`** at `render_jobs`/`scene_generations`.
6. **Add the "Generate Video" entry** on a ready Creative (cost/approve in UI); demote legacy `/video/generate`.
7. **Topic hub** + Topic-anchored entry; **Brand Hub** outputs rollup + read-only **Library**.
8. **Parked:** rotate Railway token + AtlasCloud key (in transcript); video publishing (Phase 2).

**Definition of done for "Video V1 production-ready":** a user picks a Topic with an approved creative, clicks Generate Video, sees and approves a cost, watches a 4-stage timeline + 4 scene thumbnails fill to a playable 9:16 MP4 — with queue position, failures, and retries visible throughout — all inside OttoFlow.
