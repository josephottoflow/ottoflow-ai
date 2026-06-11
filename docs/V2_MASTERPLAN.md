# OTTOFLOW V2.0 — BRAND HUB & CONTENT OPERATING SYSTEM MASTERPLAN

**Date:** 2026-06-12
**Status:** Design document — first-principles redesign, not an iteration plan
**Companion:** `PRODUCT_AUDIT_2026-06.md` (the as-is teardown; this is the to-be)

Rules followed here: nothing is preserved out of sentimentality; every layer earns its place; "AI-powered" claims are backed by a named mechanism or cut.

---

## 1 · EXECUTIVE SUMMARY

V2.0 reorganizes OttoFlow around one sentence:

> **A brand's accumulated intelligence produces its content, and its content's performance grows its intelligence.**

The product stops being five tools (research, ideas, posts, video, analytics) and becomes **one loop with one center (the Brand) and one verb (Create)**. Three structural bets:

1. **The Brand Hub is the product.** Everything a brand knows, plans, makes, and learns lives in one place. Global pages are *views*, not owners.
2. **The Evidence Store is the moat.** Every research action persists raw, cited, embedded evidence. Competitors generate from a prompt; OttoFlow generates from a living corpus. This is the single architectural decision that makes "OS" true.
3. **Publishing closes the loop or there is no loop.** Without publish → metrics → memory, "optimization layer" is marketing copy. Publishing is the keystone of V2.0, sequenced before all new creation features.

The 8 layers in the vision map onto exactly 4 storage systems and 9 agents (§8, §9) — anything that doesn't reduce to those is vapor and was cut.

---

## 2 · PRODUCT POSITIONING & COMPETITIVE ADVANTAGE

### The landscape in one table

| Player | What they own | What they lack (OttoFlow's opening) |
|---|---|---|
| Jasper, Copy.ai | Generation + brand voice docs | Voice is *user-typed*, not researched; no distribution; no performance loop |
| Buffer, Hootsuite, Sprout | Scheduling + analytics | Zero creation intelligence; content arrives by magic; analytics never feed creation |
| HubSpot | Full suite + CRM gravity | Enterprise-heavy, expensive, AI bolted on; SMB/agency overserved |
| Notion / Airtable | Flexible workspaces | Everything is manual; "content calendar template" ≠ system |
| Clay | Research→action automation (for sales) | Proof the pattern wins; nobody has done it for content |
| Perplexity | Research UX gold standard | Research terminates at an answer, not an artifact |
| Canva | Visual creation + templates | Strategy-blind; brand kit is fonts/colors, not intelligence |
| Descript | Video editing | Editing ≠ producing; no strategy or distribution |
| ChatGPT | Everything, generically | No persistent brand corpus, no schedule, no accountability |

### The positioning

**"The content team that does its homework."** Every competitor either *creates without knowing* (Jasper, Canva, ChatGPT) or *distributes without creating* (Buffer, Hootsuite). Nobody owns the chain **researched-truth → on-brand artifact → published post → measured result → smarter next artifact**. That chain is OttoFlow.

### Defensibility ranking (honest)

1. **Compounding brand corpus** (evidence + performance memory) — switching cost grows weekly; genuinely hard to copy because it requires the full loop.
2. **Multi-brand operations** — agencies; already architecturally native.
3. Closed-loop optimization — copyable in principle, but only by someone who owns the chain.
4. The video pipeline — table stakes within 18 months; treat as accelerant, not moat.

### Primary wedge customer

The **3–15 brand agency/fractional CMO** (P2 from the audit). They pay $50–200/brand/month today across 3 tools, they feel multi-brand pain daily, and they churn off Buffer because content creation is still on them. Solo founders (P1) are the self-serve top of funnel; verticals (real estate) are GTM campaigns, not product forks.

---

## 3 · INFORMATION ARCHITECTURE (Design Challenge #3)

### Verdict on the assumed nav (Home/Brands/Create/Library/Performance/Settings)

Almost right, two corrections:

1. **Library and Performance do not deserve top-level slots in v2.0.** For the solo user they duplicate Brand Hub tabs; for agencies they're *cross-brand views* — useful, but secondary. Promoting them to top level re-creates the "artifacts orphaned from brands" disease. They become collapsed "Workspace views" entries, or are reached from Home.
2. **Calendar earns the slot instead.** Cadence ("what goes out this week, across my brands?") is the operating rhythm of an *operating system*. The OS's home for time is the Calendar; the OS's home for attention is Home.

### Desktop navigation (final)

```
┌─ SIDEBAR (workspace scope, 64px collapsed / 220px expanded) ─┐
│  ⌘K  Search & commands                                       │
│                                                              │
│  🏠 Home          ← attention: action queue + digest         │
│  ✨ Create        ← the verb (also: global "+" button, ⌘N)   │
│  🏢 Brands        ← the nouns (list → Brand Hub)             │
│  📅 Calendar      ← time: cross-brand schedule               │
│                                                              │
│  WORKSPACE ▾ (collapsed group)                               │
│   📚 Library      ← all artifacts, every brand               │
│   📈 Performance  ← cross-brand analytics                    │
│                                                              │
│  footer: Settings · Billing · Help · user                    │
└──────────────────────────────────────────────────────────────┘
```

### Brand navigation (the second-level nav that matters most)

Persistent **brand switcher** in the top bar once inside any brand context (agency users live here). Brand Hub tabs: see §4.

### Contextual navigation

- Every artifact (post, video) renders with a **context ribbon**: Brand › Idea › Artifact — each crumb clickable. The lineage IS the navigation. This single pattern kills the "where did this come from / where does it live" confusion permanently.
- Every idea card carries its evidence citations (→ Research tab, filtered).

### Mobile navigation

Bottom tab bar: **Home · Calendar · ➕ Create (center, raised) · Brands · More**. Review/approve flows are mobile-first priorities (approving on the train is the #1 agency mobile job); creation is mobile-capable but desktop-optimized.

### Global search & command palette (⌘K — one surface, two modes)

- **Type text** → unified search: artifacts, ideas, brands, *and evidence chunks* (FTS + vector, RRF-merged). Searching "pricing objection" finds the competitor page snippet AND the post you wrote about it. Searchable evidence is a differentiator — surface it prominently.
- **Type ">"** → commands: "Create LinkedIn post for {brand}", "Refresh research on {brand}", "Approve pending (3)", "Go to {brand} › Ideas". Every agent action is a command. Power users (agencies) never touch the sidebar.

### Quick actions

Home cards are verbs (§4 Overview). The global "+" mirrors Create's type picker. Per-idea cards: "→ Post / → Video / → Both". Per-artifact: "Duplicate for {other platform}", "Remix with new angle".

---

## 4 · BRAND HUB (Design Challenge #1)

### Verdict on the proposed sections

Proposed: Overview, Intelligence, Research, Ideas, Content, Videos, Performance, Settings.
**Correction: merge Content + Videos into one "Content" tab** (filterable by format). Reasons: campaigns mix formats; the artifact lifecycle (draft→approved→scheduled→published) is identical regardless of format; two tabs re-create the V1 "two pipelines" schism inside the hub. **Add "Plan"** (the brand's calendar + cadence) — a brand without a time dimension is a folder, not an operation.

Final: **Overview · Intelligence · Research · Ideas · Plan · Content · Performance · Settings**

---

### 4.1 Overview — *the brand's pulse*

- **Purpose:** answer "is this brand okay and what does it need from me?" in 5 seconds.
- **User goals:** triage, jump to work, show a client the state of play.
- **Key actions:** approve pending items, fix failures, fill empty calendar slots, jump to any tab.
- **Data:** aggregates only — nothing stored here.
- **AI:** the **Brief** — 2 sentences, regenerated daily: "3 posts scheduled this week, video render ready for review. Educational posts are outperforming promo 3:1 — consider reweighting (→ accept)."
- **Layout (wireframe):** Top: brand identity strip (logo, voice one-liner, health dots: research-freshness · cadence · connections). Middle-left: Action queue (cards with verbs, max 5). Middle-right: This week mini-calendar. Bottom: recent artifacts rail (horizontal scroll, status-badged).

### 4.2 Intelligence — *what the brand knows about itself*

- **Purpose:** the structured, versioned brand brain — the contract every agent writes against.
- **User goals:** verify "it gets my brand," correct it once, trust it forever.
- **Key actions:** edit any field (versioned), approve AI-proposed updates, manage banned/required vocabulary, view "what changed and why."
- **Data:** `brand_intelligence` (versioned JSONB): positioning, voice (tone axes + exemplar sentences + banned list), audience segments (pains, objections, watering holes), pillars (with weights), competitors (refs to Research), hook bank, offer/CTA inventory.
- **AI:** synthesized from evidence with **citations per field** (click voice → see the 6 source pages); Optimizer proposes diffs ("12 published posts later: your audience engages with contrarian openers — add to voice? [accept/reject]"). *Never silently self-edits.*
- **Layout:** sectioned document with edit-in-place; every section header shows source count + last-updated; right rail = version timeline with diffs.

### 4.3 Research — *what the brand knows about the world*

- **Purpose:** the evidence library + research console. The moat's front door (full system: §6).
- **User goals:** see what the AI knows, fill gaps, ask questions, keep it fresh.
- **Key actions:** ask-the-research (chat with citations), refresh a facet, add a source manually (URL drop), track a competitor, review the gap report.
- **Data:** `research_documents` + `research_runs` (§9).
- **AI:** collectors per source type; RAG chat; weekly freshness digest; gap detection (pillar × evidence-coverage matrix).
- **Layout:** left = source-type filter rail (Website · Competitors · Industry · Keywords · Social · News, each with count + freshness dot). Center = evidence cards (snippet, source favicon, captured-at, "used in N artifacts"). **Top = the killer element: a persistent "Ask anything about this market…" input** — Perplexity-grade UX, scoped to this brand's corpus, answers carry citation chips that link to evidence cards.

### 4.4 Ideas — *the pipeline of angles*

- **Purpose:** scored, statused inventory of things worth saying. The bridge between research and creation.
- **User goals:** always have something worth posting; kill stale angles; see what's working.
- **Key actions:** generate more (gap-aware), edit/add manually, archive, set status, **"→ Post / → Video / → Both"**, sort by score.
- **Data:** `brand_topics` + score, status (fresh/queued/used/evergreen/archived), source_evidence_ids, performance rollup of descendant artifacts.
- **AI:** ideation agent pulls from evidence gaps + trend collectors + performance priors; score = f(pillar weight, evidence strength, category performance, recency-of-use). Each idea shows *why*: "rising search interest + competitor silence" with citations.
- **Layout:** kanban-ish columns by status OR scored list (toggle); idea card = title, hook angle, category chip, score, citation count, descendants count, the two create buttons.

### 4.5 Plan — *the brand's time*

- **Purpose:** cadence settings + this brand's calendar.
- **User goals:** "3 posts + 1 video per week without me thinking about it."
- **Key actions:** set cadence + mix; drag artifacts onto slots; approve the week's auto-plan; see holes.
- **Data:** `cadence_plans` (per-brand config), `schedule_slots` (slot → artifact binding).
- **AI:** Strategist fills empty slots from Ideas (drafts a plan, human approves the week in one click); detects holes and over-concentration ("4 promos in a row").
- **Layout:** week/month calendar; unfilled slots are dashed cards with "auto-fill from Ideas"; weekly "Approve plan" banner when a proposed week awaits.

### 4.6 Content — *everything the brand made* (posts AND videos)

- **Purpose:** single artifact library with the lifecycle as the organizing principle.
- **User goals:** find anything; move things through review; reuse winners.
- **Key actions:** filter (format/platform/status/idea); open in editor; approve/reject; schedule; duplicate-for-platform; "remix" (winner → new variant).
- **Data:** `content_items` (now format-generic, §9) + `render_jobs` linked as the video-production detail of a video-format item.
- **AI:** voice-check score per artifact; auto-tagging; remix suggestions on top performers.
- **Layout:** status board (Draft / In review / Approved / Scheduled / Published) as default view; grid + table alternates; video items show thumbnail + render state inline (no separate video ghetto).

### 4.7 Performance — *what worked*

Per-brand analytics: see §7 (analytics system); identical components scoped to one brand, plus the brand's recommendation feed.

### 4.8 Settings — *the brand's wiring*

Channel connections (OAuth per platform + health), publishing defaults (timezones, UTM rules, hashtag policy), guardrails (approval-required toggle per platform, banned topics), members/permissions (v2.5), danger zone.

---

## 5 · CREATE WORKFLOW (Design Challenge #2)

### Decisions

- **Yes, a dedicated Create surface** — but it's a *flow*, not a destination page users hang out on. It's reachable from: sidebar, ⌘N, global "+", every idea card, every empty calendar slot, every "remix" button. **Most Create sessions should start pre-contextualized** (from an idea or a slot); the blank Create page is the fallback, not the norm.
- **Create is the #2 nav item** (after Home). It is the verb of the product.
- **Content types are a template registry, not hardcoded pipelines.** One creation engine; types differ by output schema + prompt template + (optionally) production pipeline.

### Content type registry (launch set)

| Type | Engine | Notes |
|---|---|---|
| LinkedIn post / X post / Facebook post / IG caption | Writer | exist today |
| Thread (X) / Carousel (LinkedIn, IG) | Writer (multi-part schema) | new schema, same engine — cheap, high demand |
| Short video (TikTok/Reels/Shorts) | Video Producer | exists (12-agent) |
| Blog article / Newsletter | Writer (long-form schema) | exist roughly today (blog/email) |
| **Campaign** | Composer | **an idea fanned into N coordinated artifacts** (e.g. video + LinkedIn + X thread + newsletter mention) with one shared angle and staggered schedule. The agency killer feature. v2.1 — registry must anticipate it from day one |
| Case study | Writer + interview-style intake | v2.2; needs user-provided facts |

### The flow (target: idea → scheduled in under 90 seconds)

```
[Entry]   from idea card: brand+idea+research PRE-FILLED → start at step 3
          from blank ⌘N: step 1
1 BRAND    sticky (remembers last; agencies: switcher with avatars)
2 TYPE     visual grid of type cards w/ platform previews (multi-select
           = instant micro-campaign)
3 ANGLE    idea picker (scored, searchable) OR free prompt; research
           context badge shows what corpus will ground it ("47 sources ·
           refreshed 2d ago"); optional: extra direction, tone nudge
4 GENERATE side-by-side platform cards stream in; each: edit-in-place /
           regenerate-this / voice-score chip; video type → script review →
           storyboard review → render (staged commitment, per audit)
5 REVIEW   one Approve action per artifact (or "Approve all")
6 SHIP     Schedule (suggested slots from Plan) / Publish now / Save draft
           → success state shows WHERE it landed: "Scheduled Thu 9:15am ·
           view in Plan" — never ends at a dead list
```

Critical UX laws: never more than **3 decisions** before generation starts (brand, type, angle — everything else optional); generation streams (no spinner-walls); every step shows its grounding (which research, which voice version); exit always lands the artifact in a lifecycle, never in a void.

---

## 6 · RESEARCH AS THE MOAT (Design Challenge #4)

### Architecture principle

**One evidence store, many collectors.** Every research mode is a collector that normalizes into the same `research_documents` schema. Adding a source type = adding a collector, never a new storage system or UI. This is what makes the roadmap cheap.

### Collector specs

| Collector | Data collected | Cadence | Phase |
|---|---|---|---|
| **Website** | homepage + key pages: positioning copy, offers, testimonials, pricing signals | on create + monthly | live (fix: persist evidence) |
| **Competitor** | their pages, posting themes, hooks used, frequency, gaps | weekly per tracked competitor | P3 |
| **Industry/News** | news mentions, funding, regulation, narrative shifts | weekly | P3 |
| **Keyword** | volume, difficulty, rising queries per pillar (DataForSEO) | monthly | P3 |
| **Trend** | platform-trending formats/sounds/topics in the niche | weekly | P4 |
| **Reddit** | top posts + pain-language in relevant subs (audience voice verbatim) | weekly | P4 |
| **YouTube** | top videos per pillar: titles, hooks, comment themes | weekly | P4 |
| **Social listening** | brand + competitor mentions | continuous | P5 |
| **Audience** | synthesized FROM the above (Reddit language, YT comments, post engagement) — not a separate crawler | derived | P4 |

Each `research_document`: `source_type, url, title, raw_excerpt (chunked), embedding, captured_at, freshness_ttl, brand_id, run_id, citations_count`.

### How users interact (three surfaces, no more)

1. **Evidence library** (Brand Hub › Research): browse, filter, manually add URL, delete bad evidence (a delete is a *negative signal* the synthesizer respects).
2. **Ask-the-research**: scoped RAG chat with citation chips. Also exposed to the Writer: "ground this post in: [auto-retrieved evidence, editable list]".
3. **Digests**: weekly "what changed in your market" email/Home card — research becomes a heartbeat, not an event.

### How AI uses it later

Every generation call retrieves top-k evidence (hybrid: vector + FTS + recency + source-type weights per task — competitor evidence weighs high for differentiation posts, Reddit high for pain-point hooks). Retrieved chunk IDs are **stored on the artifact** (`grounded_on`) — enabling the trust UI ("based on 4 sources") and, later, *performance attribution to evidence* ("posts grounded in Reddit pain-language outperform by 2.1×" — nobody else can say that sentence).

---

## 7 · MEMORY SYSTEM (Design Challenge #5) & ANALYTICS/OPTIMIZATION (Design Challenge #7)

### The six memories — and their actual storage (no mystical "memory layer")

| Memory | Lives in | Updated by | Influences |
|---|---|---|---|
| Brand | `brand_intelligence` (versioned) | synthesis + approved Optimizer diffs | every prompt (system context) |
| Research | `research_documents` (pgvector) | collectors | retrieval per generation |
| Content | `content_items` + embeddings | every generation | anti-repetition ("avoid recent" = top-k similar past artifacts injected as negative examples — generalizes audit P2.4); remix sourcing |
| Performance | `performance_snapshots` + rollups on topics/artifacts | Analyst (nightly) | idea scores, hook bank, slot timing |
| Audience | section of `brand_intelligence`, citing evidence | synthesis from Reddit/YT/comments + engagement patterns | personas in prompts, hook selection |
| Competitive | `research_documents(source_type=competitor)` + tracked-competitor rollups | Competitor collector | gap analysis → ideation; differentiation framing |

**Update rule:** raw memories (evidence, snapshots) update automatically; *interpretive* memory (`brand_intelligence`) updates only through approved proposals. This is the line between "it learns" and "it drifts."

### Is pgvector enough?

**Yes, decisively.** Volume per brand: ~10³–10⁴ chunks; even 1,000 brands ≈ 10⁷ rows — comfortable for pgvector + HNSW on a midsize instance. You keep RLS (evidence is tenant data — isolation matters more than ANN benchmarks), SQL joins (evidence ↔ topics ↔ artifacts ↔ performance is *relational* gold), one backup/ops story. Revisit only at ~10⁸ vectors or if cross-tenant semantic features emerge. A dedicated vector DB now would be résumé-driven architecture.

### RAG strategy (complete)

- **Chunking:** semantic-ish, 200–400 tokens, headline+body kept together; metadata-rich (source_type, captured_at, pillar tags).
- **Embeddings:** Gemini embedding API (one vendor; embed on write via queue job).
- **Retrieval:** hybrid — pgvector cosine + Postgres FTS, RRF merge, then re-rank by task-specific source weights + freshness decay. k=8 for writing, k=20 for synthesis, k=12 for chat.
- **Context discipline:** per-agent context budget; intelligence summary always included (small, structured), evidence retrieved (variable), recent-artifact negatives (small). No agent gets "everything."
- **Citations:** retrieval IDs persist on outputs (`grounded_on uuid[]`). Non-negotiable — it powers trust UI, attribution analytics, and debugging.
- **Eval:** golden-question set per brand domain checked on synthesis changes; "citation precision" (does the chunk actually support the claim) sampled via LLM-judge weekly.

### Analytics: what matters

Users (agencies especially) care about exactly four questions: **Is it going out? Is it working? What's working best? What should change?** → four surfaces:

1. **Cadence health** (planned vs published, per brand) — retention metric #1, nobody else leads with it.
2. **Per-artifact performance** (impressions, engagement rate, clicks, follows) with platform-native nuance hidden behind a normalized "performance index."
3. **Pattern explorer:** performance by pillar, category, format, hook archetype, posting slot, *and grounding source type* (unique).
4. **Recommendation feed** (the Optimizer's output — every insight has an [Apply] button: reweight pillars, retire angle, shift slots, refresh research).

### The optimization loop (concrete, v1)

```
nightly: Analyst pulls platform metrics for published artifacts (t+1d, t+3d, t+7d snapshots)
  → performance_snapshots
  → rollups: topic.score, hook_bank ranking, slot-timing priors, pillar priors
weekly: Optimizer reads rollups + evidence freshness
  → writes recommendations (typed, parameterized, one-click applicable)
  → Home + brand Overview surface them; human applies/dismisses
  → applied recs mutate: cadence mix, idea scores, intelligence diffs (versioned)
```

Each piece is a cron job + a scoring function + a card component. No ML infra. "Continuously improves" becomes literally true in ~3 engineer-weeks *once publishing exists*.

---

## 8 · PUBLISHING SYSTEM (Design Challenge #6)

### The flow

```
artifact: draft → in_review → approved → scheduled → publishing → published
                                  ↘ rejected (w/ comment → regenerate seeded with comment)
                                                      ↘ failed (retryable, alerting)
```

- **Review:** status board in Content tab + cross-brand review queue on Home; inline edit during review; rejection comments feed regeneration (cheap RLHF-lite). Per-brand guardrail: auto-approve toggle per platform (solo users), approval-required (agencies/clients).
- **Approval roles:** v2.0 single-user = self-approval (still valuable as a deliberate gate); v2.5 adds reviewer role + client share-links (read+approve only — agencies report this closes deals).
- **Scheduling:** `schedule_slots` from Plan; suggested-time = platform priors now, learned per-brand timing later. Queue-per-brand with collision spacing.
- **Publish executor:** BullMQ `publish` queue; idempotency key per (artifact, platform, slot) — **double-posting is the product's scariest failure**; token-refresh handling; retry w/ backoff; permanent-fail → Home alert + one-tap "copy & mark published manually."

### Platform sequencing (MVP honesty)

| Platform | API reality | Phase |
|---|---|---|
| **X** | API paid tier, approval fast | **MVP** |
| **LinkedIn** | Community Mgmt API approval: weeks — **apply day 1** | **MVP** |
| Facebook/Instagram | Meta app review (pages/IG content publish) — weeks, finicky | P3 |
| TikTok | Content Posting API approval + audit | P3–P4 |
| YouTube (Shorts) | API fine; quota approvals | P4 |
| **Manual-publish fallback** | none needed | **MVP, day 1** |

The **manual fallback is strategic, not a stopgap**: "Copy/download → mark as published (+ optional permalink)" gives every platform a lifecycle TODAY, lets analytics ingest by permalink where possible, and decouples the loop's value from Meta's review queue. Ship it with MVP.

---

## 9 · AI AGENTS & DATABASE (Design Challenges #8 + #9)

### Agent roster (final)

| Agent | Responsibility | Inputs | Outputs | Memory access | Tools |
|---|---|---|---|---|---|
| Research Collectors (N) | gather evidence per source type | brand seed, schedules | research_documents | write: Research | fetchers, search APIs |
| Brand Intelligence | synthesize evidence → versioned profile; propose diffs | evidence, perf rollups | brand_intelligence versions | read: all · write: Brand (via approval) | LLM |
| Ideation | maintain scored idea pool | intelligence, evidence, gaps, perf priors | brand_topics | read: Brand, Research, Perf | LLM, retrieval |
| Strategist | cadence plan → proposed weekly schedule | cadence config, idea scores | schedule_slots (proposed) | read: Ideas, Perf | scheduler |
| Writer | idea → artifacts (all text formats incl. threads/carousels) | idea, intelligence, retrieved evidence, recent-negatives | content_items + grounded_on | read: Brand, Research, Content | LLM, retrieval |
| Video Producer | script→storyboard→footage→voice→music→captions→compose→QC (existing 12 sub-agents) | idea, intelligence, style | render artifacts | read: Brand, Research | full media stack |
| Publisher | schedule→post→record | approved artifacts, tokens | published records | read: Content · write: publish state | platform APIs |
| Analyst | ingest metrics, snapshot, roll up | published records | performance_snapshots, score updates | write: Performance | platform APIs |
| Optimizer | rollups → typed recommendations | snapshots, freshness, intelligence | recommendations | read: all · write: NOTHING directly | LLM |

**Collaboration pattern: blackboard.** Agents communicate exclusively through the database + queues (current pattern — keep). No agent-to-agent calls; every handoff is a row with a status, hence replayable, debuggable, and human-interruptible at every edge. **Data ownership:** each table has exactly one writing agent (above); humans override anything; interpretive memory writes require human approval.

### Schema concepts (deltas from V1 — actual shapes)

```sql
-- THE moat table
research_documents (id, brand_id, run_id, source_type enum, url, title,
  chunk_index, content text, embedding vector(768), captured_at,
  freshness_ttl, deleted_by_user bool)            -- + HNSW idx, FTS idx, RLS

research_runs (id, brand_id, trigger enum[create|refresh|scheduled|manual],
  facets text[], status, stats jsonb)

brand_intelligence_versions (id, brand_id, version int, profile jsonb,
  diff jsonb, source enum[synthesis|user_edit|optimizer], approved_by, created_at)

-- unify artifacts: ONE table, format-generic (videos keep render detail joined)
content_items (id, brand_id, topic_id, format enum[post|thread|carousel|video|
  blog|email], platform, body jsonb,             -- schema varies by format
  status enum[draft|in_review|approved|scheduled|publishing|published|rejected|failed],
  grounded_on uuid[], voice_score, embedding vector(768),
  render_job_id nullable, created_by enum[user|agent])

cadence_plans (brand_id, weekly_mix jsonb, timezone, auto_fill bool)
schedule_slots (id, brand_id, slot_at, content_item_id nullable,
  proposed_by enum[user|strategist], status)

channel_connections (id, brand_id, platform, account_ref, tokens encrypted,
  health enum, scopes)
published_records (id, content_item_id, platform, external_id, permalink,
  published_at, mode enum[api|manual], idempotency_key unique)

performance_snapshots (id, published_record_id, captured_at, horizon enum[d1|d3|d7|d30],
  impressions, engagements, clicks, follows, platform_raw jsonb)

recommendations (id, brand_id, type enum[reweight_pillars|retire_idea|shift_slots|
  refresh_research|intelligence_diff], params jsonb, evidence jsonb,
  status enum[proposed|applied|dismissed], created_by_run)
```

**Queues:** existing (`brand-research`, `content-generation`, `ffmpeg-compose`) + `embed`, `collect` (per-source fan-out), `publish` (idempotent), `ingest-metrics`, `optimize` (weekly). All BullMQ; the worker needs RAM headroom (≥2 GB) and, at scale, splits into `media-worker` (ffmpeg, RAM-heavy) vs `io-worker` (everything else) — a deploy split, not a rewrite.

**Caching/search:** RSC + revalidate-on-mutate; R2 behind custom domain + CDN; search = FTS + pgvector RRF (§3). **Orchestration:** no framework adoption (LangChain et al. add abstraction tax to an already-working blackboard); the in-house structured-call core (retries, entropy, schemas) is the right substrate — extract it into a shared `llm.ts` module used by web + worker.

---

## 10 · UX WIREFRAME SUMMARIES (Design Challenge #10.13)

- **Home:** "Good morning" + cross-brand action queue (approve 3 · fix 1 render · 2 empty slots Thursday · 1 recommendation) + weekly digest card + brand health strip (one row per brand: dots for cadence/research/connections). Zero KPI wallpaper.
- **Brand Hub:** identity header + 8 tabs (§4); every tab's empty state is a CTA into the loop ("No evidence yet → Run research").
- **Create:** full-screen focused flow (sidebar collapses); left rail = context (brand, idea, grounding badge); main = step content; streaming generation into platform-preview cards (LinkedIn card looks like LinkedIn).
- **Review queue:** swipeable cards (mobile-first): rendered platform-preview, voice chip, citations chip; Approve / Edit / Reject-with-comment.
- **Calendar:** week default; artifact chips colored by brand (workspace) or status (brand view); drag to reschedule; dashed auto-fill slots; "Approve week" banner.
- **⌘K:** single input; results grouped Artifacts / Ideas / Evidence / Commands; ">" prefix for commands.

---

## 11 · ROADMAP (Design Challenge #10.14)

Scoring: 🟥 launch-gating · value/revenue/retention noted · S/M/L complexity.

### Phase 1 — Launch blockers (≈1–2 weeks)
| Item | Why | Size |
|---|---|---|
| 🟥 Worker RAM 2GB + verified render + re-enable xfade | flagship feature at 0% success | S (operator + config) |
| 🟥 Persist research evidence (`research_documents` + embed queue) — **collect now even before UI** | every week of delay throws away moat data | M |
| 🟥 Kill: Projects nav, mock numbers, raw stderr errors, hydration bug, fake stage cards | trust | S |
| 🟥 Prod Clerk keys; artifact lifecycle states added to schema | foundation | S |
| 🟥 LinkedIn + Meta API applications submitted | weeks of lead time | S (paperwork) |

### Phase 2 — MVP launch: the loop closes (≈4–6 weeks)
Review queue + approval states → Publisher (X API + **manual-publish fallback for everything**) → LinkedIn API when approved → Brand Hub IA (8 tabs; Content unified) → single Create flow (3-decision rule) → basic Plan tab + scheduling → success states. *Retention impact: this phase IS retention; revenue: subscription becomes justifiable ("it posts for you").*

### Phase 3 — Growth: agencies + research surface (≈6–8 weeks)
Evidence library UI + ask-the-research → facet refresh + competitor tracker (weekly) → Meta publishing → threads/carousels (new schemas, same engine) → video script/storyboard approval steps → metrics ingest (API + permalink-scrape for manual) → pattern explorer v1 → client share-links + reviewer role (agency revenue) → ⌘K.

### Phase 4 — Intelligence layer (≈8 weeks)
Optimizer + recommendation feed → idea scoring loop live → keyword/trend/Reddit/YouTube collectors → audience memory synthesis → Campaign content type (fan-out composer) → voice rotation + video format packs → learned posting-time priors.

### Phase 5 — Autonomous Content OS
Auto-pilot per brand (Strategist plans → Writer/Producer create → auto-approve rules → Publisher ships → weekly human digest with diff-review) → grounding-source performance attribution → vertical packs (real estate first) → workspace teams/roles → white-label reporting → marketplace (voices, styles, templates).

### Sequencing logic (one paragraph, brutally)

Everything funds the loop: Phase 1 makes the product not-broken and starts hoarding evidence; Phase 2 closes generate→publish (without it OttoFlow is a toy with beautiful research); Phase 3 monetizes agencies (multi-brand + client approval = the revenue wedge) and opens the research moat to users; Phase 4 makes the "it learns" claim literally true; Phase 5 is the category claim — the OS that runs content with weekly human steering. Any feature that doesn't accelerate this chain (more generators, strategy-document engines, design tools) gets cut without ceremony.

---

*End of masterplan. The as-is evidence backing every "kill" decision is in PRODUCT_AUDIT_2026-06.md.*
