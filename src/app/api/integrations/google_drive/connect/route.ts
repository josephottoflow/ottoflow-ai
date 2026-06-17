/**
 * GET /api/integrations/google_drive/connect — start the Drive OAuth flow.
 *
 * Creates a PKCE/CSRF oauth_states row (verifier encrypted) and 302-redirects
 * the user to Google's consent screen. No tokens exist yet.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { encryptSecret } from "@/lib/integrations/encryption";
import {
  buildAuthUrl,
  generatePkce,
  randomState,
  isDriveOAuthConfigured,
  GOOGLE_DRIVE_PROVIDER,
} from "@/lib/integrations/google-drive";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriveOAuthConfigured()) {
    return Response.json(
      { error: "Google Drive OAuth is not configured on the server." },
      { status: 503 },
    );
  }

  const brandId = req.nextUrl.searchParams.get("brandId");
  const { verifier, challenge } = generatePkce();
  const state = randomState();

  const admin = createAdminClient();
  const { error } = await admin.from("oauth_states").insert({
    state,
    user_id: userId,
    provider: GOOGLE_DRIVE_PROVIDER,
    code_verifier_enc: encryptSecret(verifier, `oauth_state:${userId}`),
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? null,
    brand_id: brandId,
  });
  if (error) {
    return Response.json(
      { error: `Failed to start OAuth: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.redirect(buildAuthUrl({ state, codeChallenge: challenge }), 302);
}
