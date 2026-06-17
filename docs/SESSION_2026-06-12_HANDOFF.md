# Session Handoff — 2026-06-12

**Picked up:** SESSION_2026-06-06_HANDOFF.md state — everything blocked on the Railway RAM bump; FFmpeg pipeline (ADR-002) code-complete but 0% render success in prod; branch at `1a8f1fa`, never pushed.
**Ended:** **V2 Intelligence Layer designed, built, DEPLOYED to production, and acceptance-passed.** 9 commits pushed (`1a8f1fa..e27661b` on branch AND main), migrations 010–013 applied to Supabase, Vercel + Railway live, full end-to-end acceptance on a fresh brand. The platform now permanently accumulates research evidence.

---

## 1 · Production state (VERIFIED, not assumed — as of session end)

| System | State |
|---|---|
| GitHub | `origin/feat/ffmpeg-multi-agent-pipeline` AND `origin/main` both at **`e27661b`** |
| Vercel | Production READY at `e27661b` (`dpl_BV5TY4JQxEsNN1SLYeJZFqVRd6jj`), aliased ottoflow-ai.vercel.app, 9 lambdas |
| Railway worker | Redeployed at `e27661b` and **functionally proven** (new evidence code ran live). NOTE: deploy took ~15 min due to a Railway platform incident |
| Supabase (`ddozknywcdpyfdokmfrp`) | Migrations **010, 011, 012, 013 applied** (via dashboard SQL editor, browser-driven; verified by catalog query 11/11 true + REST probes all 200) |
| Acceptance | **PASSED** end-to-end on fresh brand "Canva" (see §5) |

### ⚠️ URGENT operator items (in priority order)
1. **Railway trial: "10 days or $0.45 left"** at session end. When it exhausts, the worker dies → research, evidence capture, content generation ALL stop. Upgrade to Hobby (~$5/mo) ASAP.
2. **Same upgrade unlocks the 2 GB RAM bump** (service Settings → Resources) that fixes the video render OOM — the longest-standing blocker (ADR-002; 41 jobs, 0 new-pipeline successes at 1 GB).
3. Clerk still on DEV keys in prod (pre-existing; flagged in audits).

---

## 2 · Everything that happened this session (chronological)

1. **Phase 1B video-variation fixes** (`953d4a5`): P1.3 Pexels shuffle + random-top-3, P1.5 retry temp bump + fresh seed, P1.7 hook+CTA archetype rotation, P1.8 lens×light pools. Validated live (hook Jaccard 0.105–0.417; 5/5 distinct Pexels clips). **Now deployed** (rode along with the push).
2. **Full product audit** (`db80abe` → `docs/PRODUCT_AUDIT_2026-06.md`): 13-phase teardown. Headlines: no publish loop, render 0%, research evidence discarded, IA misdirection.
3. **V2 Masterplan** (`4446268` → `docs/V2_MASTERPLAN.md`): first-principles redesign. Thesis: *brand intelligence produces content; content performance grows intelligence.* Evidence store = the moat. 5-phase roadmap.
4. **V2 Phase 1 — Evidence persistence** (`20cc6b8`): migration 010 (research_runs, research_documents w/ pgvector-768 + HNSW + FTS + hash dedupe, grounded_on on topics/content/render_jobs, brands.profile_version/citations, match RPC); evidence.ts (chunker/fetcher/storeEvidence); gemini.ts Full variants surfacing grounding + token usage; worker persists homepage/subpages/search sources. **Embedding model = `gemini-embedding-001` @ outputDimensionality 768, L2-normalized** (text-embedding-004 404s on this key — verified).
5. **Phase 1.5 — Hardening** (`878a43f`): migration 011 (source_id grouping, language, content_items.topic_id, competitors.grounded_on, brand_intelligence_versions, GIN grounded_on indexes, hybrid RRF RPC); heading-preserving fetcher; Google-redirect domain repair; capture-time enrichment (summary/entities/keywords); intelligence snapshots.
6. **Phase 2A — Ask Research** (`ba47f22`): POST `/api/brands/[id]/ask` (embedQuery → hybrid RPC k=12 → strict-cite Gemini answer); AskResearch.tsx panel w/ [n] citation chips + source viewer. Stateless, no new tables.
7. **Phase 2B — Research Workspace** (`c30fd4e`): `/brands/[id]/research` page (Evidence Library grouped by source, Viewer w/ chunks+entities+related, Timeline from research_runs, Grounding Inspector); GET `/api/brands/[id]/evidence` (?source= | ?ids=); migration 012 (related_research_documents RPC).
8. **Phase 2C — Intelligence → Ideas** (`e27661b`): POST `/api/brands/[id]/opportunities` mines evidence through 4 lenses (pain_point/theme/competitor_gap/trend) → **grounded-only** brand_topics rows (source='evidence-mined') with per-idea grounded_on, composite confidence (0.45 model + 0.20 evidence + 0.15 freshness + 0.20 strategic), rationale; migration 013 (rationale + opportunity_kind); OpportunityFeed on brand page.
9. **Deployment audit** (caught that NOTHING had been pushed/migrated despite assumptions) → **deployment execution**: migrations applied via the user's authenticated Supabase dashboard (Monaco setValue + Run, confirmed Supabase's generic "destructive" warnings for DROP POLICY guards), push, Vercel/Railway verification, acceptance.

---

## 3 · Commits this session (all pushed)

```
e27661b feat(opportunities): Phase 2C — Intelligence -> Ideas
c30fd4e feat(research-workspace): Phase 2B — explore the evidence corpus
ba47f22 feat(ask-research): Phase 2A — grounded Q&A over the evidence store
878a43f feat(evidence): Phase 1.5 — intelligence-layer hardening
20cc6b8 feat(evidence): V2 Phase 1 — evidence persistence, vector memory, grounding
4446268 docs(product): V2.0 Brand Hub & Content OS masterplan
db80abe docs(product): full 13-phase product/UX/IA/workflow/technical audit
953d4a5 feat(video-variation): Phase 1B — archetype rotation + retry mutation + stock shuffle
(base: 1a8f1fa)
```

---

## 4 · New architecture quick-reference

- **Evidence flow:** brand research (worker) → fetchPageText (heading-preserving) + Gemini grounding metadata → `storeEvidence()` (chunk ~1.5k chars, sha256 dedupe per brand, embed via gemini-embedding-001@768, L2-normalized) → `research_documents`; run tracked in `research_runs` (tokens, cost, intelligence_version); profile snapshot → `brand_intelligence_versions`; coarse citations → `brands.profile_citations`.
- **Grounding chain:** research_documents → brand_topics.grounded_on → content_items/render_jobs.grounded_on (copied at insert; content_items also gets topic_id). GIN-indexed for "which artifacts cite this evidence".
- **Retrieval:** `search_research_documents_hybrid` (vector+FTS, RRF k=60) for Ask; `related_research_documents` for the workspace Related panel; `match_research_documents` (vector-only) available.
- **Key files:** `src/lib/evidence.ts`, `src/lib/gemini.ts` (Full variants, embedTexts/embedQuery, answerFromEvidence, mineOpportunities, extractEvidenceEnrichment), `worker/processors/brand-research.ts`, routes under `src/app/api/brands/[id]/{ask,evidence,opportunities}/`, `src/components/{AskResearch,OpportunityFeed}.tsx`, `src/app/brands/[id]/research/`.
- **Costs observed:** full research run ≈ $0.03 (4k in / 11.2k out tokens) + embeddings; opportunity scan similar order.

---

## 5 · Acceptance results (production, brand "Canva" `a40fc979-248a-48a3-a58e-37e94aa4a5e6`)

- research_runs: done, trigger=create, **113.6s**, 37 sources, 34 chunks, **34/34 embedded**, 4.0k/11.2k tokens, **$0.03**, intelligence **v1**
- Evidence library: 34 Google Search sources with **real domains** (redirect-repair verified); canva.com blocked direct fetch → graceful "relying on Gemini URL context" path logged + run succeeded
- Ask Research: "What differentiates us from competitors?" → dense answer, **10 cited · 2 also retrieved**, every claim chipped
- Grounding: **40/40** topics grounded
- Opportunity mining: **10 grounded opportunities from 34 sources** — top card score 100 (Competitor gap), rationale citing specific evidence, 6-source drill-in, Post/Video deep links

**Known artifact:** brand "Buffer" (`7158bb3b-…`) was researched while Railway was still swapping workers → ran on OLD worker → 0 evidence, 40 ungrounded topics (display: "no grounding (pre-evidence)"). Same for all older brands (Cardinal Data Sphere, OTTOFLOW.AI, Linear, Notion). **They gain evidence only when re-researched** (no re-research button exists yet — create-new or future facet-refresh).

---

## 6 · Open bugs / debt (pre-existing, NOT fixed this session)

| Item | Where | Notes |
|---|---|---|
| React hydration error #418 on every page | `src/app/page.tsx:56` (date) + relative times | Server/client date mismatch; self-heals but logs every load |
| Mock "Output Types" numbers (14/12/8/5/2) | `src/app/video/VideoPageClient.tsx:44` | Hardcoded fake data on /video |
| Analytics "Content vs Video Output" chart flat-zero | analytics page | Series not populated while KPIs are |
| Video render 0% on new pipeline | Railway 1 GB cap | Fix = RAM bump (see §1) |
| `scripts/create-sentry-alert-rules.ts` tsc error | untracked straggler | NOT in git, harmless to deploys, DO NOT fix/commit |
| Supabase Realtime unreliable | content tables | Polling fallbacks in place |
| Clerk DEV keys in prod | env | Pre-launch must-fix |

---

## 7 · What's next (per V2_MASTERPLAN roadmap)

1. **Operator:** Railway Hobby upgrade ($0.45 left!) → RAM 2 GB → one `/video/generate` closes the render saga.
2. **Phase 1 leftovers:** kill Projects nav stub, mock Output Types, hydration bug, raw stderr render errors; prod Clerk keys; **submit LinkedIn/Meta platform-API applications** (weeks of lead time — gate the Publisher).
3. **Phase 2 (loop closes):** review queue + artifact lifecycle states → Publisher (X API + manual-publish fallback) → Brand Hub IA (8 tabs, Content+Videos merged) → single Create flow → Plan tab/scheduling.
4. Video UX: script/storyboard approval steps (pipeline phases already exist separately).
5. Re-enable crossfades after RAM bump (concat → buildXfadeArgv).

---

## 8 · Constraints (standing)

- Commits: author josephottoflow + `Co-Authored-By: Claude <model> <noreply@anthropic.com>`; conventional commits; heredoc messages; never `--no-verify`.
- **Never `git add -u` / `git add .`** — stage explicit paths (stragglers protection).
- DO-NOT-COMMIT stragglers: `docs/BETA_READINESS_SPRINT.md`, `docs/LAUNCH_CHECKLIST.md` (modified), untracked `docs/PHASE_1A_*`, `docs/SESSION_*` (incl. THIS file), `scripts/create-sentry-alert-rules.ts`, `scripts/phase-1a-variation-test.ts`, `scripts/*.local.*`.
- Push policy: explicit ask (this session's deployment directive authorized the push that happened).
- Branch model: work on `feat/ffmpeg-multi-agent-pipeline`, fast-forward `main` on push (`git push origin HEAD:main`); Vercel prod + Railway deploy from main.
- Local `next build` fails at env collection (expected — Vercel has env). `npx tsc --noEmit` + `npm run build:worker` are the local gates (filter the straggler error).
- Migrations: apply in Supabase dashboard SQL editor BEFORE pushing dependent code. All migrations must be idempotent.

---

## 9 · Key references

| | |
|---|---|
| Live app | https://ottoflow-ai.vercel.app |
| GitHub | https://github.com/josephottoflow/ottoflow-ai (branch + main @ e27661b) |
| Vercel | project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`, team `team_MrIWWj7J9L2KLG58IRFcnDK7` |
| Railway | project `6f03b33a-9433-4e21-bdbc-1c47525dd5a1` ("content-friendship"), worker service `1170f8dd-d50d-4b6d-9019-a31798890fca` |
| Supabase | `ddozknywcdpyfdokmfrp` (ottoflow-staging — serves prod traffic; no separate prod DB) |
| Test brands | Canva `a40fc979-248a-48a3-a58e-37e94aa4a5e6` (evidence-rich), Buffer `7158bb3b-154d-433c-a6b6-ed14b3d24f71` (pre-evidence artifact) |
| Docs | `docs/PRODUCT_AUDIT_2026-06.md`, `docs/V2_MASTERPLAN.md`, `docs/ADR-002-ffmpeg-multi-agent-pipeline.md` |
| Local harnesses (gitignored) | `scripts/phase-1b-validation.local.ts`, `scripts/chunker-test.local.ts`, `scripts/list-models.local.ts` |
| Root .env | `D:\tiktok-product-video-factory\.env` (GOOGLE_API_KEY etc. for local scripts) |

---

## 10 · Resume checklist for next session

1. Read this file.
2. `git fetch && git status -sb` — expect `feat/ffmpeg-multi-agent-pipeline` in sync with origin at `e27661b` (+ only §8 stragglers dirty).
3. **Ask: "Did you upgrade Railway to Hobby?"**
   - Yes → bump worker RAM to 2 GB → run one `/video/generate` → expect `compose 55 → qc 65 → upload 90 → done 100` + `merged_video_url` = pub-….r2.dev → render saga CLOSED → re-enable crossfades.
   - No → warn about the $0.45 worker-death countdown again; continue Phase-1-leftover code work (no infra dependency): Projects stub removal, mock data, hydration fix, error translation.
4. Verify intelligence layer still healthy: open Canva brand → ask a question (citations?) → workspace timeline shows the run.
5. Next build item if no operator input: masterplan Phase 1 leftovers (§7.2), then review-queue groundwork (§7.3).
