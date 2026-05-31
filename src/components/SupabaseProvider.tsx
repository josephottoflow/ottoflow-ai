"use client";

/**
 * Browser-side Supabase client provider, authenticated with the current
 * Clerk session.
 *
 * Why this exists (PRODUCTION_AUDIT.md / B1):
 *   The previous code used the anonymous browser client for Realtime
 *   subscriptions. With RLS enabled, the Realtime broker silently drops
 *   row changes the anon "user" can't SELECT. Result: subscribe() succeeds,
 *   no events arrive, the UI hangs at "Queued" forever.
 *
 * What this does:
 *   1. Creates one Supabase client per browser tab.
 *   2. Pipes Clerk-issued JWTs into the client via `accessToken` (used for
 *      REST queries) AND `realtime.setAuth()` (used for Realtime channels).
 *      Clerk's "supabase" JWT template signs with Supabase's JWT secret so
 *      the broker accepts it and enforces RLS as the right `sub` claim.
 *   3. Refreshes the token before it expires (Clerk session tokens default
 *      to ~60s; we refresh every 50s).
 *   4. Recreates the client on sign-out / user-change so we never carry
 *      stale auth across users.
 *
 * Security guarantee:
 *   Realtime + RLS combine so a client subscribed to `brand_research_jobs`
 *   only receives UPDATEs for jobs whose brand belongs to the authed user.
 *   See supabase/migrations/002_foundation.sql → `research_jobs_via_brand`.
 *   Even if a client crafts a filter for another user's job id, RLS blocks
 *   the SELECT and the broker drops the event.
 */
import { useSession } from "@clerk/nextjs";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

const REFRESH_INTERVAL_MS = 50_000; // Clerk default TTL is ~60s

const SupabaseContext = createContext<SupabaseClient | null>(null);

interface Props {
  children: ReactNode;
}

export function SupabaseProvider({ children }: Props) {
  const { session, isLoaded } = useSession();
  const [client, setClient] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    // ─── Signed-out: provide the anon client (only useful on sign-in routes) ─
    if (!session) {
      const anon = createClient(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );
      setClient(anon);
      return () => {
        anon.removeAllChannels();
      };
    }

    // ─── Signed-in: client that forwards the Clerk JWT to Supabase ──────────
    const sb = createClient(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        // Called by supabase-js for every REST request so the JWT is always
        // current (it caches under the hood). Uses Clerk's native session
        // token — Supabase verifies it via the Clerk JWKS configured under
        // Supabase Third-Party Auth (no JWT template needed). See AUTH_FLOW.md.
        accessToken: async () => {
          try {
            return (await session.getToken()) ?? null;
          } catch {
            return null;
          }
        },
      }
    );

    // Capture the active session into the closure so the interval callback
    // doesn't dereference a stale React-state reference.
    const activeSession = session;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    /**
     * Returns true on success, false if the token couldn't be obtained or
     * setAuth threw. Caller decides whether to retry / give up.
     */
    async function tryPushAuthToRealtime(): Promise<boolean> {
      try {
        const token = await activeSession.getToken();
        if (cancelled || !token) return false;
        sb.realtime.setAuth(token);
        return true;
      } catch (err) {
        console.warn("[supabase-provider] realtime auth refresh failed", err);
        return false;
      }
    }

    // Set initial auth BEFORE exposing the client to consumers — prevents
    // a race where a child subscribes before the first token lands.
    // Retry the initial attempt a few times so a transient Clerk slowdown
    // at page boot doesn't expose an unauth'd client (which would silently
    // fail every Realtime subscribe under RLS).
    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        const ok = await tryPushAuthToRealtime();
        if (ok) break;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      // Even if all three initial attempts failed, expose the client — the
      // accessToken provider will retry on every REST call, and the 50s
      // interval below keeps retrying realtime.setAuth. Worst case: the
      // page renders, but Realtime stays disconnected until Clerk recovers.
      // (Logging-only signal to debug in production: see warn() above.)
      setClient(sb);
      interval = setInterval(tryPushAuthToRealtime, REFRESH_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      sb.removeAllChannels();
    };
    // session.id changes when the user signs out / switches accounts.
  }, [session, isLoaded]);

  return (
    <SupabaseContext.Provider value={client}>
      {children}
    </SupabaseContext.Provider>
  );
}

/**
 * Returns the Clerk-authenticated Supabase client.
 *
 * Returns `null` until the provider has obtained the first JWT.
 * Consumers should guard with `if (!supabase) return;` inside effects
 * and skip rendering data-dependent UI until ready.
 */
export function useSupabase(): SupabaseClient | null {
  return useContext(SupabaseContext);
}
