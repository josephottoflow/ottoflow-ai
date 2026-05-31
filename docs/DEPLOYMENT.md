# Ottoflow AI — Deployment Guide

This document is the single source of truth for environment variables and
deployment topology for the Brand Research Engine. Audited against
[PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md).

**Topology**

```
                ┌──────────────────────────────────┐
                │  Vercel — Next.js web app        │
                │  (stateless, autoscaling)        │
                └──────┬───────────────────────────┘
                       │
            HTTPS      │    Clerk-authed Supabase JWT
                       │           │
            ┌──────────▼───────────▼─────────┐    ┌───────────────────────┐
            │   Supabase (Postgres + RLS)     │    │  Clerk (Auth)         │
            │   + Realtime channels           │    │  https://clerk.com    │
            └──────────▲──────────────────────┘    └───────────────────────┘
                       │
            service    │ BullMQ enqueue / Realtime
            role       │
                       │
                ┌──────┴───────────────────────────┐    ┌─────────────────┐
                │  Railway — BullMQ worker          │◀──▶│  Upstash Redis  │
                │  (long-running, single replica    │    │  (managed)      │
                │   to start; scale-out later)      │    └─────────────────┘
                └──────────────┬────────────────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │  Google AI — Gemini   │
                    │  (Flash 2.5)          │
                    └───────────────────────┘
```

---

## Environment variables

All vars are validated at process boot. Missing or malformed values cause a
loud startup failure with a remediation message — no silent fallbacks.

### Next.js app (Vercel)

Validated by [`src/lib/env.ts`](../src/lib/env.ts).

| Variable | Required | Where it goes | What it's for |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Browser + server | Supabase REST endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Browser + server | Public publishable key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Browser + server | Clerk publishable key (`pk_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server only | Bypasses RLS — used by route handlers |
| `CLERK_SECRET_KEY` | ✅ | Server only | Clerk server SDK (`sk_…`) |
| `REDIS_URL` | ✅ | Server only | BullMQ enqueue connection |
| `GEMINI_MODEL` | optional | Server only | Default: `gemini-2.5-flash` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | optional | Browser | Default: `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | optional | Browser | Default: `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | optional | Browser | Default: `/` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | optional | Browser | Default: `/` |

> **NEXT_PUBLIC_\* timing**: these are inlined into the client bundle at
> **build** time, not runtime. They must be present in Vercel's environment
> when the build runs, or the bundle will ship with `undefined`.

### Worker (Railway)

Validated by [`src/lib/worker-env.ts`](../src/lib/worker-env.ts).

| Variable | Required | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Admin client target |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Bypasses RLS for worker writes |
| `REDIS_URL` | ✅ | BullMQ consume connection |
| `GOOGLE_API_KEY` | ✅ | Gemini Flash |
| `GEMINI_MODEL` | optional | Default: `gemini-2.5-flash` |
| `GEMINI_TIMEOUT_MS` | optional | Per-call hard timeout. Default: `90000` |
| `WORKER_CONCURRENCY` | optional | Jobs per worker process. Default: `2` |
| `LOG_LEVEL` | optional | `trace | debug | info | warn | error | fatal`. Default: `info` |

> The worker does **not** need Clerk vars or the Supabase anon key — it
> never holds a user session and never goes through RLS.

---

## Validation flow

```
1. Process starts
2. dotenv loads .env.local + .env  (no-op on Railway/Vercel; vars come from platform)
3. env.ts (Next) or worker-env.ts (worker) eagerly parses process.env via zod
4. On failure: throws with the offending vars listed; process exits with non-zero
5. On success: cached env exposed to all downstream modules
6. supabase.ts, queue.ts, gemini.ts etc. read process.env directly — env validator
   has already guaranteed the values are present and well-formed
```

### Build-phase tolerance

`next build` prerenders pages and runs server modules without runtime
secrets present (Vercel injects those at runtime, not build time). To
avoid build crashes, `env.ts` detects `NEXT_PHASE === "phase-production-build"`
and substitutes loud-named placeholders for missing server-only vars.

**Public (NEXT_PUBLIC_\*) vars are still required at build time** — they
get inlined into the client bundle and cannot be substituted later.

Placeholder values look like `build-placeholder-…-do-not-use-at-runtime`,
so if you ever see one in a request log you know exactly what went wrong:
runtime env vars weren't injected on the host.

### Failure example

A missing `CLERK_SECRET_KEY` produces:

```
Error: [env] Server environment validation failed:
  • CLERK_SECRET_KEY — expected a Clerk secret key (sk_test_… or sk_live_…)
  • CLERK_SECRET_KEY — must start with sk_test_ or sk_live_

→ Local dev: copy .env.local.example to .env.local and fill in the missing values.
→ Production: set these in the platform dashboard. See docs/DEPLOYMENT.md.
```

---

## Per-platform setup

### Supabase (Postgres + Realtime)

1. Create a project at <https://supabase.com>.
2. **Settings → API**: copy `URL`, `anon (publishable) key`, `service_role (secret) key`.
3. **SQL Editor**: run migrations in order:
   - `supabase/migrations/001_initial.sql`
   - `supabase/migrations/002_foundation.sql`
4. **Settings → API → JWT Secret**: copy this — needed for the Clerk JWT template.

**Realtime**: enabled automatically by migration 002 (`alter publication
supabase_realtime add table …`). Verify in **Database → Replication**.

### Clerk (Auth)

1. Create app at <https://dashboard.clerk.com>.
2. **API Keys**: copy publishable + secret keys.
3. **JWT Templates → New template**:
   - Name: **`supabase`** (lowercase exact)
   - Signing algorithm: **HS256**
   - Signing key: **the Supabase JWT secret from above**
   - Claims (body):
     ```json
     {
       "aud": "authenticated",
       "role": "authenticated"
     }
     ```
4. **Paths**:
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - After sign-in: `/`

### Upstash Redis

1. <https://upstash.com> → **Create Database**.
2. Region: pick the closest to your Vercel deployment region (US-East / Frankfurt / Singapore).
3. **TLS/SSL**: enabled (recommended). Copy the **TLS Redis URL**:
   `rediss://default:<password>@<host>.upstash.io:<port>`
4. (Optional) Set per-second rate limits in Upstash dashboard for safety.

### Google AI (Gemini)

1. <https://aistudio.google.com/app/apikey> → copy API key.
2. The Brand Research processor uses two grounding tools:
   - **URL Context** — fetches the brand's website
   - **Google Search** — finds competitors
   Both are billed alongside generation tokens.

### Vercel (Next.js app)

1. **New Project** → import this repo.
2. **Root Directory**: `ottoflow-ai`
3. **Framework**: Next.js (auto-detected)
4. **Environment Variables**: set every row marked ✅ in the Next.js table above.
   - Apply to **Production** + **Preview** + **Development** environments.
   - `NEXT_PUBLIC_*` vars are inlined at build — re-deploy after changing them.
5. **Build Command**: `npm run build` (default)
6. **Output Directory**: `.next` (default)
7. **Node version**: 20.x or 22.x.

### Railway (Worker)

1. **New Project → Empty service** (or **Deploy from GitHub**).
2. **Source**: this repo, **Root Directory**: `ottoflow-ai`.
3. **Build command**: `npm install`  *(see [PRODUCTION_AUDIT.md#B3](./PRODUCTION_AUDIT.md) — step 4 of this remediation series fixes this properly)*
4. **Start command**: `npm run start:worker`
5. **Variables**: set every row marked ✅ in the Worker table above.
6. **Healthcheck**: not yet wired (M4 — Phase 5 of this remediation series will add one).
7. **Restart policy**: ON_FAILURE
8. **Replicas**: 1 for now. Scale-out is safe — BullMQ coordinates job ownership via Redis.

---

## Deployment order (first deploy)

1. **Supabase**: create project, run migrations.
2. **Clerk**: create app, configure JWT template using Supabase's JWT secret.
3. **Upstash**: create Redis database.
4. **Google AI Studio**: generate API key.
5. **Railway**: deploy worker with env vars set. Verify logs show
   `{"scope":"worker","msg":"started", ...}`.
6. **Vercel**: deploy Next.js with env vars set. Verify the build succeeded
   (placeholders in logs are OK during build, NOT at runtime).
7. **Smoke test**: sign up, create a brand, watch the worker logs pick up
   the job. Verify the brand transitions through the status enum.

---

## Troubleshooting

### "Environment validation failed" at startup
Read the error — it names each missing/malformed variable with a hint.

### Browser "Server env X accessed in the browser"
A client component is importing a server-only module. Move the import
behind a server file or use `"use server"`.

### Build succeeds but every API route 500s
Runtime env vars weren't injected. Check Vercel **Settings → Environment
Variables** → "Available to:" includes Production.

### Worker starts then immediately stops
Almost always env validation. Look for `[worker-env]` in the Railway logs.

### Realtime updates don't arrive in the UI
B1 is fixed (Step 2). Live progress flows through `SupabaseProvider`, which
injects the Clerk JWT into both Realtime and REST. If updates still don't
arrive, check:
1. Browser console for `[supabase-provider] realtime auth refresh failed`.
2. The Clerk JWT template named `supabase` exists and is signed with the
   Supabase JWT secret (Settings → API → JWT Secret).
3. The relevant table is in the `supabase_realtime` publication
   (Database → Replication in the Supabase dashboard).

### Dashboard / projects pages show empty data
Tracked separately as [B2](./PRODUCTION_AUDIT.md#B2) — fix lands in Step 3.

---

## What's NOT in this guide yet

These come in subsequent remediation steps:

- **Worker healthcheck endpoint** (M4 — Step 5)
- **Sentry / observability wiring** (M1 — Phase 5)
- **Rate limiting** (H2 — Phase 4)
- **Clerk webhooks for user-delete cleanup** (H10 — Phase 4)
- **Final deployment checklist + rollback plan** (Phase 6)
