/**
 * GET /api/integrations/[provider]/connect — start an OAuth flow (registry-driven).
 *
 * Generalized from the former /google_drive/connect: resolves the provider via
 * the registry, so the same handler serves every OAuth provider. The Google
 * Drive URL (/api/integrations/google_drive/connect) resolves here unchanged.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { encryptSecret } from "@/lib/integrations/encryption";
import { generatePkce, randomState, buildAuthUrl } from "@/lib/integrations/oauth";
import { getProvider } from "@/lib/integrations/providers/registry";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await params;
  const def = getProvider(provider);
  if (!def || def.kind !== "oauth" || !def.oauth) {
    return Response.json({ error: `Unknown or non-OAuth provider: ${provider}` }, { status: 404 });
  }
  if (!def.oauth.isConfigured()) {
    return Response.json(
      { error: `${provider} OAuth is not configured on the server.` },
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
    provider,
    code_verifier_enc: def.oauth.usesPKCE ? encryptSecret(verifier, `oauth_state:${userId}`) : null,
    redirect_uri: def.oauth.redirectUri(),
    brand_id: brandId,
  });
  if (error) {
    return Response.json({ error: `Failed to start OAuth: ${error.message}` }, { status: 500 });
  }

  return Response.redirect(
    buildAuthUrl(def.oauth, {
      state,
      codeChallenge: def.oauth.usesPKCE ? challenge : undefined,
    }),
    302,
  );
}
