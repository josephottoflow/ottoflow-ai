# DECISIONS.md

Current decisions only. Superseded approaches noted in one line.

## Video V1 — AtlasCloud via seedance.ts rewrite (2026-06-20)
- **Provider = AtlasCloud Seedance 2.0, not BytePlus.** Funded $25 credit is on **AtlasCloud** (`api.atlascloud.ai`). SUPERSEDED: original BytePlus/Volcengine ModelArk target (incompatible with AtlasCloud's flat JSON + Cloudflare browser-UA requirement).
- **Option B — rewrite `seedance.ts` internals in place** (keep `name="seedance"` + export surface). One file changed; registry/scene-gen/cost/types/route unchanged. `atlascloud.ts` extraction deferred to Phase 2 (naming only).
- **Contract:** `POST /api/v1/model/generateVideo` (Bearer + browser UA) `{model:"bytedance/seedance-2.0/text-to-video",prompt,duration,resolution,ratio,generate_audio:false,watermark:false}` → `{data:{id}}`; poll `GET /api/v1/model/prediction/{id}` → `data.status` (completed|succeeded) → `data.outputs[0]`. ~$0.10/s.
- **A+ "abstract-safe" direction.** AtlasCloud generates environments/motion ONLY — no AI founder/avatar/talking-head, no AI logos. Brand logo/founder/CTA = deterministic FFmpeg overlays (Phase 2), assets never sent to a model.
- **Cost-approval gate kept.** `/api/video/generate` requires `approve:true` (returns estimate otherwise); `dryRun:true` builds strategy+plan, zero spend. Deliberate manual step — do not auto-remove.

## sharp must be lazy on Vercel (2026-06-20)
- **`branding.ts` imports `sharp` lazily inside `renderCtaCard`**, not at module top. A top-level `import sharp from "sharp"` crashed `/api/video/generate` at module-init (`Could not load the sharp module`) because the route transitively imports it (route → orchestrator → agent11 → branding) — a hard 500 before the handler ran. sharp executes worker-only. Generalizes the standing "sharp unreliable on Vercel" rule: **never let sharp (or ffmpeg native deps) load at import time in a Vercel route's graph.**

## Redis transport — must be one shared, reachable instance (2026-06-20, OPEN)
- Worker consumes `redis://redis.railway.internal:6379` (Railway-internal, no auth, no public proxy). Vercel `REDIS_URL=""`. **Not shared** → Vercel enqueues never reach the worker (BullMQ `.add()` buffers offline, route still 202s). This blocks T1.
- **Decision pending (operator):** Option A shared **Upstash** (recommended — TLS+auth, reachable by both) vs Option B Railway TCP proxy + password. Set the SAME `REDIS_URL` on both surfaces either way. Add an `env.ts` guard so empty `REDIS_URL` fails boot loudly.

## Video composition
- **ADR-002 FFmpeg 12-agent pipeline** is the permanent render backend. SUPERSEDED: ADR-001 Hybrid Remotion (OOM'd at 1 GB). Provider-agnostic — works on clip URLs. Customer-facing video NOT authorized until output ownership/resale rights confirmed in writing.

## Platform / infra
- **Migrations-first deploy.** Apply DDL BEFORE pushing code that writes a new column. Supabase dashboard SQL editor (no CLI/token). Additive-only, idempotent. Applied: **001–028**.
- **Deploy from `main`.** Vercel + Railway both track `main`. `git push origin HEAD:main`. Gates before push: `npx tsc --noEmit` (ignore git-ignored `phase2a-acceptance.local.ts`) + `npm run build:worker`.
- **`vercel redeploy` reuses the old env snapshot** — to apply a new/changed Vercel env var, trigger a **fresh git deploy** (e.g. push to main). `vercel promote`/`alias set` alone won't help.
- **Verify from real state (git/API/DB/`railway logs`/`vercel` CLI), never assertions** — "deployed/set" reports have repeatedly been false. Unauthenticated `curl` of app routes is NOT a valid flag probe (Clerk middleware 404s all anon).
- **Worker requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `REDIS_URL` + `GOOGLE_API_KEY`** (boot Step-2 hard-fails without them). No Clerk vars (service-role bypasses RLS).
- **BullMQ jobIds: no `:`**. **Imagen: no `seed`**. **Embeddings:** `gemini-embedding-001` @768 L2-normalized.
- **Cloudflare-fronted AtlasCloud blocks non-browser clients** (403/1010) → browser User-Agent header.

## Auth (Clerk → Supabase Third-Party Auth)
- **Native TPA, no JWT template, no webhooks.** Clerk default session JWT → Supabase verifies via Clerk JWKS; RLS keys on `sub`. Migrating DEV→PROD changes the issuer → update Supabase TPA provider AND re-key data. Domain allowlist + admin gate are email-based (`ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`) → survive migration.
- **`src/middleware.ts` `auth.protect()` 404s all unauthenticated requests.** T0/T1 (and any prod-DB query under RLS) require a logged-in browser session; cannot be run headless.

## Integrations / Publishing (Phase 3, flag-dark)
- Generic provider framework (registry + one `ProviderDefinition` per provider). Ownership=`user_id`. Tokens AES-256-GCM (`INTEGRATIONS_ENC_KEY`, identical app+worker). **At-most-once** publishing (`attempts:1`, CAS claim, `external_post_id` guard; ambiguous→`needs_review`). **DB is the scheduler** (Redis-lock sweep).

## Standing constraints
Commits authored `josephottoflow` + `Co-Authored-By: Claude`. **Never `git add -u`/`git add .`** — explicit paths. **Secrets entered by the operator**, never the assistant, unless the operator explicitly authorizes a specific secret-set. Flip a dark flag on **both** Vercel + worker (worker first); rollback = unset.
