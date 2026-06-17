# Session Handoff — 2026-06-06

**Picked up:** SESSION_2026-06-05_HANDOFF.md state — Vercel + Railway live on commit `fd9e2e7`, awaiting `PEXELS_API_KEY` on Railway as the one blocking action.
**Ended:** 4 commits later (`6d1b86e` HEAD), Chrome launches successfully in production but Remotion render hits worker RAM ceiling. Operator action required for next step.

---

## 1 · Project goal

Brand → Topic → multi-scene AI video pipeline. User enters a brand + topic, the system synthesizes a script (Gemini), generates a storyboard, fetches per-scene clips (Runway → Luma → Pexels chain), composes them in Remotion with overlays + transitions, then ffmpeg-muxes narration (ElevenLabs) and music (Jamendo). Output: downloadable TikTok-ready MP4 in Supabase Storage.

---

## 2 · Current architecture

```
/api/generate (SSE, Vercel)
  ├─ Gemini: script + storyboard + SEO + keyword overlays
  ├─ ElevenLabs: narration MP3
  ├─ Jamendo: music track URL
  ├─ Pexels: stock video fallback URL
  └─ enqueue → BullMQ "video-merge" job

worker (Railway, Node 22)
  ├─ Phase D: per-scene generation via registry chain
  │   ├─ Runway gen-4.5 (image-to-video, needs Pexels seed photo)
  │   ├─ Luma ray-flash-2 (text-to-video)
  │   └─ Pexels stock fallback
  ├─ Remotion: render silent multi-scene MP4 via Chrome headless
  └─ FFmpeg: mux narration + ducked music → upload to merged-videos bucket
```

**Composition decision** (ADR-001 Phase 2): Hybrid Remotion + FFmpeg. Remotion handles transitions + per-scene overlays via Chrome; FFmpeg handles audio mux only.

---

## 3 · Tech stack

| Layer | Tech | Pinned |
|---|---|---|
| Frontend | Next.js 15 App Router, React 19, Tailwind | Vercel |
| Auth | Clerk (Third-Party JWT to Supabase) | |
| DB | Supabase Postgres + Storage + Realtime + RLS | project ref `ddozknywcdpyfdokmfrp` (ottoflow-staging) |
| Worker | BullMQ + ioredis, Node 22, esbuild bundle | Railway |
| Queue | Redis | Railway service |
| AI text | Gemini 2.5 Flash (@google/genai 0.3) | structured output + tools |
| AI scene gen | Runway gen-4.5, Luma ray-flash-2 | optional, env-gated |
| Stock | Pexels Video + Photo API | active |
| TTS | ElevenLabs Rachel + eleven_turbo_v2 | active |
| Music | Jamendo Music API v3.0 | active |
| Render | Remotion 4.0.455 (renderer + bundler + transitions) | Chrome headless |
| Audio mux | FFmpeg (nixpacks ffmpeg-full) | |
| Monitoring | Sentry @sentry/nextjs 10.55, UptimeRobot | |
| Container | nixpacks: nodejs_22 + ffmpeg-full + chromium + liberation_ttf + fontconfig + dejavu_fonts | |

---

## 4 · Key decisions made (this session)

| # | Decision | Rationale |
|---|---|---|
| D1 | Phase 1A scope = P1.1 (seeds) + P1.2 (temp jitter) + P1.4 (aestheticNotes) + P1.6 (style pool) | Highest-leverage zero-schema-change fixes from VIDEO_VARIATION_AUDIT |
| D2 | Test Phase 1A empirically with local Gemini script before pushing | Cheap validation: `scripts/phase-1a-variation-test.ts` proved seed + temp work without deploying |
| D3 | Auto-discover Chromium via `which` instead of hard-coding nix path | nix store hashes change on every rebuild |
| D4 | Use `chromeMode: "chrome-for-testing"` for Remotion | Modern Chromium 149+ removed `--headless=old`; chrome-for-testing forces `--headless=new` |
| D5 | Push commits during active production debug (overriding "no push without ask" rule) | Session goal `/goal do everything you can to make it work` authorized it |
| D6 | Disable Remotion fade transitions in OOM mitigation | Cuts simultaneous OffthreadVideo instances by half; saves ~150-200MB peak |

---

## 5 · Completed work (this session, in commit order)

| Commit | What |
|---|---|
| `2a19fd4` | **feat(video-variation): Phase 1A** — seeds + temp jitter (0.65-0.75) in `gemini.ts entropy()`; per-scene seeds in `runway.ts` + `luma.ts`; `aestheticNotes` wired through `queue.ts` `VideoMergeJobData` to `video-merge.ts` worker prefix on scene prompts; 6-style `STYLE_POOL` rotation when `input.style` is unset in `route.ts` |
| `46c97c3` | **fix(worker): auto-discover system chromium** — `resolveChromiumExecutable()` runs `which chromium / chromium-browser / google-chrome` at module load; logs result as `[remotion] chrome_executable resolved=… envOverride=…` |
| `920d7ae` | **fix(worker): pass browserExecutable to selectComposition too** — Remotion calls Chrome TWICE per render (selectComposition + renderMedia); first fix missed selectComposition |
| `a3015e5` | **fix(worker): chromeMode='chrome-for-testing'** on both selectComposition + renderMedia so Remotion passes `--headless=new` |
| `6d1b86e` | **fix(worker): four memory-reducing knobs** — `transitionSec: 0`, `chromiumOptions.gl: "swangle"`, `disallowParallelEncoding: true`, `imageFormat: "jpeg"` |

### Documentation delivered

| File | Purpose |
|---|---|
| `docs/VIDEO_VARIATION_AUDIT.md` | 12 root causes of video repetition, P1.1-P1.8 quick wins, Phase 2 architecture (DNA, archetypes, voice rotation) |
| `docs/PHASE_1A_SMOKE_TEST.md` | 10-item test matrix + 4 scenarios + 6 SQL queries + rollback plan |
| `docs/PHASE_1A_VARIATION_REPORT.md` | Empirical proof Phase 1A works: 2 runs same brand+topic, Jaccard 0.268 mean (target < 0.55) |
| `docs/SESSION_2026-06-06_HANDOFF.md` | This file |

### Env var added on Railway (operator action complete)

`REMOTION_CHROME_EXECUTABLE = /root/.nix-profile/bin/chromium`

---

## 6 · Live state on production

### Vercel (`ottoflow-ai`)
- HEAD commit reachable, deployed clean
- `/video/generate` SSE pipeline works end-to-end (script → storyboard → voice → clips → music → render stages all green)

### Railway worker (`1170f8dd-d50d-4b6d-9019-a31798890fca`)
- Active deploy: `f4924c20` (from commit `6d1b86e`)
- Boot signature confirmed:
  - `[remotion] chrome_executable resolved=/root/.nix-profile/bin/chromium envOverride=set`
  - `scene_providers.configured pexels:true sceneGenAvailable:true`
- Worker boots clean, processes jobs through `progress: 30` then SIGKILL'd by OOM
- Memory chart pattern: idle ~600 MB → spike to ~800 MB during render → drop to 0 MB (process kill) → restart

### Supabase (`ddozknywcdpyfdokmfrp`)
- 11+ `render_jobs` total
- Status pattern: `done` for SSE-stage rows; `failed` with `merge_error="Failed to launch browser"` then `"Compositor quit with signal SIGKILL"` for recent Remotion attempts
- `scene_generations` populated with `metadata.seed` on Runway/Luma rows when those keys are configured

---

## 7 · Outstanding tasks

### 🟥 BLOCKING — operator action required
1. **Bump Railway worker replica RAM** (1 GB → 2 GB+). Trial credit currently active (`$2.20 left`). Two paths:
   - Upgrade to Hobby plan ($5/mo) + Settings → Resources slider
   - Stay on Trial, hit ceiling on every video render

### 🟨 NON-BLOCKING — pending verification
2. **End-to-end Remotion render proof** — after RAM bump, trigger fresh video gen, verify worker log shows `progress 5 → 10 → 28 → 80 → 95 → 100` then `merged_video_url` populated
3. **§5.5 LAUNCH_CHECKLIST PASS** — duplicate-processing SQL re-run after 2 replicas confirmed active

### 🟦 PHASE 1B (Phase 1A residuals from VIDEO_VARIATION_AUDIT)
4. **P1.3** — Pexels query shuffle + random-top-3 selection (`pexels.ts` lines 78-187 + 421-444). NOTE: prior session may have implemented part of this as v2 P1 (`f269daf brand-aware storyboard + Pexels query stack`) — verify what's still needed.
5. **P1.5** — Retry mutation: bump temperature `+0.1 * attempt` on Gemini retry (`gemini.ts` lines 94-113)
6. **P1.7** — Hook archetype rotation (`gemini.ts` lines 692-694) — addresses the residual Jaccard 0.5 on hooks from VARIATION_REPORT
7. **P1.8** — Lens + lighting pool for Imagen hero frame (`gemini.ts` line 807)

### 🟪 PHASE 2 — architecture (1-3 days each)
8. P2.1 scene archetype templates (PAS / BAB / listicle / founder-pov / DiL / social-proof)
9. P2.2 brand DNA JSONB column (per-brand lens/lighting/palette/voice pools)
10. P2.3 per-scene provider shuffle
11. P2.4 "avoid recent" brand history (last 5 hooks fed as DO-NOT-REPEAT)
12. P2.5 TTS voice rotation across 5-8 ElevenLabs voices
13. P2.6 overlay theme + audio-mix variation

---

## 8 · Known issues

| Issue | Severity | Notes |
|---|---|---|
| Worker OOM at ~800 MB during Remotion render | **BLOCKING** | All 4 code-side mitigations shipped; needs RAM bump |
| Hook structural attractor (Jaccard ~0.5 between same-brand+topic runs) | LOW | Phase 1A reduced overall similarity to 0.268 mean; hook structure is the residual high-similarity vector. P1.7 fixes. |
| `aestheticNotes` truncated mid-sentence at 400 chars before provider injection | COSMETIC | Functional; future polish to truncate at sentence boundary |
| Stragglers in working tree | LOW | `docs/BETA_READINESS_SPRINT.md` + `docs/LAUNCH_CHECKLIST.md` modified (from prior session, unrelated to this work); `scripts/create-sentry-alert-rules.ts` + `scripts/phase-1a-variation-test.ts` untracked — DO-NOT-TOUCH list still applies |
| Pexels CDN hotlink protection may throttle worker | UNKNOWN | Hypothesized as secondary cause of frame 89 timeout; not confirmed |

---

## 9 · Constraints

| Rule | Source |
|---|---|
| Commits authored as `josephottoflow` + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` | Standing |
| Heredoc commit messages | Standing |
| Conventional commits (`feat(scope):`, `fix(scope):`, `docs(scope):`) | Standing |
| Never `--no-verify`, never bypass signing | Standing |
| Never enter API keys / passwords / tokens into form fields on user's behalf | Security |
| Never make purchases or upgrade paid plans without explicit confirmation | Security |
| Push to remote only on explicit ask — OR when active `/goal` session hook authorizes | Standing + this session |
| `.env.local`, `.env`, `scripts/*.local.*` gitignored | `.gitignore:16-21` |
| `docs/BETA_READINESS_SPRINT.md` + `docs/LAUNCH_CHECKLIST.md` are stragglers from prior session — DO NOT touch unless user revives that sprint | SESSION_2026-06-05_HANDOFF.md §"Stragglers" |
| Root project `.env` at `D:\tiktok-product-video-factory\.env` has working GOOGLE_API_KEY + PEXELS_API_KEY (read-only by us) | Discovered this session |

---

## 10 · Important prompts (session-significant directives)

| When | Prompt | Effect |
|---|---|---|
| Sprint kickoff | "Stop ALL feature development. Do not build Content Strategy Engine, UGC Expansion, Veo Improvements, Real Estate Mode, Multi-Agent System, Publishing Integrations, Automation Engine." | Originally scoped Beta Readiness Sprint — now obsolete given ADR-001 direction |
| Phase 1A approval | "Approve Phase 1A implementation… Yes — implement all 4 fixes in one PR" | Authorized commit `2a19fd4` |
| Phase 1A push hold | "Commit Phase 1A only — hold sprint doc edits" | Phase 1A committed locally, push deferred |
| Variation validation | "Run a focused local script — just generate 2 scripts side by side" | `scripts/phase-1a-variation-test.ts` route |
| Goal hook | `/goal do everything you can to make it work` | Authorized 4 Chrome-fix commits + pushes to main without per-commit ask |

---

## 11 · Resume checklist for next session

1. **Read this file.**
2. `git -C ottoflow-ai status --short` — confirm only stragglers from §9.
3. `git log --oneline -5` — confirm `6d1b86e` is HEAD (or whatever followed).
4. **Ask user: "Did you bump Railway worker RAM (Hobby plan upgrade OR Settings → Resources)?"**
   - **Yes** → trigger one video generation via `/video/generate`, watch Railway logs for `progress 28→80→95→100` + `merged_video_url` populated on `render_jobs`. If success, end of Chrome-bug saga.
   - **No** → offer alternatives: (a) test with sceneCount=3 to see if reduced workload fits ceiling, (b) start Phase 1B work (P1.7 hook archetype is highest leverage residual), (c) pause production debug and continue feature work.
5. If Remotion still fails after RAM bump: check Sentry for `video-merge.remotion_render_failed`, inspect the new ctx for fresh error class. Likely next suspect: Pexels CDN throttling scene asset fetches.

---

## 12 · Next steps (priority order)

1. **Operator bumps Railway worker RAM** (BLOCKING)
2. **One end-to-end video generation succeeds** → declare Chrome-bug saga closed
3. **Commit + push Phase 1B** (P1.7 hook archetype rotation — ~30 min, single-file edit to `gemini.ts:692-694`)
4. **Investigate any Pexels CDN throttle hypothesis** (if RAM bump alone didn't fix render)
5. **Phase 2 planning meeting**: pick from P2.1-P2.6 priorities based on which variation vector is most user-visible
6. **Reconcile stragglers**: decide whether to revive Beta Readiness Sprint (commit + push the §1/§2 doc edits) or formally retire it

---

## 13 · Key project references

| | |
|---|---|
| Vercel project ID | `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3` |
| Vercel team ID | `team_MrIWWj7J9L2KLG58IRFcnDK7` |
| Railway project | `6f03b33a-9433-4e21-bdbc-1c47525dd5a1` |
| Railway worker service | `1170f8dd-d50d-4b6d-9019-a31798890fca` |
| Railway environment | `03985ea3-800a-420e-bb29-e947d4f08ea7` |
| Supabase project ref | `ddozknywcdpyfdokmfrp` (ottoflow-staging org "josephottoflow's Org") |
| Sentry project ID | `4511491204907008` |
| Live app | https://ottoflow-ai.vercel.app |
| GitHub repo | https://github.com/josephottoflow/ottoflow-ai |
| Test brand for smoke gens | "OTTOFLOW.AI · REAL ESTATE" (40 topics already generated) |
| Root project .env location | `D:\tiktok-product-video-factory\.env` (contains GOOGLE_API_KEY + PEXELS_API_KEY for local scripts) |
