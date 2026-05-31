/**
 * Raw-fetch diagnostic — bypasses @supabase/supabase-js entirely to isolate
 * whether the "Headers.set: Condense everything..." TypeError is coming from
 * supabase-js (which we'd see here as a success) or from somewhere deeper in
 * the runtime (in which case raw fetch fails too).
 *
 * Strategy:
 *   1. Pull the current Clerk JWT.
 *   2. Validate its shape (no control chars, eyJ-prefixed).
 *   3. Build a Headers object by hand with explicit string types.
 *   4. fetch() PostgREST directly: GET /rest/v1/brands?select=id,name,user_id
 *   5. Return the raw status + first chunk of response body.
 *
 * If raw fetch returns rows → supabase-js has a stuck/cached state. Drop the
 * SDK in favor of direct PostgREST or upgrade the version.
 * If raw fetch ALSO 500s with the bad text → the bad text is coming from
 * Vercel's edge or Clerk middleware doing something we don't control.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CTL = /[\x00-\x1f\x7f]/;

function safeHeaderValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > 4096) return null;
  if (CTL.test(v)) return null;
  return v;
}

export async function GET() {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let rawTokenLen = 0;
  let validJwt = false;
  let valueCanGoInHeader = false;
  let tokenStart = "";

  try {
    const token = await getToken();
    if (typeof token === "string") {
      rawTokenLen = token.length;
      tokenStart = JSON.stringify(token.slice(0, 12));
      validJwt = VALID_JWT.test(token);
      valueCanGoInHeader = safeHeaderValue(token) !== null;
    }
  } catch (err) {
    return NextResponse.json({
      where: "getToken_threw",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Build Headers BY HAND with explicit string + verified safety
  const apikeySafe = safeHeaderValue(anonKey);
  if (!apikeySafe) {
    return NextResponse.json({ error: "anon_key_unsafe", anonLen: anonKey?.length });
  }

  // Two test variants: with and without Authorization
  const baseHeaders: Record<string, string> = {
    apikey: apikeySafe,
    Accept: "application/json",
  };

  let withAuthResult: unknown = null;
  let withAuthErr: string | null = null;
  try {
    const token = await getToken();
    const headers: Record<string, string> = { ...baseHeaders };
    if (typeof token === "string") {
      const safe = safeHeaderValue(`Bearer ${token}`);
      if (safe) headers.Authorization = safe;
    }
    const url = `${supabaseUrl}/rest/v1/brands?select=id,name,user_id&limit=3`;
    const r = await fetch(url, { headers, method: "GET" });
    const text = await r.text();
    withAuthResult = { status: r.status, body: text.slice(0, 500) };
  } catch (err) {
    withAuthErr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  let anonResult: unknown = null;
  let anonErr: string | null = null;
  try {
    const url = `${supabaseUrl}/rest/v1/brands?select=id,name,user_id&limit=3`;
    const r = await fetch(url, { headers: baseHeaders, method: "GET" });
    const text = await r.text();
    anonResult = { status: r.status, body: text.slice(0, 500) };
  } catch (err) {
    anonErr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  return NextResponse.json({
    clerk: { userId },
    token: { rawTokenLen, validJwt, valueCanGoInHeader, tokenStart },
    withAuth: withAuthResult ?? { error: withAuthErr },
    anon: anonResult ?? { error: anonErr },
  });
}
