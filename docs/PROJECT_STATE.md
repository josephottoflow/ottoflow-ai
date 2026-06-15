# PROJECT_STATE.md

**App:** Ottoflow AI — Next.js 14 SaaS dashboard (`ottoflow-ai/` in the tiktok-product-video-factory monorepo). "AI Content Operating System."
**Prod:** https://ottoflow-ai.vercel.app (Vercel) · worker on Railway · Supabase (Postgres+Storage+Realtime) · Clerk auth.
**Branch:** `feat/ffmpeg-multi-agent-pipeline` — fast-forwarded to `main` on push. **HEAD `ddf9228`, origin/main `495262a` → 4 commits UNPUSHED** (the 6 Creative Orchestrator deltas).
**Last verified:** 2026-06-15.

## The core loop — LIVE in prod (migrations 010–016 applied)
research → evidence → opportunity → content → review → publish → metrics → attribution → recommendations. All E2E-verified earlier this project. The working user path (Research a Brand → pick an Idea → Generate Post → review in /content → copy/paste) is fully functional.

## Creative Orchestrator — code complete; deploy blocked
Brand-aligned creative generation (post → creative strategy → approve → image → composite). Phases A–D **committed + deployed**; migrations **017+018 applied to prod**. Six enhancement deltas (`d6fdc98`,`8cc095a`,`350b56a`,`ddf9228`) **committed locally, NOT pushed**; **migration 019 NOT applied**.
- Strategy/brief/preview/approval-gate path is synchronous (Vercel) and works.
- Image generation (Imagen→validate→sharp composite→storage) runs on the Railway worker.
- **Two Sev-1 defects found + fixed** (image gen never succeeded before these): BullMQ colon-in-jobId (`72dcd50`), unsupported Imagen `seed` param (`eca3456`).

## 🔴 THE BLOCKER (everything async is down)
**Railway workspace `josephottoflow's Projects` (joseph@ottoflow.ai) is still on the Trial plan, maxed out.** Billing page: "Trial Workspace, $3.42 credit", **No payment method on file**, **No billing history**, **Unlock Hobby** (locked), "Trial maxed out". All services in both projects (`ottoflow-worker/ottoflow-video-hub`+`redis`, `content-friendship/ottoflow-ai`+`Redis`) = **Paused from exceeding limits**.
**Consequence:** the worker is paused/running pre-`eca3456` code → creative image generation, scheduled publishing, and ALL BullMQ jobs cannot run; the worker cannot deploy the fixes.
**Only the operator can clear it** (add card + Unlock Hobby on this exact workspace; Claude cannot enter payment). Verified ~6× across "it's upgraded" reports — every settled read still shows Trial + no card + empty billing history.

## Also blocked by Railway / RAM
Video render (FFmpeg ADR-002 pipeline): OOMs on the 1 GB Railway worker. The Railway Hobby upgrade also unlocks the 2 GB RAM bump that fixes it.

## What's verified working without the worker (Vercel-side)
Brand research results, opportunity mining, content library, review queue, publishing queue (manual), analytics + recommendations, **creative brief composition + approval gate** (the brief composed correctly in smoke testing: founder_led, 0.92 confidence, all gate fields, real asset IDs bound).

## Resume trigger
When the Railway billing page shows a real paid plan + card + billing history: re-verify worker health → apply migration 019 → push the 4 delta commits → wait for Vercel + Railway worker redeploy at ≥`eca3456` → run the full Creative Orchestrator A–G E2E on a real Basecamp opportunity → final report. See [OPEN_TASKS.md](OPEN_TASKS.md).
