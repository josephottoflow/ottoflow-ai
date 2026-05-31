import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { serverEnv } from "./env";

/**
 * Per-request Supabase client authenticated with the current Clerk session.
 * RLS policies see `auth.jwt() ->> 'sub'` = the Clerk user id.
 *
 * Uses Supabase's native Third-Party Auth integration with Clerk (Path A in
 * AUTH_FLOW.md). The Clerk session token is passed directly — Supabase
 * verifies it via Clerk's JWKS endpoint configured under Supabase
 * Authentication → Third-Party Auth. No Clerk JWT template needed.
 *
 * Usage from server components / route handlers / server actions:
 *   const sb = await createServerSupabaseClient();
 *   const { data } = await sb.from("brands").select("*");
 */
// HTTP header values must be printable ASCII. A token containing newlines,
// control chars, or non-ASCII would throw a TypeError from Headers.set —
// we'd rather degrade to anon access (RLS returns nothing) than 500 the page.
// Also defends against any future Clerk SDK regression that returns something
// unexpected from getToken().
const VALID_HEADER_VALUE = /^[\x21-\x7E]+$/;

function safeToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  if (!VALID_HEADER_VALUE.test(token)) {
    console.error(
      `[supabase-server] Clerk getToken() returned a malformed value ` +
        `(${token.length} chars, contains non-printable or non-ASCII). ` +
        `Falling back to anon access. User likely needs to sign out + clear cookies + sign in again.`
    );
    return null;
  }
  return token;
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  let token: string | null = null;
  try {
    const { getToken } = await auth();
    token = safeToken(await getToken());
  } catch (err) {
    console.error("[supabase-server] auth().getToken() threw:", err);
    // Continue with anon — RLS will scope to no rows, but page renders.
  }

  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
