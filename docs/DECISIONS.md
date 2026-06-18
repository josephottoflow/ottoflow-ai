# DECISIONS.md

Current decisions only. Superseded approaches noted in one line, not expanded.

## Integrations framework (Phase 3)
- **Generic provider framework, not per-provider trees.** One `ProviderDefinition` (registry) drives generic `[provider]` routes + token service. Adding a provider = a module + a registry line. Validated across three OAuth shapes: standard-refresh (Google), client-cred revoke (LinkedIn), long-lived exchange (Meta).
- **Single dynamic route segment `[provider]`.** Next.js allows only one slug name per level → OAuth sub-routes key by provider, account sub-routes (DELETE/destinations) by id, same segment. Keeps all existing URLs (incl. the Google redirect URI) byte-identical.
- **Ownership = `user_id`** (Clerk id). Ottoflow has **no workspace/tenant table**; the user is the isolation boundary. Optional `brand_id` for per-brand scoping; reserved nullable `workspace_id` (unused).
- **Optional hooks, generic fallback.** `refresh`/`revoke` override the RFC-6749 defaults; `exchangeToken` (Meta short→long-lived) runs in the generic callback before account creation (short-lived tokens never stored); `enumerateDestinations` returns the generic `Destination[]`.
- **Meta = ONE connection** surfacing both `facebook_page` + `ig_business` (IG Business is reached via Facebook Login + a linked Page; there is no separate IG-Business OAuth). Meta refresh = re-exchange (stores the long-lived token as the refresh anchor, rolled on refresh).
- **Tokens AES-256-GCM at rest** (`INTEGRATIONS_ENC_KEY`, AAD `provider:userId`); never in queue payloads or client; secret-bearing tables are service-role-only (RLS, no client policies). Audit writes are token/JWT-redacted.

## Publishing (Phase 3, flag-dark)
- **`publish_jobs` is the per-destination source of truth** (fan-out: 1 content item → N jobs); the 015 `content_items` publishing columns are a denormalized "primary publish" cache. `publishing_destinations` is a write-through cache (P3.1c discovery still authoritative).
- **At-most-once over at-least-once.** `attempts:1`, compare-and-set claim (`queued`→`publishing`), `external_post_id` guard; ambiguous/post_send failures → `needs_review` (manual reconcile, **never auto re-post**). LinkedIn has no idempotency key → enforced upstream.
- **DB is the scheduler**, not BullMQ delayed jobs (Redis-eviction-safe): atomic `scheduled`→`queued` claim sweep under a **Redis distributed lock** (single-instance); a reaper recovers stuck `publishing` jobs.
- **Idempotency = unique-partial index** on `(content_item_id, publishing_destination_id)` over non-terminal statuses (dedupe in-flight, allow re-publish after terminal) + optional `client_request_id`.
- **No `publish_attempts` table** — capped `attempts` jsonb on the job (YAGNI until volume).
- **Dark-launch:** `PUBLISHING_ENABLED` gates API + worker + scheduler; off in prod by default.

## Creative Orchestrator
- **Two-layer, safety-first.** AI does strategy + background ONLY; uploaded brand assets are locked/immutable and **never touch a model**; composited deterministically with `sharp` (resize/crop/mask/position whitelist).
- **Approval gate before Imagen** (`generating` reachable only from `approved`).
- **Deterministic hierarchy priority** `founder_led > data_led > quote_led > brand_led` (not score-ranked); scores only drive the confidence display; `<0.55` forces brand_led.
- **Creative Brief jsonb = source of truth**; `creative_hierarchy`+`creative_confidence` denormalized for attribution. Topic→visual_tension→visual_metaphor precedes the background prompt. Platform-native px (1200×627/1200×630/1600×900/1080×1350).

## Video composition
- **ADR-001 Hybrid Remotion — REVERSED** (Remotion+Chrome OOM'd ~800 MB on the 1 GB worker).
- **ADR-002 (current): FFmpeg 12-agent pipeline.** Validation showed 4 scenes → 2 unique clips (no intra-video dedup in `06-diversity.ts`). Decision: **keep FFmpeg**, add the cheap intra-video dedup; do not re-adopt Remotion.
- **Video V1 = Seedance→FFmpeg** (text-to-video provider via the registry). Customer-facing use NOT authorized until BytePlus confirms (in writing) output ownership, resale rights, competing-offering clause, and pricing — engineering fit is fine; the block is commercial/legal.

## Platform / infra
- **Migrations-first deploy order.** Apply the migration BEFORE pushing whenever code WRITES a new column. DDL via Supabase dashboard SQL editor (no CLI/token on the machine). Additive-only, idempotent (`IF NOT EXISTS`/`OR REPLACE`).
- **Migration numbering:** prod = 001–021. 022 (Video V1) on `feat/ffmpeg`; 023 (brand_patterns) on `staging`; 024–028 (integrations+publishing) on `feat/phase3-integrations-p0` — none applied yet.
- **BullMQ custom jobIds: no `:`** (use hyphens). **Imagen: no `seed` config** (text generateContent accepts it; image generateImages rejects it). **Embeddings:** `gemini-embedding-001` @768-dim L2-normalized.
- **sharp on Vercel: don't depend on it loading** — upload route validates by magic bytes + lazy `await import("sharp")`; keep `serverExternalPackages:["sharp"]` + the linux lockfile entry. Worker runs sharp fine.
- **Verify from real state (git/API/DB), never assertions.** "It's deployed/upgraded/pushed" reports have repeatedly been false — trust the dashboard/`git status`/DB catalog.
- **Lazy env for new optional integrations** — provider OAuth + `INTEGRATIONS_ENC_KEY` + `PUBLISHING_ENABLED` are read on use, NOT in `env.ts`, so prod boots without them (dark).

## Standing constraints
Commits authored `josephottoflow` + `Co-Authored-By: Claude`. **Never `git add -u`/`git add .`** — stage explicit paths (avoids sweeping DO-NOT-COMMIT stragglers + the git-ignored `*.local.ts`). Local gates before deploy: `npx tsc --noEmit` (ignore the one git-ignored `phase2a-acceptance.local.ts` error) + `npm run build:worker`. Local `next build` fails type-check only on that same git-ignored script.
