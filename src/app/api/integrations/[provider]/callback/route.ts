/**
 * GET /api/integrations/[provider]/callback — finish an OAuth flow (registry-driven).
 *
 * Generalized from /google_drive/callback. The Google redirect URI
 * (/api/integrations/google_drive/callback) resolves here unchanged, so the
 * value registered in Google Cloud stays valid. All failures redirect to the
 * settings UI with ?error=… (never a raw 500).
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { decryptSecret } from "@/lib/integrations/encryption";
import { exchangeCode } from "@/lib/integrations/oauth";
import { getOAuthProvider } from "@/lib/integrations/providers/registry";
import { upsertConnectedAccount, logIntegrationAudit } from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const url = req.nextUrl;
  const { provider } = await params;
  const settings = new URL("/settings/integrations", url.origin);

  const { userId } = await auth();
  if (!userId) {
    settings.searchParams.set("error", "unauthorized");
    return Response.redirect(settings, 302);
  }

  let def;
  try {
    def = getOAuthProvider(provider);
  } catch {
    settings.searchParams.set("error", "unknown_provider");
    return Response.redirect(settings, 302);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  if (oauthErr) {
    settings.searchParams.set("error", oauthErr);
    return Response.redirect(settings, 302);
  }
  if (!code || !state) {
    settings.searchParams.set("error", "missing_code");
    return Response.redirect(settings, 302);
  }

  const admin = createAdminClient();
  const { data: st } = await admin
    .from("oauth_states")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (!st || st.user_id !== userId || st.provider !== provider) {
    settings.searchParams.set("error", "invalid_state");
    return Response.redirect(settings, 302);
  }
  if (st.expires_at && Date.parse(st.expires_at) < Date.now()) {
    await admin.from("oauth_states").delete().eq("id", st.id);
    settings.searchParams.set("error", "expired_state");
    return Response.redirect(settings, 302);
  }

  try {
    const verifier = st.code_verifier_enc
      ? decryptSecret(st.code_verifier_enc, `oauth_state:${userId}`)
      : undefined;
    const tokens = await exchangeCode(def.oauth, { code, codeVerifier: verifier });
    const identity = await def.identity(tokens.accessToken);
    const account = await upsertConnectedAccount({
      userId,
      brandId: st.brand_id ?? null,
      provider,
      accountId: identity.accountId,
      accountName: identity.accountName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
      scopes: tokens.scope ? tokens.scope.split(" ") : def.oauth.scopes,
    });
    await admin.from("oauth_states").delete().eq("id", st.id);
    await logIntegrationAudit({
      userId,
      provider,
      action: "connect",
      target: identity.accountName,
      connectedAccountId: account.id,
      ip: req.headers.get("x-forwarded-for"),
    });
    settings.searchParams.set("connected", provider);
    return Response.redirect(settings, 302);
  } catch (err) {
    await logIntegrationAudit({
      userId,
      provider,
      action: "error",
      target: "connect",
      detail: { error: err instanceof Error ? err.message : String(err) },
      ip: req.headers.get("x-forwarded-for"),
    });
    settings.searchParams.set("error", "exchange_failed");
    return Response.redirect(settings, 302);
  }
}
