# RC1_DEPLOYMENT_RUNBOOK.md

**Prepared branch:** `integration/rc1-dark` @ `345238b` (merge of `feat/phase3-integrations-p0` `e6a3976` + `feat/ffmpeg-multi-agent-pipeline` `edaa8d7`)
**Prod:** `main` (unchanged) · **Status:** merged, conflicts resolved, builds verified, **flags dark**.
**Date:** 2026-06-18 · This runbook only *prepares*; it performs no push/main-merge/deploy/migration/render.

## What landed on the integration branch
- Phase 3: OAuth framework + Google Drive/LinkedIn/Meta + Publishing (PUB-1/2/P1.3) + scheduler/reaper/health.
- Video V1: Seedance provider + 12-agent FFmpeg pipeline + hardening (flag/dry-run/approval/retry-spend/provider-safety/contract validation).
- Deploy Guard V2 (`.claude/`).
- Migrations **015→028 contiguous**.

## Merge resolution applied (for the record)
- `src/lib/queue.ts` — union of `QUEUE_NAMES` / `JobPayloads` / accessors (`drive-sync`,`publish`,`scene-generation`).
- `worker/index.ts` — union of worker registrations + shutdown arrays (publish+drive-sync+scene-gen, each flag-gated).
- **Contract unified:** `FfmpegComposeJobData` + `SceneGenerationJobData` use `connectedAccountId` (no plaintext token in Redis); `scene-generation.ts` forwards `connectedAccountId`.

## Build verification (this branch)
- `npm run build:worker` → ✅ clean.
- `npx tsc --noEmit` → ✅ clean (src/worker).
- `npm run build` → ✅ compiles + type-checks + collects page data; static export of `/_not-found` requires **real** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (placeholder is rejected by Clerk). Passes on Vercel with real env.

---

## A. Deployment order
1. **(done) Commit Video V1 hardening** → `edaa8d7`.
2. **(done) Merge both branches → `integration/rc1-dark`** (conflicts resolved) → `345238b`.
3. Push `integration/rc1-dark`; open PR → `main` (review). *(not done here — no push)*
4. Apply migrations **022→028** in order on prod Supabase. *(not done here)*
5. Set env (Section B) with **both flags unset** → deploy Vercel + Railway worker **dark**.
6. Verify dark (Section: dark-deploy checks).
7. Publishing RC1 (Section D).
8. Video dry-run (Section E).
9. Seedance prereqs + first supervised render (Section F).

## B. Environment variables
**Already in prod (boot-validated):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`, `R2_*` (worker).

**Publishing (lazy; dark when unset):**
| Var | Scope | Note |
|---|---|---|
| `PUBLISHING_ENABLED` | Vercel+worker | keep unset for dark |
| `INTEGRATIONS_ENC_KEY` | Vercel+worker | **byte-identical both sides** |
| `ADMIN_EMAILS` | Vercel | gates `/api/publish/health` (fail-closed) |
| `GOOGLE_OAUTH_*`, `LINKEDIN_OAUTH_*`+`LINKEDIN_API_VERSION`, `META_OAUTH_*`(+`META_GRAPH_VERSION`) | Vercel+worker | provider OAuth |
| `PUBLISH_*` (lock/interval/threshold) | worker | tuning (defaults fine) |

**Video V1 (lazy; dark when unset):**
| Var | Scope | Note |
|---|---|---|
| `VIDEO_RENDER_ENABLED` | Vercel+worker | keep unset for dark |
| `SEEDANCE_API_KEY` | worker | `isConfigured()` gate |
| `SEEDANCE_BASE_URL`/`SEEDANCE_MODEL`/`SEEDANCE_TASKS_PATH`/`SEEDANCE_RESOLUTION` | worker | **set MODEL/BASE_URL to real values before any render** |
| `VIDEO_ENABLE_RUNWAY`/`VIDEO_ENABLE_LUMA` | worker | opt-in paid fallbacks (default off → Seedance→Pexels) |

**Deploy Guard V2:** `gh` installed + authed (else guarded commands fail-safe to `ask`); optional `DEPLOY_GUARD_EXPECTED_OWNER`.

## C. Rollback plan
- **Kill switches (no redeploy of code):** `PUBLISHING_ENABLED=false` and/or `VIDEO_RENDER_ENABLED=false` → API routes 404, workers/scheduler/reaper unregistered. No data undo.
- **Code:** Vercel Instant Rollback / Railway History→Redeploy / `git revert <sha>` (never force-push main).
- **Migrations:** additive; never rolled back — reverting code suffices. Full teardown only: drop `028→024` then `023,022` in reverse FK order.
- ⚠️ **Never `git reset --hard`** while uncommitted work exists.

## D. Publishing RC1 checklist
- [ ] Migrations 024–028 applied; `to_regclass` non-null; RLS posture correct (secret tables no client policy; 026/028 owner-SELECT).
- [ ] `INTEGRATIONS_ENC_KEY` SHA-256 identical on Vercel + worker.
- [ ] `LINKEDIN_API_VERSION` set; OAuth apps + redirect URIs registered; pre-PUB-2 LinkedIn accounts reconnected for publish scopes.
- [ ] Flip `PUBLISHING_ENABLED=true`; redeploy worker → logs `publish … "registered"`.
- [ ] Connect Drive/LinkedIn → no token in any client/network payload.
- [ ] `POST /api/publish` (LinkedIn, 1 dest) → `queued` → `published` (external_post_id + permalink); verify live post.
- [ ] Re-POST same content+dest → returns existing job, **no second post** (in-flight dedupe).
- [ ] Stale `publishing` job → reaper → `needs_review` (never re-posts).
- [ ] `GET /api/publish/health` → 200 admin / 404 non-admin.
- [ ] Kill-switch: `PUBLISHING_ENABLED=false` → 404 + worker `disabled`.

## E. Video dry-run checklist (zero spend)
- [ ] Migrations 022–023 applied.
- [ ] `VIDEO_RENDER_ENABLED` unset → `POST /api/video/generate` & `/api/generate` return **404**; worker logs `scene-generation … "disabled"`.
- [ ] Set `VIDEO_RENDER_ENABLED=true` (worker) → logs `scene-generation … "registered"`.
- [ ] `POST /api/video/generate {dryRun:true}` → 200 with strategy + scenePlan + compositionPlan + cost estimate; **no `render_jobs` row, no enqueue, no provider call**.
- [ ] `POST` without `approve` → `{requiresApproval:true, estimate}`, **nothing enqueued**.
- [ ] `registry.listProviders()` with only `SEEDANCE_API_KEY` → `[seedance, pexels]` (no Runway/Luma).

## F. Seedance validation checklist (paid — explicit approval required)
- [ ] Prereqs: Railway **2 GB RAM**; `SEEDANCE_MODEL`/`SEEDANCE_BASE_URL` real; BytePlus **commercial/legal NO-GO resolved**.
- [ ] Offline: `validateSeedanceContract()` → base/model/resolution OK; `responseContractVerified:false` until a live probe.
- [ ] **Single supervised render** (`approve:true`): **1 scene, 720p, Seedance-only**, `attempts:1`. Verify `scene_generations.cost_usd`, R2 copy, `content.video_url`, status enum incl. `expired`.
- [ ] Retry idempotency: re-run job → resume skips stored scene → **no re-charge**.
- [ ] ⚠️ Video→LinkedIn publish is **not wired** (image-only) — block video publishing until implemented.

## G. Production launch gates
1. Integration branch merged to `main` (reviewed) + deployed dark — verified zero behavior change.
2. Publishing RC1 (D) all green.
3. Video dry-run (E) all green.
4. Seedance prereqs + first supervised render (F) green; contract verified live.
5. Video→publish wired (or explicitly disabled).
6. Only then: enable for real traffic.
