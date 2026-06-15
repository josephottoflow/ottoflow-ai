# OPEN_TASKS.md

## 🔴 BLOCKING — operator action (Claude cannot do; payment)
1. **Activate Railway Hobby on `josephottoflow's Projects`** (joseph@ottoflow.ai). railway.com/workspace/billing → Add card → Unlock Hobby. Done when the page shows a non-Trial plan + card on file + a billing-history entry + no "maxed out" banner. Unblocks: worker, creative image gen, scheduled publishing, all BullMQ, and (via the 2 GB bump) video render.

## Resume sequence — once Railway is paid (do in order)
2. Re-verify worker: plan paid · `ottoflow-video-hub` running · Redis up · deployed SHA ≥ `eca3456` · BullMQ/Gemini connected (`/api/debug/health` = 8/8).
3. **Apply migration 019** (`content_items.creative_branding jsonb`) via Supabase SQL editor (additive; the generate route writes this column — must precede the code push). Verify column exists + an insert succeeds.
4. **Push the 4 delta commits** (`d6fdc98 8cc095a 350b56a ddf9228`): `git push origin feat/ffmpeg-multi-agent-pipeline && git push origin HEAD:main`. Wait Vercel READY + Railway "Deployment successful".
5. **Full Creative Orchestrator E2E** on a real Basecamp opportunity (`brand b1384434-…`, has logo + founder_headshot uploaded): generate post → Generate Creative → verify brief (hierarchy/confidence/concept/rationale/headline/subheadline/CTA/usage) → Approve → Imagen → validation → sharp composite (logo+headshot byte-identical, subheadline+expert rendered, **exact platform px**) → storage → ready → thumbnail → publish → metrics → analytics attribution (creative_hierarchy + creative_confidence). Produce report (image URL, storage path, creative/content IDs, hierarchy, confidence, dimensions, publish + attribution status).

## After Creative Orchestrator verified — next priorities (in order)
6. **LinkedIn API publishing** (design staged): `platform_connections` table + migration; worker repeatable job auto-publishes due scheduled items (claim-based idempotency, 3 retries); "Share on LinkedIn" + OpenID products (self-serve, scopes `openid profile w_member_social`, posts as member); operator creates the LinkedIn app + sets `LINKEDIN_CLIENT_ID/SECRET`. Plugs into the existing publish-transition contract.
7. **Metrics automation** (replace manual entry once platform APIs exist; same `content_metrics` snapshot contract).
8. **Recommendation-loop improvements** (deep-link recs to generate/mining; write-back to `brands.creative_preferences`).
9. **Video pipeline:** after 2 GB RAM — one `/video/generate` E2E to close ADR-002; **intra-video dedup** in `06-diversity.ts` (greedy distinct `source:source_id` per scene — fixes repeated footage; ~30 lines, no infra change); re-enable crossfades.

## UX backlog (from UI audit, app at 18/24)
P1 (Creative polish): drag-and-drop asset uploader w/ preview; backfill asset `width/height` (null on Vercel uploads — sharp doesn't load there, worker fills it); per-hierarchy compositor layout tuning once visible.
P2 (systemic): migrate ~399 inline `rgba()/hex` literals → design tokens; resolve "Projects (SOON)" dead nav; mobile pass on dense tables; brand_colors editor (no UI today → brief palette empty → fallback accent).

## Known debt (non-blocking)
Clerk DEV keys in prod · hydration #418 · Canva corpus has 8 pre-hardening JSON-shard chunks (re-research to clean) · 2 untracked scripts (`scripts/create-sentry-alert-rules.ts`, `scripts/list-models.local.ts`) cause the only `tsc` errors — harmless, do not commit/fix.
