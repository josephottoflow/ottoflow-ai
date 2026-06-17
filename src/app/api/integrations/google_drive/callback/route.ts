/**
 * GET /api/integrations/google_drive/callback — finish the Drive OAuth flow.
 *
 * Verifies state (CSRF + owner + expiry), exchanges the code with the PKCE
 * verifier, identifies the account, stores encrypted tokens in
 * connected_accounts, deletes the one-time state, audits, and redirects back
 * to the Integrations settings UI. All failures redirect with ?error=… so the
 * user never sees a raw 500.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { decryptSecret } from "@/lib/integrations/encryption";
import {
  exchangeCode,
  fetchDriveIdentity,
  GOOGLE_DRIVE_PROVIDER,
  GOOGLE_DRIVE_SCOPE,
} from "@/lib/integrations/google-drive";
import { upsertConnectedAccount, logIntegrationAudit } from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const settings = new URL("/settings/integrations", url.origin);

  const { userId } = await auth();
  if (!userId) {
    settings.searchParams.set("error", "unauthorized");
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

  if (!st || st.user_id !== userId || st.provider !== GOOGLE_DRIVE_PROVIDER) {
    settings.searchParams.set("error", "invalid_state");
    return Response.redirect(settings, 302);
  }
  if (st.expires_at && Date.parse(st.expires_at) < Date.now()) {
    await admin.from("oauth_states").delete().eq("id", st.id);
    settings.searchParams.set("error", "expired_state");
    return Response.redirect(settings, 302);
  }

  try {
    const verifier = decryptSecret(st.code_verifier_enc, `oauth_state:${userId}`);
    const tokens = await exchangeCode({ code, codeVerifier: verifier });
    const identity = await fetchDriveIdentity(tokens.accessToken);
    const account = await upsertConnectedAccount({
      userId,
      brandId: st.brand_id ?? null,
      provider: GOOGLE_DRIVE_PROVIDER,
      accountId: identity.accountId,
      accountName: identity.accountName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
      scopes: tokens.scope ? tokens.scope.split(" ") : [GOOGLE_DRIVE_SCOPE],
    });
    await admin.from("oauth_states").delete().eq("id", st.id);
    await logIntegrationAudit({
      userId,
      provider: GOOGLE_DRIVE_PROVIDER,
      action: "connect",
      target: identity.accountName,
      connectedAccountId: account.id,
      ip: req.headers.get("x-forwarded-for"),
    });
    settings.searchParams.set("connected", "google_drive");
    return Response.redirect(settings, 302);
  } catch (err) {
    await logIntegrationAudit({
      userId,
      provider: GOOGLE_DRIVE_PROVIDER,
      action: "error",
      target: "connect",
      detail: { error: err instanceof Error ? err.message : String(err) },
      ip: req.headers.get("x-forwarded-for"),
    });
    settings.searchParams.set("error", "exchange_failed");
    return Response.redirect(settings, 302);
  }
}
