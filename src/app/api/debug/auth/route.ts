/**
 * Diagnostic endpoint for the Clerk → Supabase Third-Party Auth bridge.
 *
 * Returns three signals so we can pinpoint exactly where the chain breaks
 * when an authed user's queries return empty (no data, no error — RLS just
 * filters everything out because Supabase doesn't recognize the JWT).
 *
 *   { clerkUserId, jwtPresent, jwtSub, jwtIss, supabaseJwt, supabaseSub }
 *
 *   - clerkUserId : what Clerk's auth() reports server-side
 *   - jwtSub/iss  : the actual claims inside the Clerk session token
 *   - supabaseJwt : what `select auth.jwt()` returns from a query with that
 *                   token. If null, Supabase is rejecting the token (no
 *                   Third-Party Auth provider for this Clerk instance, or
 *                   the JWKS is unreachable).
 *   - supabaseSub : what `select current_clerk_user_id()` returns. Should
 *                   equal clerkUserId. If null, the function can't find
 *                   the sub claim.
 *
 * AUTH-ONLY (auth() check inside) but exposes diagnostic info — remove or
 * gate behind an env flag before going public-beta.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // B1.R8 — admin-only. 404 hides whether the endpoint exists at all.
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull the token to extract claims (don't return the token itself).
  let token: string | null = null;
  let jwtSub: string | null = null;
  let jwtIss: string | null = null;
  let jwtAud: unknown = null;
  let jwtRole: string | null = null;
  let tokenLen = 0;

  try {
    token = await getToken();
    if (token) {
      tokenLen = token.length;
      const parts = token.split(".");
      if (parts.length === 3) {
        const pad = (s: string) =>
          s + "=".repeat((4 - (s.length % 4)) % 4);
        const decoded = Buffer.from(
          pad(parts[1]).replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        ).toString("utf-8");
        const payload = JSON.parse(decoded);
        jwtSub = payload.sub ?? null;
        jwtIss = payload.iss ?? null;
        jwtAud = payload.aud ?? null;
        jwtRole = payload.role ?? null;
      }
    }
  } catch (err) {
    console.error("[debug/auth] failed to decode token:", err);
  }

  // Call Supabase using the user-authed client and ask Postgres what it sees.
  // Two RPCs we'd want, but we may not have any — use a simple SELECT that
  // surfaces both. Easiest: create a one-off SELECT via .rpc() ? No — use a
  // direct select expression. Supabase REST supports limited SQL — better
  // to expose this via a SECURITY DEFINER function. But for now we just
  // attempt a select against `brands` table with select count and observe.
  const sb = await createServerSupabaseClient();

  // Try to query the user's brands; if RLS hides everything we get [] with
  // no error. Anything in count means the bridge works.
  const { data: brandRows, error: brandErr, count: brandCount } = await sb
    .from("brands")
    .select("id,user_id", { count: "exact" })
    .limit(3);

  // Also fetch the SQL function output — we need to create the RPC for this
  // to work without a migration. Skip if not available.
  let rpcClerkId: string | null | { error: string } = "(rpc not present)";
  try {
    const { data, error } = await sb.rpc("current_clerk_user_id");
    if (error) {
      rpcClerkId = { error: error.message };
    } else {
      rpcClerkId = (data as string) ?? null;
    }
  } catch (err) {
    rpcClerkId = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    clerk: {
      userId,
      tokenPresent: !!token,
      tokenLen,
      jwtSub,
      jwtIss,
      jwtAud,
      jwtRole,
      subMatchesUserId: jwtSub === userId,
    },
    supabase: {
      brandRowsReturned: brandRows?.length ?? 0,
      brandCount: brandCount ?? null,
      brandErr: brandErr
        ? { message: brandErr.message, code: brandErr.code, details: brandErr.details }
        : null,
      brandRowsPreview: brandRows ?? null,
      currentClerkUserIdRpc: rpcClerkId,
    },
    hint:
      "If clerk.tokenPresent=true but supabase.brandRowsReturned=0 and " +
      "supabase.brandErr=null, the JWT is reaching Supabase but RLS filters " +
      "to nothing — most likely because the Clerk instance is NOT configured " +
      "as a Third-Party Auth provider in Supabase Dashboard → Authentication → " +
      "Third-Party Auth. Add a Clerk provider pointing at clerk.jwtIss " +
      "(e.g. pro-beetle-20.clerk.accounts.dev) and retry.",
  });
}
