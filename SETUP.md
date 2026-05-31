# Ottoflow AI — Setup Guide

## TL;DR

```bash
cd ottoflow-ai
npm install
cp .env.local.example .env.local        # fill in keys (see below)
npm run dev                              # → http://localhost:3000
npm run dev:worker                       # in a second terminal
```

You need: Supabase project, Clerk app, Redis (local or Upstash), Google AI API key.

> **Env validation**: both the Next.js app and the BullMQ worker validate
> their required environment variables at boot via zod (`src/lib/env.ts` and
> `src/lib/worker-env.ts`). If anything's missing or malformed, the process
> refuses to start with a message naming the offending variable. No more
> silent fallbacks. See **docs/DEPLOYMENT.md** for the full var reference.

---

## 1. Supabase

1. Create a project at <https://supabase.com>.
2. Copy the URL, anon key, and service role key into `.env.local`.
3. Run the migrations (Dashboard → **SQL Editor** → New query), in order:
   - `supabase/migrations/001_initial.sql`
   - `supabase/migrations/002_foundation.sql`

> **If you ran the older `migration.sql`** (pre-Clerk schema with `user_id uuid`):
> drop the schema and re-run `001` + `002` — `user_id` is now `text` because Clerk IDs
> are strings (`user_2abc…`), not UUIDs.
>
> ```sql
> drop schema public cascade;
> create schema public;
> grant all on schema public to postgres, anon, authenticated, service_role;
> ```

### Wire Clerk → Supabase RLS

The server Supabase client (`src/lib/supabase-server.ts`) forwards the Clerk session
JWT to Supabase so RLS sees the current user.

1. Clerk Dashboard → **JWT Templates** → **New template**.
2. Name it **`supabase`** (lowercase, exact).
3. Use this template body:

   ```json
   {
     "aud": "authenticated",
     "role": "authenticated"
   }
   ```

4. **Signing algorithm:** set to **HS256** and **Signing key** to your Supabase JWT secret
   (Supabase Dashboard → Settings → API → JWT Secret).

That's it — `auth().getToken({ template: "supabase" })` now returns a token Supabase trusts,
and our RLS policies read `auth.jwt() ->> 'sub'` to scope rows to the Clerk user id.

---

## 2. Clerk

1. <https://dashboard.clerk.com> → **Create application**.
2. Publishable key + secret key → `.env.local` (see `.env.local.example`).
3. Enable the social/email providers you want under **User & Authentication**.
4. **Paths** → set to:
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - After sign-in: `/`
5. Set up the **`supabase`** JWT template (see Supabase section above).

---

## 3. Redis (BullMQ)

Pick one:

**Local (Mac/Linux):**
```bash
brew install redis && brew services start redis
```

**Local (Windows):** Use [Memurai](https://www.memurai.com) (drop-in Redis), or run
Redis in WSL2 / Docker:
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

**Hosted (recommended for prod):** <https://upstash.com> → Create database → copy
the **TLS Redis URL** (`rediss://…`).

Set `REDIS_URL` in `.env.local`.

---

## 4. Google AI (Gemini)

<https://aistudio.google.com/app/apikey> → copy your API key into `GOOGLE_API_KEY`.

Default model is `gemini-2.5-flash` (cheap + supports URL context + Google Search grounding).

---

## 5. Run

```bash
# Terminal 1 — Next.js dev server
npm run dev

# Terminal 2 — BullMQ worker
npm run dev:worker
```

Visit <http://localhost:3000> → sign up → **Brands → Research Your First Brand**.

Watch live progress stream into the brand detail page via Supabase Realtime.

---

## Architecture

```
┌─────────────────┐      ┌──────────────────────┐     ┌─────────────────┐
│  Next.js (Web)  │  →   │  POST /api/brands     │  →  │  Redis / BullMQ │
│  Clerk session  │      │  (auth, create rows)  │     │  brand-research │
└─────────────────┘      └──────────────────────┘     └────────┬────────┘
        ▲                                                       │
        │ Realtime stream                                       ▼
        │ (brand_research_jobs)                       ┌──────────────────┐
        │                                             │  Worker process  │
┌──────────────────┐                                  │  Gemini Flash    │
│  Supabase        │  ◀───── admin client ──────────  │  + Google Search │
│  Postgres + RLS  │                                  └──────────────────┘
└──────────────────┘
```

Web tier (Vercel) stays stateless. The worker is its own long-running process —
deploy to Railway, Fly Machines, or any host that runs Node 20+ alongside Redis.

### Deploy worker to Railway

1. New project → **Empty service**.
2. Connect this repo, set **root directory** to `ottoflow-ai`.
3. **Start command**: `npm run start:worker`
4. Add an Upstash Redis service (or external `REDIS_URL`).
5. Copy the same env vars from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `REDIS_URL`).

---

## Pages

| Route | Status |
|---|---|
| `/sign-in` / `/sign-up` | Clerk |
| `/` | Dashboard |
| `/brands` | **NEW** — brands list |
| `/brands/new` | **NEW** — research form |
| `/brands/[id]` | **NEW** — live progress + full brand profile |
| `/content` | Content Pipeline |
| `/video` | Video Pipeline |
| `/projects` | Projects |
| `/projects/[id]` | Project detail |
| `/analytics` | Analytics |

## Stack

- **Next.js 15** App Router + React 19 + TypeScript
- **Tailwind CSS** with custom dark-mode tokens (`src/app/globals.css`)
- **Clerk** for auth, with Supabase JWT bridge for RLS
- **Supabase** Postgres + Realtime
- **BullMQ + ioredis** for background jobs
- **`@google/genai`** (unified Google GenAI SDK) for Gemini Flash 2.5
- **Radix UI** primitives, **Framer Motion**, **Recharts**

## Design System

All design tokens live in `src/app/globals.css`. Key utilities:

- `.glass` / `.glass-strong` — glassmorphism cards
- `.glow-purple` / `.glow-blue` / `.glow-cyan` — box shadows
- `.text-gradient` — purple gradient text
- `.card-hover` — lift on hover
- `.nav-item` / `.nav-item.active` — sidebar nav items
- `.progress-gradient` — animated purple→blue progress bars
- `.status-dot-live` — pulsing live indicator dot

## Project structure

```
ottoflow-ai/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── brands/route.ts        ← create brand + enqueue research
│   │   │   └── generate/route.ts      ← SSE bridge to root pipeline
│   │   ├── brands/
│   │   │   ├── page.tsx               ← list
│   │   │   ├── new/page.tsx           ← form
│   │   │   └── [id]/
│   │   │       ├── page.tsx           ← server
│   │   │       └── BrandDetailClient.tsx
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   ├── sign-up/[[...sign-up]]/page.tsx
│   │   └── ...
│   ├── components/
│   │   ├── Sidebar.tsx                ← Clerk UserButton + Brands nav
│   │   └── ui/                        ← shadcn primitives (button, input, badge, ...)
│   ├── lib/
│   │   ├── supabase.ts                ← anon + admin clients (no Clerk import)
│   │   ├── supabase-server.ts         ← Clerk-authed per-request client
│   │   ├── gemini.ts                  ← Gemini Flash wrapper + research helpers
│   │   ├── queue.ts                   ← BullMQ queue + Redis singleton
│   │   ├── db.ts                      ← existing project/content/render DB calls
│   │   ├── db-brands.ts               ← brand-domain DB calls (RLS-scoped)
│   │   └── types.ts                   ← DbBrand, BrandProfile, …
│   └── middleware.ts                  ← Clerk auth middleware
├── worker/
│   ├── index.ts                       ← BullMQ Worker entry (npm run dev:worker)
│   └── processors/
│       └── brand-research.ts          ← multi-step research pipeline
└── supabase/
    └── migrations/
        ├── 001_initial.sql            ← Clerk-compatible projects/content/renders/activity
        └── 002_foundation.sql         ← brands, research jobs, competitors, keywords, pillars
```
