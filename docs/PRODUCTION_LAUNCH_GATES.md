# PRODUCTION_LAUNCH_GATES.md

**Branch:** `integration/rc1-dark` @ `d146035` · **Prod:** `main` (unchanged) · **Date:** 2026-06-18
**Scope:** final read-only pre-deployment audit + launch gates. No push/main-merge/deploy/migration/flag-enable/render performed.

## Pre-deployment audit results (10/10 verified)

| # | Check | Result |
|---|---|---|
| 1 | No merge artifacts | ✅ no `.orig`, no `MERGE_HEAD`, working tree clean |
| 2 | No conflict markers | ✅ none in `src/`, `worker/`, `supabase/` |
| 3 | Flags default OFF | ✅ `VIDEO_RENDER_ENABLED`, `VIDEO_ENABLE_RUNWAY`, `VIDEO_ENABLE_LUMA`, `PUBLISHING_ENABLED` all `=== "true"` (unset ⇒ false) |
| 4 | Publishing dark when unset | ✅ `/api/publish`, `/api/publish/[id]`, `/api/publish/health` → 404; publish worker + scheduler + reaper unregistered |
| 5 | Video dark when unset | ✅ `/api/video/generate` + `/api/generate` → 404; scene-generation worker unregistered |
| 6 | Migrations 022–028 additive | ✅ only `CREATE … [IF NOT EXISTS]`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `DROP TRIGGER/POLICY IF EXISTS` guards. The `023` "DROP" lines are **commented rollback notes**, not executed SQL |
| 7 | Worker registrations flag-gated | ✅ `if (isPublishingEnabled())` (publish) / `if (isVideoRenderEnabled())` (scene-gen); both log `disabled` in the `else` |
| 8 | Queue usage flag-gated | ✅ every enqueue is behind a flag (routes L64/L309; worker publish enqueue inside the publishing block; scene-gen→ffmpeg-compose inside the gated worker). Lazy `getQueue()` objects stay idle with no producer/consumer when flags off |
| 9 | Seedance unreachable when rendering off | ✅ all `generateScene` paths gated (scene-gen worker is flag-gated; the video-merge `sceneSpecs` path is enqueued only by the flag-gated `/api/generate`). Second guard: `SeedanceProvider.isConfigured()` requires `SEEDANCE_API_KEY` |
| 10 | Production checklist | ✅ below |

**Build status (carried from merge):** `build:worker` ✅, `tsc --noEmit` ✅, `npm run build` compiles + type-checks ✅ (static export needs real platform env/Clerk key).

---

## A. Deployment sequence
1. Push `integration/rc1-dark`; open PR → `main`; review.
2. Apply migrations **022 → 023 → 024 → 025 → 026 → 027 → 028** (Supabase SQL editor, numeric order). Verify `to_regclass` non-null.
3. Set env (Section C) with **`PUBLISHING_ENABLED` and `VIDEO_RENDER_ENABLED` unset**.
4. Merge PR → `main`; let Vercel + Railway worker deploy **dark**.
5. Dark verification: `/api/publish` & `/api/video/generate` → 404; worker logs `publish … disabled` + `scene-generation … disabled`; core app unchanged.

## B. Rollback sequence
- **Kill switches (no redeploy):** `PUBLISHING_ENABLED=false` / `VIDEO_RENDER_ENABLED=false` → routes 404, workers/scheduler/reaper unregistered, queues idle. No data undo.
- **Code:** Vercel Instant Rollback · Railway History→Redeploy · `git revert <sha>` (never force-push `main`).
- **Migrations:** additive — never rolled back; reverting code suffices. Full teardown only: drop `028→024`, then `023,022` in reverse FK order.
- ⚠️ Never `git reset --hard` with uncommitted work present.

## C. Required environment variables
**Prod-existing (boot-validated):** `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`, `R2_*` (worker).

**Publishing (lazy):** `PUBLISHING_ENABLED` (keep unset), `INTEGRATIONS_ENC_KEY` (**identical Vercel+worker**), `ADMIN_EMAILS`, `GOOGLE_OAUTH_*`, `LINKEDIN_OAUTH_*` + `LINKEDIN_API_VERSION`, `META_OAUTH_*` (+`META_GRAPH_VERSION`), `PUBLISH_*` tuning.

**Video (lazy):** `VIDEO_RENDER_ENABLED` (keep unset), `SEEDANCE_API_KEY`, `SEEDANCE_BASE_URL/MODEL/TASKS_PATH/RESOLUTION` (set MODEL/BASE_URL real before any render), `VIDEO_ENABLE_RUNWAY/LUMA` (default off).

**Deploy Guard V2:** `gh` installed + authed; optional `DEPLOY_GUARD_EXPECTED_OWNER`.

## D. Publishing RC1 validation
- [ ] 024–028 applied; RLS posture correct (secret tables no client policy).
- [ ] `INTEGRATIONS_ENC_KEY` SHA-256 identical both surfaces; `LINKEDIN_API_VERSION` set; OAuth apps + redirects registered; pre-PUB-2 LinkedIn reconnected.
- [ ] `PUBLISHING_ENABLED=true` → worker logs `publish … registered`.
- [ ] `POST /api/publish` (LinkedIn, 1 dest) → `published` (external_post_id + permalink); verify live post.
- [ ] Re-POST same content+dest → existing job, **no second post**.
- [ ] Stale `publishing` job → reaper → `needs_review` (no re-post).
- [ ] `/api/publish/health` 200 admin / 404 non-admin.
- [ ] Kill-switch returns dark.

## E. Video dry-run validation (zero spend)
- [ ] 022–023 applied.
- [ ] `VIDEO_RENDER_ENABLED=true` (worker) → `scene-generation … registered`.
- [ ] `POST /api/video/generate {dryRun:true}` → strategy + plan + estimate; **no provider call, no render_jobs row, no enqueue**.
- [ ] `POST` without `approve` → `{requiresApproval:true, estimate}`, nothing enqueued.
- [ ] With only `SEEDANCE_API_KEY`, provider chain = `[seedance, pexels]`.

## F. Seedance validation (paid — explicit approval required)
- [ ] Prereqs: Railway **2 GB RAM**; real `SEEDANCE_MODEL`/`BASE_URL`; BytePlus **legal NO-GO resolved**.
- [ ] Offline `validateSeedanceContract()` → OK; `responseContractVerified:false` until probe.
- [ ] **Single supervised render** (`approve:true`, 1 scene, 720p, Seedance-only, `attempts:1`): verify cost row, R2 copy, `content.video_url`, status enum incl. `expired`.
- [ ] Retry → resume skips stored scene → **no re-charge**.
- [ ] ⚠️ Video→LinkedIn publish not wired (image-only) — block video publishing until implemented.

## G. GO / NO-GO criteria
- **Dark deploy:** GO when audit 1–9 pass (they do) + migrations applied + flags unset.
- **Publishing RC1:** GO when Section D prereqs set; validate live.
- **Video dry-run:** GO immediately after dark deploy (no spend).
- **First Seedance render:** NO-GO until Railway 2 GB + live contract probe + legal cleared + explicit approval.
- **Full production launch:** GO only after D + E + F all green and video→publish wired (or disabled).
