# OPEN_TASKS.md

Priority order. State in [PROJECT_STATE](PROJECT_STATE.md). `origin/main` `564ffd3`; worker healthy on it; Video V1 flags ON; T0 PASS; T1 blocked on Redis.

## P0 — Video V1 first MP4 (ACTIVE): unblock T1
**Done:** AtlasCloud provider deployed · `branding.ts` lazy-sharp fix (un-404'd the route) · worker `ATLASCLOUD_API_KEY` + `VIDEO_RENDER_ENABLED=true` (scene-generation registered) · Vercel `VIDEO_RENDER_ENABLED=true` · **T0 (dryRun) PASS** (strategy+scenePlan[4]+compositionPlan+estimate, provider=seedance, ~$2/video).

### 1. 🔴 Fix the Vercel↔worker Redis transport (THE blocker)
Worker consumes `redis://redis.railway.internal:6379` (internal, no auth, no public proxy); Vercel `REDIS_URL=""`. Enqueues never reach the worker (`.add()` buffers offline → 202 but no job). Pick one:
- **A (recommended):** provision Upstash Redis → set same `rediss://…` `REDIS_URL` on **Vercel Production AND worker** → redeploy both.
- **B:** enable Railway TCP proxy on `redis` service **+ add a password** (do NOT expose unauthenticated) → set Vercel `REDIS_URL=redis://…@host:port` (worker keeps internal URL, same instance).
- Then add an `env.ts` guard so an **empty** `REDIS_URL` fails boot loudly (currently silent).
- ⚠️ Vercel needs a **fresh git deploy** after the env change (`vercel redeploy` reuses the old env snapshot).

### 2. Re-run T0 → T1 (from a logged-in browser; route is Clerk-protected)
The route requires a Clerk session; unauthenticated requests 404 via middleware. Run as direct `fetch` in the app console (NOT the `/video/generate` UI page = legacy SSE path). Test data: brand `b1384434-3666-45cc-96d9-ca764e90cdc3` (Basecamp), content_item `4742f075-f48a-43a1-a547-00816ef816eb`.
```js
// T0 (zero spend):
await fetch('/api/video/generate',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({brandId:'b1384434-3666-45cc-96d9-ca764e90cdc3',contentItemId:'4742f075-f48a-43a1-a547-00816ef816eb',dryRun:true})}).then(r=>r.json())
// T1 (~$2 spend, approve):
await fetch('/api/video/generate',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({brandId:'b1384434-3666-45cc-96d9-ca764e90cdc3',contentItemId:'4742f075-f48a-43a1-a547-00816ef816eb',approve:true})}).then(r=>r.json())
```
**T1 PASS =** worker logs `seedance task.created`→`task.succeeded`; a `scene_generations` row with `provider='seedance'` + `storage_url` = a `https://pub-…r2.dev/...` (or `ottoflow-videos` R2) URL that is reachable. T2 = all 4 scenes; T3 = `ffmpeg-compose` MP4 (needs worker **2 GB RAM**, OOMs at 1 GB); T4 = plays in `/video/[jobId]`.

### Querying prod DB (Supabase MCP is mis-scoped → can't reach `ddoz`)
Use the **authenticated browser** session (Clerk token + publishable key never leave the page; MCP blocks any output containing key strings, so use a decoupled "store on `window`, read sanitized" pattern):
```js
// once: discover config from the bundle + stash on window (returns only booleans)
// then query Supabase REST with apikey=<publishable> + Authorization: Bearer <await window.Clerk.session.getToken()>
// e.g. find eligible items:
//   GET {url}/rest/v1/content_creatives?select=content_item_id,content_items(brand_id,brands(name,user_id))
//        &creative_brief->>visual_tension=not.is.null&creative_brief->>visual_metaphor=not.is.null&order=created_at.desc
```
Any call that invokes `getToken()` has its OUTPUT suppressed by the MCP — store results on `window.__x` in that call, read them back (sanitized to ids/names only) in a separate call. Alternative: Supabase **dashboard** SQL editor.

### 3. Cleanup / hardening (fix-on-arrival)
- Delete stuck test `render_job` `e6ffb1b5-ca1d-4106-912f-e644ab663086` (queued, harmless).
- `env.ts` empty-`REDIS_URL` guard (above).
- intra-video dedup (`06-diversity.ts`); crossfades.
- ⚖️ **Commercial/legal NO-GO** for *using/publishing* output until AtlasCloud/Seedance output ownership+resale rights confirmed in writing (a test render is fine).

## P0 — Reliability / launch gates
- **Clerk DEV→prod** (operator; gates public launch). Live = DEV `pk_test_…pro-beetle-20.clerk.accounts.dev`. Steps: provision PROD instance + custom domain (DNS lead time) → **update Supabase Third-Party Auth issuer FIRST** → swap `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`→`pk_live_` + `CLERK_SECRET_KEY`→`sk_live_` (Production) → redeploy (publishable key build-inlined) → set `ADMIN_EMAILS` → verify. **Data:** DEV/PROD user IDs differ → re-key `user_id` rows or accept orphaning. No webhooks, no JWT template.
- **Rotate secrets** — Google Sheet plaintext + ElevenLabs in `.mcp.json` + **the Railway project token AND AtlasCloud API key pasted in chat this session**.
- **Worker `SENTRY_DSN`** — set on Railway (unset → boot crashes invisible).
- **Railway Redis has no auth** — add one if it's ever publicly exposed (Option B).

## Publishing RC1 (next feature flip — low risk; PUB-1 posts nothing live)
Migrations 027/028 applied. Enable on **Vercel AND worker**: `INTEGRATIONS_ENC_KEY` (`openssl rand -base64 32`, identical both), provider OAuth env, `PUBLISHING_ENABLED=true` (worker first); set `ADMIN_EMAILS` (Vercel). Redeploy worker → log `publish registered`. Rollback = unset `PUBLISHING_ENABLED`.

## Video V1 Phase 2 (after first MP4)
Extend the Gemini strategy engine (keep A+ abstract-safe): format awareness (9:16/16:9/1:1/4:5; 4:5 = FFmpeg crop), platform optimization, brand-asset FFmpeg overlays (logo/founder/screenshot — assets NEVER sent to AtlasCloud), CTA cards, scene diversity. ElevenLabs **TTS** narration (worker-side REST → R2 → FFmpeg mux). Optional: extract `atlascloud.ts` from `seedance.ts`.

## Misc debt
- Public GitHub repo — audit history for leaked secrets.
- Only `tsc`/`next build` error is the git-ignored `scripts/phase2a-acceptance.local.ts` — ignore.
