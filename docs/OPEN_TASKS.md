# OPEN_TASKS.md

Current open work, by track. Prod (`origin/main` 5753f5b) = content+creative loop live; everything below is unmerged/branch work.

## Phase 3 Integrations + Publishing — `feat/phase3-integrations-p0` (code-complete, DARK)
Make it real (operator + deploy):
1. **Apply migrations 024–028** to prod Supabase (dashboard SQL editor; additive): `024 connected_accounts`, `025 oauth_states`, `026 integration_audit_log`, `027 publishing_destinations`, `028 publish_jobs`. Verify via `to_regclass` + RLS enabled + partial-unique indexes on `publish_jobs`.
2. **Secrets:** `INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`, **identical** on Vercel + worker) · `PUBLISHING_ENABLED=true` (Vercel + worker) · provider OAuth env (below).
3. **Google Drive (P1):** Google Cloud OAuth client (`drive.file`), redirect `…/api/integrations/google_drive/callback`; set `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` (Vercel + worker).
4. **LinkedIn (publish):** LinkedIn app + Sign-In-with-OpenID + Community/Marketing product; set `LINKEDIN_OAUTH_*` + `LINKEDIN_API_VERSION` (Vercel + worker). DEFAULT_SCOPES now include `w_member_social`+`w_organization_social` → **existing LinkedIn connections must reconnect** or publish 403→failed.
5. **Meta (FB/IG discovery):** Meta Business app + Facebook Login + Business Verification; `META_OAUTH_*` (+ optional `META_GRAPH_VERSION`) (Vercel + worker). App Review for `pages_show_list`/`instagram_basic` before prod.
6. **Redeploy worker** to register `drive-sync` + `publish` queues + scheduler/reaper.
7. **E2E validate** per the PUB-2/P1.3 checklists (connect → discover destinations → `POST /api/publish` → `published` w/ external_post_id+permalink; reaper recovers a stuck job; `GET /api/publish/health` admin-only).

### Remaining hardening before scale (hostile-audit carryover)
- **Scheduler/reaper claim has no `LIMIT`** → batch the claim before high volume.
- `createAdminClient` builds a new client per call (no pooling) — fine now, address at scale.
- Encryption key has no versioned-rotation (rotating invalidates all tokens).

### Deferred Phase 3 (designed, not built)
- Per-destination tokens (FB Page) → publishing phase; storage-config generalization for OneDrive/Dropbox/Box; email `send` + CRM `sync` are **separate subsystems**, not Publish Center.
- Next providers (low framework risk): YouTube, X (standard OAuth); then Meta `publish()`, IG/YouTube async + `status()` polling; Publish Center UI; analytics sync (`content_metrics` per-destination dim).

## Video V1 — `feat/ffmpeg-multi-agent-pipeline` (code-complete, never run live)
- Blocked: Seedance API access (then verify the Ark `createTask`→`pollTask` contract: `content.video_url`); worker **2 GB RAM** (FFmpeg compose OOMs ~1 GB); commercial/legal NO-GO (BytePlus output/resale rights).
- Known fix-on-arrival: Seedance `expired` task status not handled in `pollTask` (one-line).
- Apply migration 022 before deploying that branch.

## Phase 2A Brand Pattern Library — `staging/brand-pattern-2a` (gated)
Needs a staging env + migration 023 + pilot brand patterns; run `scripts/phase2a-acceptance.local.ts` (logo-free brand recognition).

## Prod debt (non-blocking)
- **Clerk DEV→prod keys** (operator-gated).
- ⚠️ **Rotate the ElevenLabs key** (plaintext in monorepo `.mcp.json`); move all secrets out of `.mcp.json`.
- Public GitHub repo — audit history for leaked secrets.
- No central infra inventory/billing record (see `OTTOFLOW_INFRA_INVENTORY.xlsx`); legacy `ottoflow-video-hub` Railway service is crashed → decommission.
- Video intra-video dedup (`06-diversity.ts`); crossfades; git-ignored `scripts/phase2a-acceptance.local.ts` is the only `tsc`/`next build` type-check failure (not on prod branch — ignore).
