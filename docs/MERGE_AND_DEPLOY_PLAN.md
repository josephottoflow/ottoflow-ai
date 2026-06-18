# MERGE_AND_DEPLOY_PLAN.md

**Date:** 2026-06-18 · **Author:** read-only analysis (no code/commit/push/merge/deploy/render performed)
**Prod:** `main` `5753f5b` · **Branches:** `feat/phase3-integrations-p0` (Publishing) · `feat/ffmpeg-multi-agent-pipeline` (Video V1 + Deploy Guard V2)

Both branches share the merge-base `5753f5b` (current prod). `git merge-tree` (read-only) reports **exactly two content conflicts**; migrations are disjoint; one semantic contract drift is not visible to git.

---

## A. Branch merge strategy

**Recommended: sequence, don't co-merge blindly.**
1. **Commit the Video V1 hardening** on `feat/ffmpeg-multi-agent-pipeline` first (it is currently uncommitted and touches `worker/index.ts`, a conflict file — merging before committing would strand it).
2. Merge **`feat/phase3-integrations-p0` → `main`** first (Publishing; already audited READY-FOR-RC1, ships dark behind `PUBLISHING_ENABLED`).
3. Then merge **`feat/ffmpeg-multi-agent-pipeline` → `main`** (Video V1 + Guard, dark behind `VIDEO_RENDER_ENABLED`), resolving the 2 conflicts + 1 semantic drift below.

Rationale: Publishing has fewer cross-cutting files and a clean kill-switch; landing it first makes the second merge's `worker/index.ts`/`queue.ts` resolution a simple "add the video workers/queues alongside the publish ones."

---

## B. Worker conflict analysis (`worker/index.ts`) — MECHANICAL

Both branches append **new BullMQ workers** + extend the shutdown lists. Conflicting regions:
- **phase3** adds: `drive-sync` worker, `publish` worker (flag-gated `isPublishingEnabled()`), scheduler + reaper intervals, and their `.close()` entries.
- **ffmpeg** adds: `scene-generation` worker (flag-gated `isVideoRenderEnabled()` after the hardening commit), and its `.close()` entries. (`ffmpeg-compose`/`creative-generation` workers already exist on both via base.)

**Resolution:** take the **union** — keep both flag-gated blocks and include both nullable workers in the graceful + force-close arrays. No logic conflict; the gating idioms are identical (publishing dark-launch pattern mirrored by video). Low risk, hand-merge ~3 hunks.

---

## C. Queue conflict analysis (`src/lib/queue.ts`) — MECHANICAL + 1 SEMANTIC

**Mechanical:** both extend `QUEUE_NAMES`, `JobPayloads`, and add payload interfaces:
- phase3: `driveSync: "drive-sync"`, `publish: "publish"`, `DriveSyncJobData`, `PublishJobData`, `publishQueue()`, `driveSyncQueue()`.
- ffmpeg: `sceneGeneration: "scene-generation"`, `SceneGenerationJobData`, `sceneGenerationQueue()`, imports `VideoStrategy`.
→ Resolve by **union** (keep all names/types/accessors). `defaultJobOpts` is identical on both — no conflict.

**Semantic drift (git will NOT flag this):** `FfmpegComposeJobData` differs:
| Branch | `FfmpegComposeJobData` shape | `ffmpeg-compose.ts` reads |
|---|---|---|
| phase3 | `{ plan, connectedAccountId?: string\|null }` | `data.connectedAccountId` (decrypts Drive token in worker) |
| ffmpeg | `{ plan, gdriveAccessToken?: string\|null }` | base (`data.gdriveAccessToken`) |

`ffmpeg-compose.ts` is changed **only** on phase3, so a merge takes **phase3's version** (expects `connectedAccountId`). But `scene-generation.ts` (ffmpeg-only) enqueues `ffmpeg-compose` with `{ plan, gdriveAccessToken }`. **Post-merge mismatch:** `connectedAccountId` is `undefined` → the Drive storage fallback no-ops.

**Impact:** dormant today (R2 is the primary storage path; the Drive fallback only runs when R2 is unconfigured, which it is not in prod). Still, it must be reconciled.

**Required post-merge fix (1 line):** standardize on phase3's `connectedAccountId` and update `scene-generation.ts`'s `ffmpegComposeQueue().add("compose", …)` to pass `connectedAccountId` (or `null`) instead of `gdriveAccessToken`. Drop the `gdriveAccessToken` field from `FfmpegComposeJobData`.

---

## D. Migration ordering plan — NO CONFLICT

Disjoint numbering; global ascending order after merge:
```
…019, 020, 021  (already prod after phase-3 docs / shared)
022_video_v1            (ffmpeg)
023_brand_patterns      (ffmpeg)
024_connected_accounts  (phase3)
025_oauth_states        (phase3)
026_integration_audit_log (phase3)
027_publishing_destinations (phase3)
028_publish_jobs        (phase3)
```
All additive (`CREATE … IF NOT EXISTS`; `022` does `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on `render_jobs`/`scene_generations`). Apply **in numeric order** on prod Supabase. **Prod is currently at ≤021**, so apply 022→028 sequentially. No renumbering needed.

---

## E. Environment variable inventory (combined)

**Already in prod (boot-validated):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`, `R2_*` (worker).

**Video V1 (lazy; dark when unset):**
| Var | Where | Note |
|---|---|---|
| `VIDEO_RENDER_ENABLED` | Vercel + worker | gates routes + scene-gen worker; unset = dark |
| `SEEDANCE_API_KEY` | worker | optional; `isConfigured()` gate |
| `SEEDANCE_BASE_URL` / `SEEDANCE_MODEL` / `SEEDANCE_TASKS_PATH` / `SEEDANCE_RESOLUTION` | worker | defaults provided; **set MODEL/BASE_URL to real values before any render** |
| `VIDEO_ENABLE_RUNWAY` / `VIDEO_ENABLE_LUMA` | worker | opt-in paid fallbacks (default off → Seedance→Pexels) |

**Publishing (lazy; dark when unset):** `PUBLISHING_ENABLED`, `INTEGRATIONS_ENC_KEY` (**identical on Vercel + worker**), `ADMIN_EMAILS`, `GOOGLE_OAUTH_*`, `LINKEDIN_OAUTH_*` + `LINKEDIN_API_VERSION`, `META_OAUTH_*` (+ `META_GRAPH_VERSION`), `PUBLISH_*` tuning.

**Deploy Guard V2 (local seatbelt):** `gh` installed + authenticated (else fail-safe blocks guarded commands); optional `DEPLOY_GUARD_EXPECTED_OWNER`.

---

## F. Deployment sequence

1. **Commit** Video V1 hardening (local). Re-run `tsc --noEmit` + `npm run build:worker`.
2. **Merge phase3 → main**, deploy **dark** (`PUBLISHING_ENABLED` unset). Verify `/api/publish` 404, worker logs `publish … disabled`.
3. Apply migrations **024–028** (after 022–023 if video merged first; numeric order regardless).
4. **Merge ffmpeg → main**, resolving B + C (union for queue/worker, fix the `connectedAccountId` contract). Deploy **dark** (`VIDEO_RENDER_ENABLED` unset). Verify `/api/video/generate` 404, worker logs `scene-generation … disabled`.
5. **Publishing RC1** (separate, gated): set `INTEGRATIONS_ENC_KEY`(matched), OAuth, `LINKEDIN_API_VERSION`, `PUBLISHING_ENABLED=true`; run the publishing RC1 checklist.
6. **Video dry-run validation** (`dryRun:true`, zero spend).
7. **Seedance prereqs** (Railway 2 GB RAM, live contract probe, legal NO-GO cleared) → **first supervised single-scene render** with explicit approval.

---

## Determinations

| Question | Answer |
|---|---|
| Can Video V1 hardening be committed now? | **Yes** — isolated, type-clean, no phase3 dependency. |
| Can it be deployed dark? | **Yes, after committing** (committed HEAD is un-gated). Flag off → fully dark. |
| Can both branches be merged safely? | **Yes, with a supervised merge** resolving 2 mechanical conflicts + the 1-line `connectedAccountId` contract fix. **Not** a safe blind/auto-merge. |
| What conflicts must be resolved first? | `src/lib/queue.ts` (union), `worker/index.ts` (union), and the `FfmpegComposeJobData` `gdriveAccessToken`→`connectedAccountId` drift. |

---

## GO / NO-GO

| Gate | Decision | Basis |
|---|---|---|
| **Video hardening commit** | **GO** | isolated + type-clean |
| **Dark deployment** | **GO (after the commit)** | flag-gated; provably dark; NO-GO as committed HEAD (un-gated) |
| **Branch merge** | **GO — supervised only** | 2 mechanical + 1 semantic conflict, all known & small; NO-GO for an unattended merge |
| **Publishing RC1** | **GO** (own branch/prereqs) | independent of video; READY-FOR-RC1 per prior audit |
| **First Seedance render** | **NO-GO** | Railway 2 GB RAM, unverified live contract, BytePlus legal NO-GO; only after prereqs + explicit approval |
