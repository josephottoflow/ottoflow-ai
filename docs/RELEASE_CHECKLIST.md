# RELEASE_CHECKLIST.md

The codified order for every ottoflow-ai release. Companion docs:
[ACCESS.md](./ACCESS.md) · [DEPLOYMENT.md](./DEPLOYMENT.md).

## Pre-flight (local)

- [ ] `npx tsc --noEmit` clean (ignore the known untracked-straggler error)
- [ ] `npm run build:worker` clean
- [ ] New Gemini/DB behavior validated via a `scripts/*.local.ts` harness where feasible
- [ ] Commit with explicit paths only (NEVER `git add -u` / `git add .` — protects
      the DO-NOT-COMMIT stragglers), conventional message, Claude co-author line

## Migration gate (only if the release includes `supabase/migrations/*`)

- [ ] Migration is idempotent + additive-only
- [ ] Ordering call made consciously:
      code WRITES new columns/values → **migration MUST land first**;
      purely additive read-side → either order, document it
- [ ] Apply: `npx supabase db push` (fallbacks per DEPLOYMENT.md)
- [ ] Verify objects via anon-key REST probes (200 / PGRST205 / 42703 / PGRST202)

## Ship

- [ ] `git push origin feat/ffmpeg-multi-agent-pipeline`
- [ ] `git push origin HEAD:main`
- [ ] Vercel: production deployment state READY with the pushed SHA (API/MCP)
- [ ] Railway: service ACTIVE deployment = pushed commit message +
      "Deployment successful" — **wait for this before any worker-path test**

## Acceptance (feature-specific, live)

- [ ] Exercise the new path end-to-end in production with real data
- [ ] Confirm server-side persistence (reload the page — never trust optimistic UI)
- [ ] Spot-check the adjacent surfaces the change touches (no regressions)

## Post-release

- [ ] Update session memory / handoff with SHA + verification results
- [ ] If anything was deferred (e.g. migration pending), record it as the
      FIRST ACTION for the next session with exact commands

## Standing cautions

- Pushes to main consume Railway build credits — batch doc-only changes
- App pages need hydration before clicks register (re-click if no spinner);
  prefer `form_input`-style programmatic fills for forms
- A Railway deploy mid-job means the OLD worker runs that job
