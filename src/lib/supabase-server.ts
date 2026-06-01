import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { serverEnv } from "./env";
import { captureFallback } from "./observability";

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
 *
 * Defense-in-depth (we have observed Clerk session corruption in dev where
 * getToken() returned plain prompt text instead of a JWT):
 *   1. safeToken()       — strict JWT shape regex
 *   2. isHeaderSafe()    — RFC 7230 token-value validation (no CR/LF/CTL)
 *   3. tryCreateClient() — createClient itself wrapped in try/catch
 *
 * If ANY layer detects a problem we fall back to an unauthenticated anon
 * client. RLS returns empty rows; the page renders empty rather than 500ing.
 */

// Strict JWT shape: <header>.<payload>.<signature>, each part base64url-encoded.
// All Clerk session tokens are JWTs and always start with "eyJ" (the base64
// encoding of `{"alg":...`). Anything else — chat text, html, error strings,
// random gibberish — is rejected.
const VALID_JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// RFC 7230 §3.2.6: header field-value is *(field-content / obs-fold).
// field-content = field-vchar [ 1*( SP / HTAB ) field-vchar ].
// field-vchar = VCHAR (visible ASCII 0x21–0x7E) / obs-text (0x80–0xFF).
// So: any CR (0x0D), LF (0x0A), NUL (0x00), or other control char is illegal.
// Undici's Headers.set throws TypeError on these — we want to detect FIRST.
function isHeaderSafe(value: string): boolean {
  // Reject any control character (0x00–0x1F or 0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  // Length sanity — Clerk JWTs are typically 700–1200 chars, hard cap at 4096
  if (value.length === 0 || value.length > 4096) return false;
  return true;
}

function safeToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  if (!VALID_JWT.test(token)) {
    captureFallback(
      "supabase-server.token.shape_invalid",
      new Error("Clerk getToken() returned a non-JWT value"),
      {
        length: token.length,
        preview: token.slice(0, 30),
      }
    );
    return null;
  }
  // Belt-and-suspenders: even valid-looking JWTs get one more check.
  if (!isHeaderSafe(token)) {
    captureFallback(
      "supabase-server.token.header_unsafe",
      new Error("JWT passed regex but failed header-value safety check")
    );
    return null;
  }
  return token;
}

function makeAnonClient(): SupabaseClient {
  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function tryCreateClient(token: string | null): SupabaseClient {
  const headers: Record<string, string> = {};
  if (token) {
    const authValue = `Bearer ${token}`;
    if (!isHeaderSafe(authValue)) {
      captureFallback(
        "supabase-server.auth_header.unsafe",
        new Error("Authorization header would be malformed; falling back to anon")
      );
      return makeAnonClient();
    }
    headers.Authorization = authValue;
  }
  try {
    return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    captureFallback("supabase-server.createClient.threw", err);
    return makeAnonClient();
  }
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  let token: string | null = null;
  try {
    const { getToken } = await auth();
    const raw = await getToken();
    token = safeToken(raw);
  } catch (err) {
    captureFallback("supabase-server.clerk_getToken.threw", err);
    // Fall through with token=null → anon client.
  }

  return tryCreateClient(token);
}
