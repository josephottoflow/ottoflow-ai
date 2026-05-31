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
// Strict JWT shape: <header>.<payload>.<signature>, each part base64url-encoded.
// All Clerk session tokens are JWTs and always start with "eyJ" (the base64
// encoding of `{"alg":...`). Anything else — chat text, html, error strings,
// random gibberish — is rejected and we fall back to anon access (RLS returns
// nothing, page renders empty rather than 500ing on Headers.set).
const VALID_JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function safeToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  if (!VALID_JWT.test(token)) {
    console.error(
      `[supabase-server] Clerk getToken() returned a non-JWT value ` +
        `(${token.length} chars, starts with: ${JSON.stringify(token.slice(0, 30))}). ` +
        `Falling back to anon access. User likely needs to sign out + delete their ` +
        `Clerk user (corrupted metadata) and sign up again with a fresh email.`
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
