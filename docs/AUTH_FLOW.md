# Ottoflow AI — Auth & Trust-Chain Reference

Three processes hold credentials. Each makes a *different* trust claim
to Supabase. Confusing them is how data leaks happen, so this doc spells
out every leg.

Companion to [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md) and
[PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md).

---

## 1. The three identities

| Identity | Where it lives | What it can do | How Supabase knows |
|---|---|---|---|
| **Clerk user** (`user_2abc…`) | Browser session + Next.js server (via cookies) | Read + write rows the user owns, per RLS | Clerk-signed JWT with `sub = <user_id>` |
| **Anon** | Anyone who hits the public URL | Effectively nothing — every table has RLS on; no policies match an unauthenticated `auth.jwt() ->> 'sub'` | Default anon key, no JWT |
| **Service role** | Worker process + tightly-scoped server routes | Anything; bypasses RLS entirely | Service-role key in the `Authorization` header |

**Rule of thumb**: any code path that *should* be RLS-checked uses
**Clerk user** identity. Any code path that *must* act on behalf of a
user without their session uses **service role** — and is responsible
for application-level tenant checks. Anon is only used by the
public/anon Supabase client AFTER `realtime.setAuth(<Clerk JWT>)` is
called, so even though the underlying client is "anon-keyed," the
session it represents is the user's.

---

## 2. Browser → Clerk → Supabase

This is the auth chain for everything a user does in a tab.

```
┌─ Browser (BrandDetailClient, etc.) ────────────────────────────────┐
│                                                                     │
│   <ClerkProvider>                                                   │
│     ▼ useSession() →  session                                       │
│   <SupabaseProvider>                                                │
│     ▼ session.getToken({ template: "supabase" })                    │
│     ▼ Clerk signs JWT with the Supabase JWT secret (HS256)          │
│     ▼ createClient(url, anonKey, { accessToken: ⤴ })                │
│     ▼ supabase.realtime.setAuth(token) ← also for REST              │
│   useSupabase() → SupabaseClient                                    │
│                                                                     │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │ REST + Realtime WebSocket carry the JWT
                                      ▼
┌─ Supabase (PostgREST + Realtime) ──────────────────────────────────┐
│                                                                     │
│  Authorization: Bearer <Clerk JWT>                                  │
│   ▼ verify HS256 against Supabase JWT secret                        │
│   ▼ extract sub                                                     │
│   ▼ set auth.jwt() context for the request / channel                │
│   ▼ RLS policies evaluate `current_clerk_user_id()` = sub           │
│   ▼ rows / events filtered to ones the user owns                    │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Where this is wired
- **Token issuance**: `session.getToken({ template: "supabase" })` —
  Clerk dashboard must have a JWT template named `supabase`, HS256, signed
  with Supabase's JWT secret. Setup in
  [DEPLOYMENT.md → Clerk](./DEPLOYMENT.md#clerk-auth).
- **Token forwarding (REST)**:
  [`SupabaseProvider.tsx`](../src/components/SupabaseProvider.tsx) passes
  an `accessToken` async provider into `createClient`. Supabase-js calls
  it before every REST request.
- **Token forwarding (Realtime)**: same file calls
  `supabase.realtime.setAuth(token)` at session start AND every 50 s
  (Clerk session JWTs default to 60 s TTL).
- **DB-side check**:
  [`migrations/001_initial.sql`](../supabase/migrations/001_initial.sql)
  defines `current_clerk_user_id()` returning `auth.jwt() ->> 'sub'`.

---

## 3. Server-side (Next.js) → Clerk session → Supabase

Server components, server actions, and route handlers also act as the
Clerk user. They use the per-request Clerk-authed client.

```
Browser request ─cookies─► Next.js server component / route handler
                              ▼ auth() from @clerk/nextjs/server
                              ▼ getToken({ template: "supabase" })
                              ▼ createServerSupabaseClient()
                              ▼   supabase-js with Authorization header
                              ▼ Supabase → RLS → user's rows only
```

### Where this is wired
- [`src/lib/supabase-server.ts`](../src/lib/supabase-server.ts) —
  `createServerSupabaseClient()` is the per-request factory. Server-only
  (marked with `"server-only"`).
- [`src/lib/db.ts`](../src/lib/db.ts) — every read goes through it.
- [`src/lib/db-brands.ts`](../src/lib/db-brands.ts) — same.
- [`src/app/actions.ts`](../src/app/actions.ts) — every action calls
  `requireUser()` defense-in-depth, then either calls into `db.ts` or
  uses `createServerSupabaseClient()` directly.

### Why this matters
RLS still enforces. A server component that handles User B's request
can only see User B's rows, even though the **same Node process** also
serves User A's requests. The trust scoping happens via JWT per call,
not via process boundaries.

---

## 4. Realtime → JWT → RLS

Realtime is the trickiest part because the WebSocket is long-lived,
filters are server-side, and JWTs expire.

### Subscription path
```
useSupabase()                          ← client authenticated via Clerk
  ▼
channel = supabase.channel("brand:<id>")
  .on("postgres_changes", { table, filter }, handler)
  .subscribe()
  ▼
supabase-realtime opens WS to Supabase
  ▼ presents the JWT set by realtime.setAuth(token)
  ▼ Supabase verifies HS256 signature
  ▼ broker treats the channel as User X
  ▼ for each row change matching `filter`:
      ▼ broker evaluates RLS policy as User X
      ▼ row passes? deliver. row fails? drop silently.
```

### Token refresh while subscribed
Every 50 s, the provider:
```
sb.realtime.setAuth(<new JWT>)
```
Supabase-js renegotiates the WS auth without dropping the channel.
Already-open filters keep firing; the broker's RLS evaluation now uses
the new `sub` claim (which is the same user, just a fresher token).

### Multi-user isolation guarantee
Two facts together are the proof:

1. **A user only has their own Clerk JWT.** Forging another user's JWT
   requires the Supabase JWT secret, which lives only in Clerk's HSM
   and your Supabase project's JWT secret — neither is reachable from a
   browser.
2. **The broker enforces RLS, not the filter.** Even if a malicious
   client subscribes with `filter: brand_id=eq.<someone-elses-id>`, the
   broker evaluates the RLS policy
   (`brand_id IN (SELECT id FROM brands WHERE user_id = current_clerk_user_id())`)
   per row and drops the event.

### Where this is wired
- [`src/components/SupabaseProvider.tsx`](../src/components/SupabaseProvider.tsx)
  — token plumbing.
- [`src/app/brands/[id]/BrandDetailClient.tsx`](../src/app/brands/[id]/BrandDetailClient.tsx)
  — subscribes via `useSupabase()`, with effects gated on the client
  being non-null (i.e. first JWT has landed).
- [`migrations/002_foundation.sql`](../supabase/migrations/002_foundation.sql)
  — `research_jobs_via_brand` and sibling policies.

---

## 5. Worker → Service Role

The worker has no user session. It received the job from BullMQ — the
job data was created by an authenticated user, but by the time the
worker picks it up, that session is long gone (and would have expired
anyway).

```
Worker process
  ▼ env.SUPABASE_SERVICE_ROLE_KEY (set in Railway)
  ▼ createAdminClient() in src/lib/supabase.ts
  ▼ Authorization: Bearer <service-role-key>
  ▼ Supabase → RLS BYPASSED
  ▼ Worker performs scoped writes
```

### How tenant isolation is preserved without RLS

**The job payload IS the tenancy boundary.** Every BullMQ job carries:

```ts
interface BrandResearchJobData {
  brandId: string;
  researchJobId: string;
  // …input snapshot…
}
```

The processor only ever touches rows scoped by these two IDs. Cross-tenant
writes are impossible because the IDs were created server-side at enqueue
time and bound to the authenticated user.

This is **application-level tenancy**. It's safe because:

1. `POST /api/brands` validates the Clerk session, then **stamps** the
   brand's `user_id` from `auth().userId` — never from request body. (See
   [`src/app/api/brands/route.ts`](../src/app/api/brands/route.ts).)
2. The same handler creates the `brand_research_jobs` row with that
   `brand_id`, then enqueues with that `researchJobId`.
3. The worker only writes back to rows matching those IDs — never to
   `brands` or `brand_research_jobs` belonging to a different brand.

**An attacker would need to compromise both the Clerk session AND the
Redis queue contents to fake a job. Neither is reachable from the public
internet.**

### Where the service-role boundary lives
- The service role key is set ONLY on the worker service in Railway.
- It is also set on Vercel for one tightly-scoped use:
  [`src/app/api/brands/route.ts`](../src/app/api/brands/route.ts)
  uses `createAdminClient()` to insert the initial `brands` and
  `brand_research_jobs` rows. This is necessary because the enqueue must
  happen atomically with the row creation, and we need the row IDs to
  return before BullMQ has a chance to start the job. Tracked as
  audit item **H7** for a future tightening (use the user-scoped client
  here too — RLS WITH CHECK would still gate ownership).
- The key is **never** in the browser bundle. Next.js strips
  non-`NEXT_PUBLIC_*` envs from client code; even references to
  `process.env.SUPABASE_SERVICE_ROLE_KEY` in `supabase.ts` resolve to
  `undefined` at runtime in the browser.

---

## 6. Common confusions, ranked

### "Why does the anon Supabase client exist if it can't see anything?"
It exists for one purpose: **the browser WebSocket connection**. Realtime
needs a connection BEFORE the user is authenticated (e.g. the loading
screen). The connection is opened with the anon key; then
`realtime.setAuth(<Clerk JWT>)` upgrades the *session* on top. After
upgrade, the user identity is what RLS sees — even though the underlying
connection was anon-keyed.

We removed the anon `supabase` named export entirely in Step 4. Browser
code uses `useSupabase()` (Clerk-aware). Server code uses
`createServerSupabaseClient()` (Clerk-aware) or `createAdminClient()`
(service role).

### "Why does the worker get to bypass RLS?"
Because it has no Clerk session — there's no `sub` claim. If we tried
to use RLS, every operation would fail the policy check
(`current_clerk_user_id() = NULL`). The trade-off is that we must verify
tenancy in application code: the job payload's `brandId` was created
under a specific user's session and BullMQ ensures the job is processed
exactly once. The "trust" the worker exercises is **trust of its own
queue**, not trust of any external input.

### "What if Clerk goes down?"
- Existing sessions keep working until the JWT expires (~60 s).
- New sign-ins fail; the app shows Clerk's outage UI.
- The worker keeps processing — it doesn't depend on Clerk.
- Already-enqueued jobs complete normally. No data loss.

### "What if Supabase JWT secret rotates?"
- Existing JWTs become invalid; every request fails until Clerk's
  template re-fetches (Clerk caches keys, so allow a few minutes).
- The worker is unaffected (service role key is separate from JWT secret).
- Mitigation: rotate during low traffic; or use Clerk's "Third-Party
  Auth" integration (Phase 5 candidate) which avoids the manual JWT
  secret pairing.

### "Can a malicious user enqueue someone else's research?"
No. The enqueue endpoint (`POST /api/brands`):
1. Reads `userId` from the Clerk session via `auth()`.
2. Inserts `brands.user_id = <that userId>` — caller cannot override.
3. Enqueues with the freshly-created brand_id.

There is no parameter a client can pass to make the worker act on
another user's data.

---

## 7. Trust chain summary (one diagram)

```
┌─────────────┐  password   ┌──────────┐  HS256 JWT   ┌──────────┐
│  User       │ ─────────►  │  Clerk   │ ───────────► │ Supabase │
└─────────────┘  email link └──────────┘  signed with └──────────┘
                                         Supabase's
                                         JWT secret           ▲
                                                              │
                                                  service-role│
                                          key (Railway / API) │
                                                              │
                                                       ┌──────┴──────┐
                                                       │  Worker     │
                                                       │  (BullMQ)   │
                                                       └─────────────┘
                                                              ▲
                                                              │
                                                       ┌──────┴──────┐
                                                       │  Job payload│
                                                       │ (Redis)     │
                                                       └─────────────┘
                                                              ▲
                                                       Created with
                                                  authenticated Clerk
                                                  user_id (stamped server-side)
```

Three independent secrets must remain secret for the system to be
tenant-safe:

1. **Clerk session JWT secret** (Supabase's JWT secret, configured into
   Clerk's JWT template). Compromise = forge any user's session.
2. **Supabase service-role key**. Compromise = full DB access.
3. **Clerk secret key** (`CLERK_SECRET_KEY`). Compromise = act as
   Clerk's server SDK; could mint sessions.

All three are stored only in platform env vars (Vercel + Railway +
Clerk + Supabase dashboards), never in code, never in the browser
bundle, never logged. The audit's H7 will further reduce the
service-role surface by routing the API route's insert through the
user-scoped client.
