# Session Handoff — 2026-06-13 (supersedes SESSION_2026-06-12_HANDOFF.md)

**TL;DR:** The entire V2 loop is LIVE and verified in production:
**research → evidence → opportunity → content → review → approve → schedule → publish → metrics → attribution → recommendations.**
Two fully-designed features await "go": **API Publishing (LinkedIn)** and **Brand Creative Orchestrator**.
🔴 **Railway trial ~$0.25 left (~1–2 days of worker life). Hobby upgrade is the single most urgent action — it also unlocks the 2 GB RAM bump that fixes video rendering.**

---

## 1 · Production state (HEAD = `8a7601b`, branch + main in sync, Vercel READY, Railway ACTIVE)

| Shipped this session (all live + E2E-verified) | SHA | Migration |
|---|---|---|
| Phase 1B video-variation + V2 evidence layer + 2A/2B/2C (deployed at session start after audit revealed nothing had been pushed) | `953d4a5…e27661b` | 010–013 ✅ applied |
| Production Hardening v1 (P0 shard fix, P1 batch enrichment 100%, P2 score calibration 0.65-cap, P3 diversity) | `cf1c08c` | — |
| Review Queue (draft→in_review→approved/rejected; worker auto-submits; status_history audit trail) | `5141061` | 014 ✅ |
| Publisher Foundation (approved→scheduled→published, manual-first; transition contract for future APIs) | `bfdf441` | 015 ✅ (applied after a long Supabase dashboard outage — see §4) |
| Analytics Ingestion v1 (content_metrics snapshots, manual entry ×2 paths, perf dashboard, attribution to topics/lenses/evidence-domains) | `09b05db` | 016 ✅ |
| Optimization Recommendations v1 (pure rule engine, 7 rule families, early-signal tags, live: 4 recs w/ correct suppressions) | `8a7601b` | — |
| Ops docs: ACCESS.md, DEPLOYMENT.md (ops sections appended), RELEASE_CHECKLIST.md | `035dd70` | — |

**Migrations applied: 010–016** (all via dashboard SQL editor, browser-driven: `window.monaco.editor.getEditors()[0].setValue(sql)` + Ctrl+Enter; "destructive operation" modal = expected for DROP-IF-EXISTS guards, confirm it).

**Live E2E evidence (verified, not assumed):**
- Full lifecycle on real items: Tests A/B/C/D passed; status_history = 8/8 transitions w/ actors+notes; queues consistent.
- Attribution chain proven with real data: evidence domains (smarttask.io, monday.com…) → opportunity ("Hidden Cost of Fragmented Communication", competitor_gap) → post ("Fragmented Communication Drains Your Team's Focus") → 4.2K imp / 6.00% ER → recommendations referencing all of it.
- Current corpus: 3 published posts (2 w/ metrics), Basecamp brand `b1384434-…` is the evidence-rich testbed (46 chunks, 100% enriched/embedded), Canva `a40fc979-…` is the pre-hardening baseline (34 chunks, 8 JSON shards — re-research someday to clean).

## 2 · Staged work awaiting "go" (both fully designed in chat this session)

1. **API Publishing Foundation (LinkedIn-first)** — plan delivered. Key facts: plugs into the existing publish-transition contract; `platform_connections` table + `publish_error`/`publish_attempts` cols (migration 017); worker repeatable job auto-publishes due scheduled items w/ claim-based idempotency + 3 retries; LinkedIn via **"Share on LinkedIn" + OpenID products = self-serve, no review** (scopes `openid profile w_member_social`, posts as member; org-page posting = Community Mgmt API approval, deferred); operator must create the LinkedIn app + set `LINKEDIN_CLIENT_ID/SECRET` in Vercel+Railway. Manual publishing stays as fallback.
2. **Brand Creative Orchestrator v1** — full design delivered (twice, second version is canonical). Two-layer architecture (AI strategy/background ONLY — locked assets NEVER touch models; deterministic sharp compositing: resize/crop/mask/position whitelist). 5 hierarchies (founder_led/brand_led/data_led/quote_led/product_led-deferred), code-computed eligible set + confidence formula (0.40 assets + 0.30 model + 0.20 opportunity + 0.10 platform; <0.55 → force brand_led), Creative Brief jsonb as source of truth, `brand_assets` + `content_creatives` (w/ denormalized creative_hierarchy for attribution) + `brands.creative_preferences` jsonb (learning structure, read-only v1). Phases A (assets+UI) → B (orchestrator + brief preview) → C (worker gen+composite — GATED on Railway upgrade) → D (attribution+learning).
   **Recommended order: Railway upgrade → Publishing → Creative A–D.**

## 3 · Key technical facts for the next session

- **Embeddings**: `gemini-embedding-001` @ `outputDimensionality: 768`, L2-normalized (text-embedding-004 404s on this key).
- **Deploy playbook**: migrations FIRST when code writes new columns (014-class) — see RELEASE_CHECKLIST.md; push = `git push origin feat/ffmpeg-multi-agent-pipeline && git push origin HEAD:main`; **wait for Railway "Deployment successful" before worker-path tests** (job picked up mid-swap runs on OLD worker — burned us once with brand "Buffer" = 0 evidence, expected artifact).
- **Schema verification without dashboard**: anon-key REST probes (key = `sb_publishable_…` in app bundle layout chunk); PGRST205/42703/PGRST202 distinguish missing objects from RLS-empty.
- **Browser automation gotchas**: app pages need hydration before clicks (re-click if no spinner; use `form_input` or native-setter JS for inputs); Supabase dashboard randomly hangs/blanks (navigate-retry; old tabs sometimes recover); Railway variables UI shows names only (no token there — none exists anywhere on this machine; Supabase CLI unauthenticated, login is TTY-interactive = operator-only).
- **Local gates**: `npx tsc --noEmit` (ignore known error in untracked `scripts/create-sentry-alert-rules.ts`) + `npm run build:worker`. Local `next build` fails at env collection — expected.
- **Cost baselines**: research run $0.029–0.048 / ~115–210s; mining scan $0.0075; post ~$0.002; embeddings 100% success.

## 4 · Incidents survived (context for weird-looking data)

- **Supabase dashboard outage (~hours)**: frontend boot-crash (assets 200, zero API calls, blank body) — blocked migration 015 for a while; code was deployed first (safe direction for 015), publishing page degraded gracefully as designed; dashboard recovered spontaneously in an OLD tab. ACCESS.md exists because of this; the permanent fix (operator: `npx supabase login` once, or SUPABASE_ACCESS_TOKEN in root .env) is STILL NOT DONE.
- **Railway slow-deploy incident** + the still-unresolved credit countdown ($0.45→$0.25 in ~a day; banner: "9 days or $0.25").
- Token false-starts: user said tokens were added twice; exhaustive verified searches found nothing on this machine — always verify from git/API/DB state, never assertions (memory `v2-direction` has the lesson).

## 5 · Open items / debt (unchanged unless noted)

- 🔴 Railway Hobby upgrade ($0.25 left) → then 2 GB RAM (Settings→Resources) → one `/video/generate` E2E closes the ADR-002 render saga → re-enable crossfades (concat→buildXfadeArgv).
- Supabase access hardening (ACCESS.md steps) — operator, 5 min.
- Clerk DEV keys in prod; hydration #418; /video mock "Output Types"; "Content vs Video Output" chart flat (pre-existing trio from the audit, still unfixed).
- Canva corpus contains 8 pre-hardening JSON-shard chunks (harmless; re-research replaces).
- LinkedIn org-page posting + Meta/X APIs = future approvals.

## 6 · Resume checklist

1. Read this file. `git fetch && git status -sb` → expect in-sync at `8a7601b`, only known stragglers dirty (docs/SESSION_*, docs/PHASE_1A_*, scripts/create-sentry-alert-rules.ts, scripts/phase-1a-variation-test.ts, scripts/*.local.ts, 2 modified DO-NOT-COMMIT docs).
2. **Ask: "Railway upgraded?"** If yes → RAM 2 GB → video E2E. If no → warn (worker death imminent).
3. Await "go publishing" / "go creative" (designs in §2; both start with their migration via the SQL-editor technique or `supabase db push` if the operator finally authenticated the CLI).
4. Sanity: /analytics shows 4 recommendations; Basecamp brand page shows Ask + 10 opportunities; review/publishing queues consistent (11 draft / 3 published).

**Memory**: `ottoflow-app-state.md` (chronological detail), `v2-direction.md` (thesis + playbook), `adr-002-ffmpeg-pivot.md` (video). MEMORY.md index points here.
