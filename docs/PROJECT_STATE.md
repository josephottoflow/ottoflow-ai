# PROJECT_STATE.md

**App:** Ottoflow AI — Next.js 15 SaaS dashboard (`ottoflow-ai/` in the tiktok-product-video-factory monorepo). "AI Content Operating System." **Date:** 2026-06-18.
**Prod:** https://ottoflow-ai.vercel.app (Vercel) · BullMQ worker on Railway (Hobby, **funded/active**) · Supabase (Postgres+Storage+Realtime) · Clerk auth · Cloudflare R2 (renders) · Google Gemini/Imagen.
Companions: [ARCHITECTURE](ARCHITECTURE.md) · [DECISIONS](DECISIONS.md) · [OPEN_TASKS](OPEN_TASKS.md) · [DEPLOYMENT](DEPLOYMENT.md).

## Live in production — `origin/main` = `5753f5b`
- **Full content + creative-image loop is LIVE & verified.** research → evidence (pgvector RRF) → opportunity mining → content gen → creative brief → approval gate → Imagen background → deterministic sharp composite (logo/headshot/CTA/headline) → review → manual publish → metrics → recommendations.
- Topic→Visual-Metaphor engine; palette-driven (no purple fallback); deterministic gradient fallback when Imagen validation fails; manual Brand Colors editor; in-workflow Content+Creative workspace (localStorage-persisted).
- **Migrations 001–021 applied to prod.** Imagen = `imagen-4.0-fast-generate-001` (3.0 retired). Gemini = `gemini-2.5-flash`.
- Vercel + Railway worker both deploy from `main`.

## Branch map (all unmerged; nothing below is in prod)
| Branch | HEAD | Contents | Migrations (NOT applied) |
|---|---|---|---|
| `feat/phase3-integrations-p0` | `cdfe4c6` | **Phase 3 Integrations + Publishing** (active work) | 024–028 |
| `feat/ffmpeg-multi-agent-pipeline` | `778bc39` | **Video V1** (Seedance→FFmpeg) | 022 |
| `staging/brand-pattern-2a` | `2aadf65` | Phase 2A Brand Pattern Library | 023 |

`origin/feat/phase3-integrations-p0` is behind local (commits past `9f1e9fc` unpushed). Nothing on these branches is deployed; verify with `git`.

## Phase 3 — Integrations + Publishing (current branch, code-complete, DARK)
Generic provider framework + a flag-dark publishing pipeline. **No migrations applied + `PUBLISHING_ENABLED` unset → zero prod impact.**
- **Framework:** provider registry + generic `[provider]` routes (connect/callback/folders/destinations/DELETE) + generic OAuth/token service (refresh/revoke/exchangeToken hooks) + AES-256-GCM token encryption + `integration_audit_log` (redacted). Tables: `connected_accounts`, `oauth_states`, `integration_audit_log` (024–026).
- **Providers:** **Google Drive** (storage; `drive.file`; folder mapping; save creative/video via `drive-sync` queue — live if enabled) · **LinkedIn** (connect + destination discovery; live `publish()` text+image, personal+company) · **Meta** (single connection → Facebook Pages + Instagram Business destinations; `exchangeToken` long-lived).
- **Publishing (PUB-1/PUB-2/P1.3):** `publishing_destinations` + `publish_jobs` (027/028; fan-out; in-flight dedupe; capped `attempts` jsonb) · `publish` queue (payload = id only, attempts:1) · DB-driven scheduler sweep (Redis-locked, single-instance) · reaper (stuck `publishing`→`needs_review`, never re-posts) · `GET /api/publish/health` (admin). LinkedIn is the only live publisher; at-most-once enforced.

## Other tracks (separate branches, gated)
- **Video V1** (`feat/ffmpeg-multi-agent-pipeline`): Seedance→FFmpeg, code-complete, **never run live**. Blocked on Seedance API access + worker 2 GB RAM (FFmpeg compose OOMs ~1 GB) + a separate commercial/legal NO-GO (BytePlus output/resale rights unverified).
- **Phase 2A Brand Pattern Library** (`staging/brand-pattern-2a`): deterministic per-brand image identity + BRS; gated (no staging env, 023 unapplied).

## Hard constraints / gotchas
- **No separate staging env** — Supabase `ddozknywcdpyfdokmfrp` is the live prod DB.
- **Clerk on DEV keys** in prod (migration to prod keys still open).
- **DDL path = Supabase dashboard SQL editor** (no CLI/management token on the machine).
- sharp native unreliable on Vercel (upload route uses magic-byte validation + lazy `import`); worker runs sharp fine.
- ⚠️ **ElevenLabs API key sits in plaintext in monorepo `.mcp.json`** → rotate.

## Resume pointer
Active work = Phase 3 on `feat/phase3-integrations-p0`. To make publishing real: apply migrations 024–028, set `INTEGRATIONS_ENC_KEY` + provider OAuth env + `PUBLISHING_ENABLED=true`, provision the OAuth apps (Google/LinkedIn/Meta) + reconnect for publish scopes, redeploy worker. See [OPEN_TASKS.md](OPEN_TASKS.md).
