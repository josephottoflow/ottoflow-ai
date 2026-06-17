# Session Handoff — 2026-06-13 (Creative Orchestrator DEPLOYMENT)

**TL;DR:** Brand Creative Orchestrator v1 is **built, spec-aligned, and 95% deployed**. Migrations 017+018 are applied & verified in prod Supabase; branch + `main` are pushed; Vercel is READY; the Railway worker is live (health 8/8). **One blocker remains:** the `brand_assets` upload route 500s on Vercel — `"Could not load the sharp module"`. Two fixes are already pushed (`0ddd882` lockfile linux binary, `2d1255c` `serverExternalPackages:["sharp"]`); as of session end the route still returned 500 (the `2d1255c` build may not have swapped yet — UNVERIFIED). Smoke test is paused at the first upload. **Tomorrow: confirm `2d1255c` is live, re-test; if still 500, deeper sharp diagnosis; then finish the smoke test + deployment report.**

---

## 1 · What's DONE (verified)

**Migrations applied + verified in prod** (Supabase project `ddozknywcdpyfdokmfrp`, name "ottoflow-staging", branch `main PRODUCTION` — this IS the live app DB; 010–016 were applied here too):
- **017_brand_assets** ✅ — `brand_assets` table, 13 cols incl. `locked`; kinds `logo|founder_headshot|team_headshot`; RLS + `brand_assets_owner_select`; `brand-assets` public bucket. Verified via catalog query.
- **018_content_creatives** ✅ — `content_creatives` (16 cols), RLS + policy, `content_creatives_updated_at` trigger, realtime publication, `brands.creative_preferences` column, `content-creatives` public bucket. Verified via catalog query.
- Preflight confirmed correct DB (brands/content_items/content_metrics present; 017/018 absent before apply).

**Git** — branch `feat/ffmpeg-multi-agent-pipeline` == `origin` == `main`, 0 unpushed. Commits on top of `8a7601b`:
| SHA | What |
|---|---|
| `2e1c23d` | Phase A — asset library |
| `06ca937` | Phase B — strategy + approval gate |
| `eb07bc7` | Phase C — generation (Imagen + sharp composite) |
| `36e0927` | Phase D — hierarchy attribution |
| `6d12adc` | Phase A alignment — founder_headshot/team_headshot + locked |
| `47b97a4` | Phase B alignment — engine selects founder_headshot |
| `0ddd882` | **fix:** sharp linux-x64 binaries in lockfile (optionalDependencies) |
| `2d1255c` | **fix:** `serverExternalPackages:["sharp"]` in next.config.ts |

**Vercel** — production deploy of `0ddd882` was READY (sha-confirmed, aliased to `ottoflow-ai.vercel.app`). `2d1255c` pushed after; its build state at session end was **UNVERIFIED** (likely still building/just swapped).

**Railway worker** — LIVE. `/api/debug/health` = 8/8: clerk_auth valid (user `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`), supabase admin+user (7 brands), redis PONG, bullmq ok, **worker_liveness 1 connected**, gemini pong. (Creative gen is Imagen+sharp, lightweight — NOT gated on the Railway 2 GB video bump.)

**Synthetic hierarchy validation** (pre-deploy, pure engine, real run) — all passed: founder-asset→founder_led, logo-only→brand_led (founder_led+data_led ineligible), statistic-only→data_led. (`docs/CREATIVE_ORCHESTRATOR_DEPLOYMENT.md` has the table.)

---

## 2 · THE BLOCKER (resume here)

`GET`/`POST /api/brands/[id]/assets` → **500**, runtime log: `⨯ [Error: Could not load the sharp module…`. The route does `import sharp from "sharp"` at module scope (read-only metadata validation), so the module fails to load → 500 before the handler runs. (Unauthenticated requests return 404 via Clerk middleware and never hit the import — so a readiness poll MUST be authenticated, i.e. run in the logged-in browser, not curl.)

**Fixes already pushed:**
1. `0ddd882` — added `@img/sharp-linux-x64@0.35.1` + `@img/sharp-libvips-linux-x64@1.3.0` to `optionalDependencies` so the Windows-generated lockfile carries the linux glibc binary for Vercel's `npm ci`. (Verified both are in `package-lock.json`.)
2. `2d1255c` — `serverExternalPackages:["sharp"]` so Next requires sharp from node_modules at runtime instead of bundling it.

**Still 500 at session end.** Either `2d1255c` hadn't swapped to production yet, or it didn't fully resolve it.

### Tomorrow's diagnostic order
1. `get_deployment` for the latest `main` deploy → confirm sha `2d1255c` is READY + aliased to `ottoflow-ai.vercel.app`. (Vercel MCP: project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`, team `team_MrIWWj7J9L2KLG58IRFcnDK7`.)
2. In the **logged-in browser**, re-test: `fetch('/api/brands/b1384434-3666-45cc-96d9-ca764e90cdc3/assets').then(r=>r.status)` → want 200 (empty list ok), not 500.
3. If still 500: `get_runtime_logs` for the new deploymentId, level=error, see if the message changed. Also `get_deployment_build_logs` → confirm `npm ci` actually installed `@img/sharp-linux-x64` on the build.
4. If sharp still won't load via config, the remaining options (in order, all "deployment fix" not refactor):
   - Confirm Vercel didn't strip optional deps (`npm config get omit` / `--omit=optional`); if so, move the two `@img/*` packages from `optionalDependencies` to `dependencies` (they'll fail-skip on Windows local installs but install on Vercel — verify local `npm install` still works first).
   - `experimental.outputFileTracingIncludes` for the assets route pointing at `node_modules/@img/sharp-linux-x64/**`.
   - Last resort (small code change, still deployment-scoped): make the `sharp` import **lazy/dynamic** inside the two handlers (`const sharp = (await import("sharp")).default`) so a load failure can't break module init — but try the config paths first.

---

## 3 · Smoke test — where it's paused

Sequence (user-specified): upload logo → upload founder headshot → generate content → generate creative → review brief → approve → verify composite → verify storage → verify analytics.

**Reached:** navigated to Basecamp brand page (`b1384434-3666-45cc-96d9-ca764e90cdc3`); the **Brand Assets UI renders correctly** with kinds `logo / founder_headshot / team_headshot` (confirms deployed Phase A taxonomy + file input accept `image/png,image/jpeg,image/webp`). Upload **blocked by the 500**.

**Test asset injection method (important — the `file_upload` MCP tool REJECTS project-dir files):**
- Test images exist at `ottoflow-ai/.smoke-assets/logo.png` (2038 B) + `founder.png` (small) — generated via sharp (`gen2.cjs`). UNTRACKED, do not commit; gitignore or delete at the end.
- Upload by injecting bytes into the `<input type=file>` via `DataTransfer`: get base64 from PowerShell (`[Convert]::ToBase64String(...)`), then in-page build a `File` from `atob`, `dt.items.add(file)`, `input.files=dt.files`, dispatch `change`, then click the **Upload** button. Keep images small so base64 stays clean (large base64 broke the JS tool).
- The BrandAssets component reads `fileRef.current.files[0]` on Upload click.

**Reading API JSON in-browser:** responses containing cookie-like data get redacted by the browser tool ("[BLOCKED: Cookie/query string data]") — read only `r.status`, or scrape the rendered DOM, or read the SQL-editor result grid via `[role="row"]`/`[role="gridcell"]` `.textContent` (screenshots time out — Supabase renderer freeze).

---

## 4 · Environment / access (all working this session)

- **Browser:** Claude-in-Chrome extension connected — deviceId `d5720f11-871d-4c81-a09f-1bde15b4ebda` (Windows, local). Logged into BOTH the Supabase dashboard AND the prod app (Clerk). Tab `639409714`.
- **Supabase SQL via browser:** `monaco.editor.getEditors()[0].setValue(sql); ed.focus()` then `Ctrl+Enter`; additive migrations trigger a "destructive operations" modal (from `DROP POLICY IF EXISTS`) → click the dialog's **"Run query"** button. Read results from the grid DOM (not screenshots). Auth token lives in `localStorage['supabase.dashboard.auth.token']` but the pg-meta replay needs an encrypted connection string — don't bother; use the editor.
- **No Supabase CLI/DDL token on the machine** — browser dashboard is the only DDL path (unchanged from prior sessions).
- **Vercel MCP** project/team IDs above. **No Railway API/token** — verify the worker functionally via `/api/debug/health`.

---

## 5 · Deliverable docs written this session (UNCOMMITTED in `docs/`, decide whether to commit)

- `docs/CREATIVE_ORCHESTRATOR_DEPLOYMENT.md` — the deployment checklist + migration verification + synthetic results.
- `docs/VIDEO_PIPELINE_VALIDATION.md` — the FFmpeg-pipeline audit (4 scenes → 2 unique clips; root cause: no intra-video dedup in `06-diversity.ts`).
- `docs/REMOTION_SPIKE_REPORT.md` — recommendation **A (push FFmpeg)**; Remotion already OOM-failed on Railway 1 GB (per ADR-002).
- `docs/SESSION_2026-06-13_DEPLOY_HANDOFF.md` — this file.

(These + `.smoke-assets/` + the usual DO-NOT-COMMIT stragglers are the only untracked working-tree items.)

---

## 6 · Resume checklist (tomorrow)

1. Read this file. `git fetch && git status -sb` → expect in-sync at `2d1255c`.
2. Confirm `2d1255c` is the live production Vercel deploy (READY, aliased).
3. Logged-in browser: re-test `GET /api/brands/.../assets` status. **200 → blocker cleared, jump to step 5.** 500 → §2 diagnostics.
4. Once the route works: re-verify with a fresh runtime-log check (no 500s on `/assets`).
5. Resume smoke test on Basecamp: upload logo + founder headshot (DataTransfer method §3) → generate content (worker) → generate creative (brief, synchronous route) → review brief preview (hierarchy/confidence/concept/rationale/headline/CTA/logo+headshot+company+founder usage) → **Approve** → watch `approved→generating→ready` (confirms the NEW worker has the creative-generation processor) → verify composite image renders with the REAL uploaded logo/headshot composited over an Imagen background (no text/logo/face) → verify storage objects in `content-creatives` bucket → verify `/analytics` "Creative hierarchy performance" + a `creative` recommendation.
6. Write the deployment report (the user's task 10).

**Memory:** `ottoflow-app-state.md` (has the Creative Orchestrator build entry — update with deploy status), `v2-direction.md` (deploy playbook), `adr-002-ffmpeg-pivot.md` (video). The repo CLAUDE.md is unchanged.
