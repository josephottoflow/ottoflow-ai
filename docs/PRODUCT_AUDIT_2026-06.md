# OttoFlow AI — Complete Product, UX, IA, Workflow & Technical Audit

**Date:** 2026-06-12
**Auditor:** Claude (staff-level product/UX/AI-architecture review)
**Evidence base:** live walkthrough of every page + flow on https://ottoflow-ai.vercel.app (signed in, real data), full codebase access, production logs (Vercel + Railway), render history (41 generations), DB schema, ADR-001/002.

This is a brutally honest pre-launch review. Praise is rationed; problems are named.

---

## PHASE 1 — PRODUCT UNDERSTANDING

### What OttoFlow actually is (today, in production)

A **multi-brand AI content operations platform**: you point it at a company (name + website + industry), it researches the brand with Gemini + Google Search, builds a brand profile + ~40 content ideas, and turns any idea into (a) multi-platform social posts — **working end-to-end** — or (b) a short-form video via a 12-agent FFmpeg pipeline — **code-complete but blocked in prod by a 1 GB worker RAM cap**.

What it is *not* yet, despite the marketing line "The AI Content Operating System": there is no publishing, no scheduling, no analytics ingestion, no learning loop, no team features. Today it is an **AI content *generator* with brand memory**, not an operating system. That gap between title and reality is the central product risk.

### Target users (inferred from product + seeded data)

| Persona | Description | Evidence |
|---|---|---|
| **P1 — Solo founder / operator** | Runs 1–2 brands, no marketing hire, wants "content done" in minutes | The 3-input brand setup, "Three inputs. Ottoflow does the rest." |
| **P2 — Freelance SMM / micro-agency** | Manages 3–10 client brands, bills for content calendars | Multi-brand workspace is already the core data model |
| **P3 — Niche vertical operator (real estate)** | The OTTOFLOW.AI seed brand is literally "REAL ESTATE"; topic packs per vertical | 40 pre-generated real-estate topics |

P2 is the strongest wedge: multi-brand is already the architecture, and agencies pay monthly for exactly this. P1 is the activation persona. P3 is a go-to-market focus, not a separate product.

### Jobs-to-be-done

1. "Keep my (client's) social channels consistently active without me writing anything."
2. "Sound like *the brand*, not like ChatGPT."
3. "Turn one idea into every format (LinkedIn, X, IG, FB, blog, email, video) at once."
4. "Show my client/boss what was produced and that it's working."
5. (Latent) "Stop doing research in 14 browser tabs."

### Problem solved

Content production is the bottleneck, but *generic* AI content fails because it lacks brand context. OttoFlow's defensible move is the **research-grounded brand profile feeding every generation** — that part is real and working today.

### Product mission (proposed)

> Every brand gets a tireless AI content team: it researches, plans, writes, produces, publishes, and learns — the human approves.

### Success metrics

| Metric | Target | Why |
|---|---|---|
| Time-to-first-post (signup → generated post) | < 10 min | Activation; currently achievable (~3-4 min) — protect it |
| Idea → published conversion | > 25% | Measures whether output is *usable*, not just generated |
| Posts published per brand per week | ≥ 3 | The retention loop; **currently 0 — publishing doesn't exist** |
| Render success rate | > 95% | Currently ~24% lifetime (10/41), 0% on the new pipeline (RAM-blocked) |
| Brand profile edit rate | < 1 edit/brand | Proxy for research quality |
| Week-4 retention per brand | > 60% | An OS is used weekly or it isn't an OS |

### Core workflows (the only four that matter)

1. **Onboard a brand** → research → reviewable Brand Intelligence + idea pool.
2. **Produce** → idea → post(s) and/or video → review → approve.
3. **Publish** → scheduled/auto to platforms (MISSING).
4. **Learn** → performance → idea scoring + brand-voice refinement (MISSING).

---

## PHASE 2 — INFORMATION ARCHITECTURE AUDIT

### Current navigation (as shipped)

```
Sidebar
├─ Dashboard
├─ Brands
├─ Content Pipeline
├─ Video Pipeline
├─ Projects  [SOON]          ← dead stub in primary nav
├─ Analytics
├─ QUICK START
│  ├─ Research a Brand
│  ├─ Generate Video
│  └─ Generate Post
└─ Billing / Settings / Help  ← Billing & Settings are "Coming soon" stubs
```

### Current user journey (actual)

Dashboard → (Quick Start) Research a Brand → brand detail (profile + ideas) → per-idea "Generate post →" or "Generate video →" → generator page (brand + idea pre-selected) → output lands in /content library or /video history → **journey ends** (no publish, no schedule, nothing to do with the artifact except copy/download).

### What's actually good (credit where due)

- The **brand → idea → generate** spine exists and is correctly wired (idea pre-selection via deep links, use-counts incremented, topic folded into prompts). This is the right skeleton.
- Quick Start in the sidebar papers over the IA confusion reasonably well.
- The honest-state work ("Beta · render setup", real KPI counting) shows product integrity.

### Friction points, dead ends, redundancy (observed live)

| # | Issue | Severity |
|---|---|---|
| F1 | **"Pipeline" framing is producer-centric, not user-centric.** "Content Pipeline" and "Video Pipeline" describe *your* infrastructure. Users think in "create something" and "see what I made". Both pipeline pages are 70% decorative dashboard (fake-ish workflow stage cards, "Gemini Flash Lite" badges, API integration lists) wrapping a 30% useful library. | HIGH |
| F2 | **Projects is a dead stub in primary nav** — "SOON" badge, disabled New Project button, an empty-state card that invites a click that does nothing. A brand-new user's 5th nav item is a dead end. | HIGH |
| F3 | **Two parallel generators duplicate the same UX** (/content/generate and /video/generate both have brand picker + idea picker + options). Mental model: "two different products" instead of "one creation flow, two output types". | HIGH |
| F4 | **Artifacts are orphaned from brands in the IA.** Content library and video history are global pages filtered by brand chips; the brand detail page doesn't show "everything this brand produced". The brand should be the hub; today it's a launching pad only. | HIGH |
| F5 | **Workflow stage cards imply state that doesn't exist** ("Content Strategy ACTIVE", "Footage Search ACTIVE" shown statically). Decorative state machines erode trust the moment a user watches them not move. | MED |
| F6 | **Video history dumps raw ffmpeg stderr at the user** (multi-line `Parsed_ass_31 @ 0x7fd7c4051400` walls). Render failures must be translated ("Render failed — our fault, we're on it — Regenerate is free"). | MED |
| F7 | Dashboard "Render Queue" shows stale veo3-era items as "Done" that produced nothing. | MED |
| F8 | Mock numbers still live on /video ("Output Types": 14/12/8/5/2 — hardcoded in `VideoPageClient.tsx:44`). | MED |
| F9 | Analytics "Content vs Video Output" chart renders flat-zero against non-zero KPIs (series bug). | MED |
| F10 | React hydration error #418 on every page (server/client date mismatch, `page.tsx:56` + relative times); header showed "Thursday, June 11" after midnight on the 12th. | MED |
| F11 | "Pending Review 12" KPI exists, but there is no review/approval surface or workflow anywhere. A number that promises a feature. | MED |
| F12 | Credits are theater: "5.0K remaining", "0 used" after 12 generations + 41 video attempts. Either meter it or hide it. | LOW |
| F13 | No global search; no notifications behind the bell. | LOW |

### Missing pages/features

- **Publish/Schedule** (the single biggest hole — the loop has no exit)
- **Calendar** (content strategy is invisible; ideas have no time dimension)
- **Review queue** (approve/reject/edit before publish; the "Pending Review" KPI implies it)
- **Research workspace** (research evidence is generated then buried — see Phase 5)
- A real **brand hub** with all artifacts, intelligence, and settings per-brand

### Redesigned IA

```
TOP LEVEL (sidebar — workspace scope)
├─ 🏠 Home            (cross-brand: what needs my attention today)
├─ 🏢 Brands          (the heart: list → Brand Hub)
├─ ✨ Create          (ONE entry: choose brand → idea → output type(s))
├─ 📅 Calendar        (cross-brand schedule; v2)
├─ 📚 Library         (all artifacts, cross-brand, powerful filters)
├─ 📈 Performance     (cross-brand analytics)
└─ ⚙️ Settings / Billing / Help (footer)

BRAND HUB (tabs inside /brands/[id] — brand scope; THE primary surface)
├─ Overview      (health, recent output, next scheduled, quick actions)
├─ Intelligence  (profile, voice, audience, competitors — editable, versioned)
├─ Research      (evidence library, sources, refresh-research, gaps)
├─ Ideas         (the 40+ topic pool: score, status, archive, add manually)
├─ Content       (this brand's posts; status: draft→approved→scheduled→published)
├─ Videos        (this brand's videos + render states)
└─ Settings      (channels/connections, cadence, guardrails)
```

Kill from nav: "Content Pipeline", "Video Pipeline" (their libraries fold into Library + Brand Hub; their generators fold into Create), "Projects" (remove until it exists — see Phase 8).

**Mobile:** bottom tab bar = Home · Create (center, prominent) · Brands · Library · More. The existing drawer handles the rest.

**Ideal dashboard (Home):** not KPI wallpaper — an **action queue**: "3 posts awaiting review", "Render failed on X — regenerate?", "Brand Y has nothing scheduled this week", "Idea pool for Z is 80% used — refresh research?". Every card is a verb.

---

## PHASE 3 — USER JOURNEY ANALYSIS (new-user walkthrough)

**Signup → Dashboard.** Onboarding checklist exists (good). But the dashboard also shows 4 KPI zeros, two pipeline cards, an empty Recent Projects (dead feature), an empty activity feed — the checklist competes with noise. *Redesign: first-run dashboard IS the checklist, full-bleed, nothing else until brand #1 exists.*

**Brand setup (/brands/new).** Genuinely excellent: 3 fields, honest time expectation ("~60–90 seconds"), tells you what it does ("Gemini Flash + Google Search"). Best screen in the product. Missing: what happens *during* the 60–90s is a huge trust-building opportunity — stream the research live ("Reading homepage… found 3 competitors… detecting voice…"). The BrandDetailClient research log exists; surface it during creation, theatrically.

**Research review.** After research, the user is dropped into the brand page with a wall of generated profile + 40 ideas, no guided "review & confirm" step. The user never explicitly *blesses* the brand voice — so when content sounds off, they don't know where to fix it. *Add: a 60-second confirmation step (voice ✓, audience ✓, competitors ✓ — each editable) before the brand is "Ready".*

**Content generation.** Flow is good (brand → idea → platforms → extra direction). Friction: idea list is a flat unsorted dump of 40; no idea status (fresh/used/performing); generation results page relies on a 2.5s polling fallback because Realtime is unreliable — works, but progress feels vague. Missing: per-platform editing after generation, regenerate-one-platform, tone slider.

**Video generation.** The form is good (brand-driven, topic picker, style chips, scene count, music vibe, free-form escape hatch). The journey after submit is where it collapses: SSE planning phase is well-staged, then the async render fails (today: always, OOM) and the user gets raw stderr + a Regenerate button that will also fail. **Until renders succeed ≥95%, this flow should be invite/flagged-only** — it currently teaches new users the product is broken. (29 of this user's 41 attempts failed; that's the lived experience.)

**Analytics.** KPIs honest, chart broken (F9), and fundamentally there's nothing to analyze without publishing. It's a reporting page for an activity that ends in a copy-paste.

**Projects.** Dead stub (F2). Remove.

**Cross-cutting missing:** success states (post generated → confetti-moment + "Schedule it" CTA — currently the reward is… a list item), templates (every generation starts from scratch except idea), AI suggestions ("this idea would work great as a LinkedIn carousel"), progress persistence (leave mid-generation = lose the thread; there's no "jobs" surface except video history).

---

## PHASE 4 — BRAND → RESEARCH → CONTENT → VIDEO WORKFLOW (the core)

### Verdict on the proposed 10-step workflow

The proposed flow (Brand → Research → Intelligence → Research DB → Strategy → Content → Video → Publish → Analytics → Learn) is **directionally correct and ~40% built**. Corrections:

1. **Steps 3 & 4 are one step.** Brand Intelligence *is* the research database, structured. Don't build two stores; build one evidence store with a structured summary on top (see Phase 5/11).
2. **Step 5 (Strategy) should be lightweight, not a grand "strategy engine".** v1 strategy = a *cadence plan* ("3 posts + 1 video per week, mix: 60% educational / 25% social-proof / 15% promo") that auto-pulls from the idea pool onto a calendar. Resist building a strategy document generator nobody reads — note the prior sprint explicitly killed "Content Strategy Engine" scope; that instinct was right.
3. **Content and Video are siblings, not sequential** (6 & 7 in parallel from the same idea — already true in the data model; make the UI say it: "turn this idea into: ☑ posts ☑ video").
4. **Step 8 (Publish) is the missing keystone.** Everything before it is built; everything after it is impossible without it. It must come before any further generation features.
5. **Step 10 (Learn) needs a concrete v1**, not "AI learns": performance data → idea-pool scoring (boost categories that perform) + hook-bank ("avoid recent" P2.4 already designed in VIDEO_VARIATION_AUDIT).

### Ideal workflow diagram

```
            ┌─────────────────────────────────────────────────────────┐
            │                      LEARN LOOP                          │
            ▼                                                          │
[1] CREATE BRAND ──► [2] RESEARCH ──► [3] BRAND INTELLIGENCE          │
 (3 inputs)           (web, competitors,  (profile + voice +          │
                       industry, social)   evidence store)            │
                                              │                       │
                                              ▼                       │
                              [4] IDEA POOL (scored, statused)        │
                                              │                       │
                            ┌─────────────────┴───────────┐           │
                            ▼                             ▼           │
                   [5a] POSTS (multi-platform)   [5b] VIDEO (12-agent)│
                            └─────────────────┬───────────┘           │
                                              ▼                       │
                                   [6] REVIEW QUEUE (human gate)      │
                                              ▼                       │
                                   [7] SCHEDULE / PUBLISH             │
                                              ▼                       │
                                   [8] PERFORMANCE INGEST ────────────┘
                                        (per-post metrics → idea scores,
                                         hook bank, voice refinement)
```

### Data flow (how data should move)

```
brands ──1:1──► brand_intelligence (structured: voice, audience, pillars, competitors)
   │               ▲ summarized from
   ├──1:N──► research_documents (raw evidence: pages, SERPs, social posts; embedded → pgvector)
   ├──1:N──► brand_topics (ideas; + score, status, source_evidence_ids)
   │            ├──1:N──► content_items (posts; + platform, status, scheduled_at, published_post_id)
   │            └──1:N──► render_jobs (videos; + script, storyboard, merged_video_url)
   ├──1:N──► channel_connections (platform OAuth tokens)
   └──1:N──► performance_snapshots (per published artifact, time-series)
                   └──► feeds back into: brand_topics.score, brand_intelligence.hook_bank
```

Today: `brands`, `brand_topics`, `content_items`, `render_jobs`, `scene_generations` exist. Missing: `research_documents` (evidence is discarded after profile synthesis — the biggest data-architecture mistake, see Phase 5), `channel_connections`, `performance_snapshots`, scoring columns.

### AI agent flow — see Phase 10.

---

## PHASE 5 — RESEARCH EXPERIENCE

### Current state

Research is a **one-shot, opaque, lossy event**: Gemini + Google Search run for 60–90s at brand creation, produce a profile + topics, and the underlying evidence (what pages were read, what competitors were found, what was actually said) is **thrown away**. The user can't see sources, can't correct a wrong inference, can't ask follow-ups, can't refresh one facet. Research = a black box that fires once.

### The principle

**Stop discarding evidence.** Every research action should write `research_documents` rows (url, source_type, extracted_text, embedding, found_at). The profile becomes a *view over evidence* — citable ("voice: confident, technical — based on these 6 pages"), refreshable, correctable.

### What should exist (prioritized)

| Tier | Feature | Notes |
|---|---|---|
| **v1 (build now)** | Evidence library per brand | Show what research read; the trust feature |
| **v1** | Refresh research (whole or facet) | "Re-scan competitors" without recreating the brand |
| **v1** | Ask-the-research chat | RAG over evidence store; "what do competitors charge?" — this is the "research without leaving the platform" moment, and it's cheap once evidence is stored + embedded |
| **v2** | Competitor tracker | N competitors per brand, periodic re-scrape, "what they posted this week" digest |
| **v2** | Keyword/trend snapshot | Search volume + rising queries per pillar (DataForSEO or similar) |
| **v2** | Content gap analysis | Pillars × competitor coverage matrix → auto-feeds idea pool |
| **v3** | Social listening (Reddit, YouTube, news) | Each is just another `source_type` in the same evidence store — the architecture should anticipate them, not build them yet |
| **v3** | Scheduled research (weekly auto-refresh + digest) | Turns research from event → process |

**Anti-recommendation:** do NOT build a free-form "research workspace" (Notion-like canvas) — that's a different product. The research surface is: evidence library + chat + facet refresh, embedded in the Brand Hub.

---

## PHASE 6 — CONTENT GENERATION UX

### Current flow assessment

Inputs: brand (✓), idea (✓ optional), platforms (✓ with format hints — nice), extra direction (✓). Outputs: one post per platform, draft status, library. Quality controls: **none** — no voice-check, no edit-in-place, no regenerate-section, no approval gate that leads anywhere.

### Blank page vs research vs strategy vs templates?

**Answer: (B) research-first via the idea pool — which is what's built — upgraded with (C) strategy-as-cadence and (D) format templates as a *secondary* axis.** Blank-page (A) must remain as the escape hatch (it exists: "No idea — open-ended post").

The right mental model: **Idea (what to say — from research) × Format (how to say it — template) × Platform (where)**. Today format and platform are fused. Splitting them unlocks: "LinkedIn carousel", "X thread", "IG story sequence" without new pipelines — they're prompt templates.

### Ideal experience

1. **Entry**: from an idea card ("Create from this idea") or Create page. Brand+idea context always visible in a left rail.
2. **Generate**: per-platform cards stream in; each card has *Edit / Regenerate (this one) / Tone nudge (more bold ↔ safer)*.
3. **Review**: voice-match indicator ("matches brand voice: 92% — flagged: 'leverage' is on your banned list") — cheap with an LLM judge against the brand profile; massive perceived quality.
4. **Exit**: Approve → Schedule (or copy). Never end at a dead list item. The post's status lifecycle (`draft → approved → scheduled → published`) becomes the UI's organizing principle.

---

## PHASE 7 — VIDEO GENERATION UX

### Current assessment

The *form* is the strongest generator UI in the product (brand-driven topic picker, style chips, scenes, music vibe, free-form fallback, honest SSE staging capped at 90% with async render tracked separately — this honesty work was done well). The problems:

1. **It's a slot machine.** Submit → wait → whole video or (currently always) whole failure. No intermediate approval.
2. Raw ffmpeg stderr as user-facing error text (F6).
3. No script preview/edit before committing render minutes.
4. No voice choice (single ElevenLabs voice — P2.5 already planned), no clip swap, no caption style choice.
5. 12 overlays/9 overlays metadata shown, but nothing is editable.

### Redesign: render the *plan*, then the *pixels*

```
Step 1  IDEA + STYLE  (current form, fine)
Step 2  SCRIPT REVIEW    ← NEW, cheap (Gemini only, seconds)
        hook / body / cta shown, editable, "regenerate hook" button
        (the Phase-1B hook archetypes make this genuinely varied now)
Step 3  STORYBOARD REVIEW ← NEW (scene cards: clip thumbnail from stock
        search, caption text, duration; swap-clip button = re-query Pexels)
Step 4  RENDER (the expensive, currently-fragile part — by now the user
        has invested and approved, so a 2-min wait/failure-retry is tolerable)
Step 5  RESULT → caption pack (SEO copy exists already) → Schedule/Download
```

This converts the worst property of the current system (expensive opaque tail) into a staged commitment funnel, *and* steps 2–3 work today with zero new backend — script and storyboard are already separate pipeline phases. **Highest-leverage video UX change available.**

Asset management (uploaded logos, brand footage, product shots) is a v2 concern; one `brand_assets` bucket + picker in step 3. Publishing: same review-queue exit as posts.

**And the blunt truth:** none of this matters until the Railway worker gets 2 GB RAM. The pipeline is validated locally (QC 10/10, 72s renders); production OOMs at 1 GB on every attempt (41 jobs: 28 failed, 10 legacy-era, 0 new-pipeline successes). $5/month is blocking the flagship feature. Fix that before any roadmap item in this document.

---

## PHASE 8 — PROJECTS & ORGANIZATION

### Verdict: Projects, as conceived, should not exist.

The current hierarchy confusion: Projects is in nav (dead), the DB has a `projects` table wired to credits, but the real container users think in is the **Brand**. Adding "Projects" as a peer of Brands creates the classic two-container problem (does a video live in a project or a brand?).

### Correct hierarchy

```
Workspace (account; later: team)
└─ Brand (THE container: intelligence, research, ideas, artifacts, channels, analytics)
   └─ Campaign (OPTIONAL grouping WITHIN a brand; v2+: "Q3 launch",
      "Holiday push" — a label + date range + goal over ideas/artifacts,
      NOT a separate data silo)
```

- **Global (workspace):** billing, credits, members, integrations catalog, cross-brand Library/Calendar/Performance views (views, not owners).
- **Brand-owned:** everything content-related. Artifacts always belong to a brand.
- **Campaign:** a tag with dates, nothing more. Resist making it structural.

**Action now:** remove Projects from nav and repurpose the `projects` table later as `campaigns` (or drop it). Move credits to workspace level.

---

## PHASE 9 — ANALYTICS

### Current state

Honest-but-empty: production counts (12 content / 10 legacy videos), a broken chart (F9), credit theater (F12). There are no *performance* analytics because nothing is published through the platform. Analytics without publishing is a mirror facing a wall.

### Metrics that matter (in order)

1. **Per-post performance** (impressions, engagement rate, clicks — from platform APIs post-publishing)
2. **Per-brand cadence health** (planned vs published this week)
3. **Idea-category performance** (educational vs social-proof vs promo — feeds the learn loop)
4. **Hook performance** (video 3-sec retention proxy, post first-line engagement)
5. Production metrics (current page) — demoted to an ops corner

### The feedback loop (concrete v1)

```
nightly job: pull metrics for published artifacts (platform APIs)
  → write performance_snapshots
  → recompute brand_topics.score  (category & angle performance priors)
  → update brand_intelligence.hook_bank (top/bottom performers)
  → surface on Home: "Educational posts outperform promo 3:1 for OTTOFLOW.AI
     — want me to reweight next week's plan?"
```

That single sentence on the Home screen is the "OS that learns" promise made tangible. It requires: publishing (Phase 4 keystone), one ingest job, one scoring function. No ML infrastructure.

---

## PHASE 10 — AI AGENT ARCHITECTURE

### What exists (give the codebase its due)

The FFmpeg pipeline is already a real 12-agent orchestrator (script, scene-plan, footage, voice, music, captions, compose, QC, upload…) — ADR-002. Brand research, post-writer, SEO-caption, and topic-ideation agents exist as Gemini routes. The gap isn't "build agents" — it's **two missing agents and a shared memory layer**.

### Target roster

| Agent | Responsibilities | Inputs | Outputs | Depends on | Status |
|---|---|---|---|---|---|
| **Research** | Crawl site/SERPs/competitors; write evidence | brand seed (name/url/industry) | research_documents | Google Search, fetchers | ✅ exists (must stop discarding evidence) |
| **Brand Intelligence** | Synthesize evidence → profile, voice, audience, pillars; maintain hook bank & banned list | research_documents, performance feedback | brand_intelligence (versioned) | Research | ◐ exists (one-shot, unversioned) |
| **Ideation** | Maintain scored idea pool; gap-fill from evidence + trends | intelligence, evidence, performance scores | brand_topics | Research, Analytics | ✅ exists (no scoring/refresh) |
| **Strategist** | Cadence plan → calendar slots from idea pool | cadence config, idea scores | scheduled slots | Ideation | ❌ missing (v2) |
| **Writer** | Idea → per-platform posts; voice-check pass | idea, intelligence, format template | content_items | Intelligence | ✅ exists (add voice-judge) |
| **Video Producer** | Script → storyboard → footage → voice → music → captions → compose → QC | idea, intelligence, style | render_jobs + mp4 | Writer-adjacent, 12 sub-agents | ✅ exists (RAM-blocked) |
| **Publisher** | Schedule, post via platform APIs, retry, record IDs | approved artifacts, channel tokens | published_posts | Review gate | ❌ missing (keystone) |
| **Analyst** | Ingest metrics, snapshot, score | published_posts, platform APIs | performance_snapshots, topic scores | Publisher | ❌ missing |
| **Optimizer** | Close the loop: reweight ideas, refresh hooks, suggest cadence changes; *suggests, never silently acts* | snapshots, intelligence | recommendations (Home cards), score updates | Analyst | ❌ missing (v3) |

### Interaction rules

- Agents communicate **through the database, not through each other** (current BullMQ + tables pattern — keep it; it's debuggable and replayable).
- **Human gates** between generate→publish (review queue) and on any Optimizer change to brand intelligence. Auto-pilot mode can relax gates later, per-brand, opt-in.
- **Shared memory = Brand Intelligence + evidence store**, versioned. No agent keeps private long-term state. This is what makes output quality compound instead of reset per call.

---

## PHASE 11 — TECHNICAL ARCHITECTURE REVIEW

### Current stack assessment (it's mostly right — don't rewrite)

| Layer | Current | Verdict |
|---|---|---|
| Frontend | Next.js App Router, RSC + server actions, Tailwind, shadcn | ✅ Keep. State mgmt: server-first + polling fallback is fine; do NOT add Redux/Zustand wholesale |
| Auth | Clerk → Supabase third-party JWT | ✅ Keep. ⚠️ DEV keys in prod — fix before launch |
| DB | Supabase Postgres + RLS | ✅ Keep. RLS per-user already done — this is the multi-tenant foundation |
| Jobs | BullMQ + Redis on Railway worker | ✅ Keep. ⚠️ 1 GB RAM cap is THE production blocker |
| AI | Gemini 2.5 Flash structured-output everywhere | ✅ Right cost tier. Add a model-router later (escalate brand-intel synthesis to a stronger model) |
| Video | FFmpeg 12-agent (ADR-002), R2 storage | ✅ Sound. Re-enable xfade once RAM ≥2 GB |
| Realtime | Supabase Realtime (unreliable) + 2.5s polling | ✅ Pragmatic. Standardize the poller into one `useJobProgress` hook instead of per-page implementations |
| Monitoring | Sentry + UptimeRobot | ✅ |

### Concrete recommendations

1. **Vector/RAG: use pgvector inside Supabase.** Do not add Pinecone/Weaviate. Scale (thousands of docs/brand) is trivially within pgvector range; you keep RLS, one backup story, SQL joins between evidence and topics. `research_documents(embedding vector(768))` + IVFFlat index. Embeddings: Gemini embedding API.
2. **Memory architecture:** `brand_intelligence` as a *versioned* JSONB row (append-only versions table) — agents read latest, Optimizer proposes diffs, human approves. The hook-bank and banned-list live here. This plus evidence-RAG **is** the memory layer; no exotic memory framework needed.
3. **Search:** Postgres FTS (tsvector) over artifacts + evidence for the global search box; pgvector for semantic ask-the-research. Both in one query via RRF if wanted later.
4. **Folder structure:** current `src/lib` flat-file approach is at its limit (gemini.ts >1300 lines). Move to `src/lib/agents/<agent>/` modules with a shared `llm.ts` (the entropy/retry/structured-call core), mirroring the worker's `ffmpeg-pipeline/` which already does this correctly.
5. **Route structure** follows the new IA: `/brands/[id]/(overview|intelligence|research|ideas|content|videos|settings)` as parallel routes/tabs; `/create` as a single flow with `?brand=&idea=&type=`.
6. **Queues:** one queue per concern (exists). Add `publish` and `ingest-metrics` queues. Idempotency keys on publish jobs (double-post is the scariest failure mode in this product).
7. **Caching:** RSC default caching + `revalidatePath` on mutations (mostly present); CDN-cache R2 video URLs via custom domain (the pub-….r2.dev domain should not be the long-term serving path).
8. **Scalability concerns, honestly ranked:** (1) worker RAM — $5 fix; (2) DEV Clerk keys; (3) per-user RLS but no workspace/team model — fine for launch, design `workspace_id` into new tables now so teams don't force a migration; (4) Gemini rate limits under batch generation — the retry/backoff layer exists, add per-user queueing before any "generate week of content" feature; (5) everything else is comfortably post-PMF.

---

## PHASE 12 — SKILL MATRIX

| Skill | Why needed | Complexity | Priority |
|---|---|---|---|
| Next.js App Router / RSC | Whole frontend; IA restructure into brand-hub tabs | Med | **P0** |
| Postgres/Supabase (RLS, FTS, pgvector) | Evidence store, scoring, multi-tenancy, search | Med | **P0** |
| LLM orchestration (structured output, retries, eval) | Every agent; already house-strength | Med | **P0** |
| FFmpeg / media pipelines | Video QC, formats, future templates | High | **P0** (one person, already exists) |
| Platform APIs & OAuth (LinkedIn, X, Meta, TikTok, YouTube) | Publisher agent — the keystone; each API has quirks/review processes | **High** (org approval lead times!) | **P0 — start API access applications immediately, they take weeks** |
| Queue/worker architecture (BullMQ, idempotency) | Publish + ingest jobs | Med | P1 |
| RAG (chunking, embedding, retrieval quality) | Ask-the-research, gap analysis | Med | P1 |
| Product design (IA, flows) | This document's redesigns | Med | P1 |
| Data/analytics engineering | Metrics ingest, scoring loop | Med | P2 |
| Prompt/eval engineering (LLM-as-judge) | Voice-check, QC gates | Med | P2 |
| Agentic patterns (planner/executor, human-gate design) | Optimizer, auto-pilot mode | High | P3 |
| DevOps (Railway/Vercel, observability) | Render reliability, cost control | Low-Med | ongoing |

Notably absent from requirements: Kubernetes, microservices, custom ML training, dedicated vector DB ops. The team is 2–3 strong generalists + this stack.

---

## PHASE 13 — FINAL DELIVERABLE

### Executive summary

OttoFlow has a **real, working, differentiated core**: research-grounded multi-brand content generation. The brand→idea→post loop works in production today and is genuinely fast. But the product currently (1) ends every journey at a dead end — nothing can be published, scheduled, or reviewed; (2) ships its flagship video feature in a state where ~100% of recent renders fail on a $5 infrastructure constraint; (3) wraps its working core in producer-centric IA ("pipelines", dead "Projects", decorative dashboards) that hides the value; and (4) throws away the research evidence that is its main defensible asset. None of these are hard to fix. All of them are fatal to launch if unfixed.

### Major problems (ranked)

1. **No exit from the loop** — no publish/schedule/review. The product generates artifacts into a cul-de-sac.
2. **Video render 0% success in prod** (1 GB RAM cap; code validated and waiting).
3. **Research evidence is discarded** — kills trust, refresh, RAG, and the learning loop before they start.
4. **IA misdirection** — pipeline-centric nav, dead Projects, brand hub that isn't a hub.
5. **Trust erosion details** — raw stderr errors, mock numbers, fake-active stage cards, hydration error, credit theater.
6. DEV Clerk keys in production.

### Major opportunities (ranked)

1. **Publisher + review queue** → completes the loop → unlocks retention, analytics, and the learning story. Everything downstream of this exists or is trivial.
2. **Script/storyboard approval steps in video** → turns the most fragile feature into the most impressive one, using already-built pipeline phases.
3. **Evidence store + ask-the-research** → cheap to build now, becomes the moat ("research without leaving the platform").
4. **Agency positioning** (multi-brand is already built — market it).
5. **Learning loop v1** (one nightly job + one Home card: "educational outperforms promo 3:1 — reweight?").

### Redesigned IA / journey / navigation / workflow / agents / tech

Delivered in Phases 2, 3, 4, 10, 11 above.

### Roadmap

**Phase 1 — Stop the bleeding (days, not weeks)**
- Railway worker → 2 GB (operator, $5) → verify one render end-to-end
- Remove Projects from nav; kill mock Output Types; fix hydration date bug; fix analytics chart; translate render errors to human language
- Production Clerk keys
- Gate video behind "Beta" until render success ≥95% over 20 consecutive renders

**Phase 2 — Complete the loop (the launch blocker)**
- Review queue (approve/edit/reject) for posts
- Publisher agent: LinkedIn + X first (fastest API approval), then Meta; scheduled posting; published-ID capture
- Brand Hub IA restructure (tabs; artifacts under brand)
- Single Create flow (merge the two generators' entry; keep both engines)
- *Start platform-API approval paperwork on day 1 of this phase*

**Phase 3 — Compound value**
- Evidence store (`research_documents` + pgvector) + evidence library UI + facet refresh + ask-the-research chat
- Script & storyboard approval steps in video flow; voice rotation (P2.5); re-enable crossfades
- Metrics ingest + performance_snapshots + idea scoring
- Calendar + cadence plan (Strategist v1)

**Phase 4 — The OS claim becomes true**
- Optimizer agent (recommendations on Home, human-approved)
- Competitor tracker + content gap analysis
- Campaigns (labels within brands), workspace/team model, video templates/format packs

**Future vision**
- Auto-pilot per brand (relaxed gates: research → plan → produce → publish → learn, human reviews weekly digest)
- Vertical packs (real estate first: MLS-aware ideas, listing-video templates)
- Marketplace of voices/styles; white-label agency reporting

### The one-sentence verdict

> OttoFlow is a working content *engine* dressed as an operating system — bump the worker RAM today, delete the dead weight, build the publish loop next, store your research evidence, and the dressing becomes true.
