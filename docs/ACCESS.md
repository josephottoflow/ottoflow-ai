# ACCESS.md — Infrastructure Access Matrix

Last verified: 2026-06-13 (every row tested live, not assumed).
Goal: **no deployment-critical operation depends on a browser dashboard.**

## Access matrix

| System | Working methods | Missing methods | SPOF risk |
|---|---|---|---|
| GitHub | Git HTTPS via Windows Credential Manager (push = deploy trigger) | `gh` CLI (not installed — wanted for PR/Actions automation, not deploy-critical) | Low |
| Vercel | API token (MCP) — deployments, build logs, runtime logs; auto-deploy from GitHub `main` | CLI auth (`~/.vercel` absent; not needed — API covers it) | Low |
| Railway | Browser dashboard (user session); auto-deploy from GitHub `main` | **CLI installed but unauthenticated**; no `RAILWAY_TOKEN` | **Medium — visibility is browser-only** |
| Supabase | Anon publishable key (RLS-scoped REST reads; in app bundle); service-role key (REST writes; Vercel+Railway env only) | **Dashboard (DOWN 2026-06-13: frontend boot-crash), CLI token, Management API token, direct Postgres password** | **CRITICAL — there is currently NO DDL/migration path** |

## Credential locations

| Credential | Where it lives |
|---|---|
| GitHub push credential | Windows Credential Manager (this machine) |
| Vercel API token | MCP connector config (project `prj_2NKyZ4EvEYWpbDolFiCZuPnfHyh3`*, team `team_MrIWWj7J9L2KLG58IRFcnDK7`) |
| Supabase anon (publishable) key | Public by design — app bundle (`sb_publishable_…`) |
| Supabase service-role key | Vercel env + Railway service variables ONLY (never local) |
| Gemini, Pexels, R2, Redis, Sentry | Railway service variables; GOOGLE_API_KEY also in repo-root `.env` for local harnesses |
| Supabase access token / DB password | **NOWHERE — this is the gap to close** |

*see Vercel MCP for exact ids.

## Required one-time setup (operator, ~5 min total) — closes every gap

```powershell
# 1. Supabase CLI auth (interactive once; token persists in %APPDATA%\supabase)
cd D:\tiktok-product-video-factory\ottoflow-ai
npx supabase login
npx supabase link --project-ref ddozknywcdpyfdokmfrp   # prompts for DB password

# 2. Break-glass direct-DB path (works even if dashboard AND Management API are down):
#    Supabase → Settings → Database → connection string → save to repo-root .env as:
#    SUPABASE_DB_URL=postgresql://postgres:…@db.ddozknywcdpyfdokmfrp.supabase.co:5432/postgres
#    (root project has the `pg` driver — node scripts can run DDL with this)

# 3. Railway programmatic access:
#    Dashboard → Account → Tokens → create → save to repo-root .env as RAILWAY_TOKEN=…
#    (CLI is already installed; `railway status`, logs, variables then work headless)
```

## Known platform identifiers

- Supabase project: `ddozknywcdpyfdokmfrp` (ottoflow-staging — serves production traffic; no separate prod DB)
- Railway project: `6f03b33a-9433-4e21-bdbc-1c47525dd5a1` ("content-friendship"), worker service `1170f8dd-d50d-4b6d-9019-a31798890fca`
- GitHub: `josephottoflow/ottoflow-ai`; deploy branch: `main` (feature branch fast-forwards to it)
