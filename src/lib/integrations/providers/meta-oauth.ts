/**
 * Meta (Facebook/Instagram) OAuth core (Phase 3.1c).
 *
 * Shared auth/token logic for the single "meta" provider (providers/meta.ts).
 * Meta diverges from standard OAuth2: no refresh_token grant. Instead a
 * short-lived token (~1–2h) is exchanged for a long-lived (~60-day) token via
 * `grant_type=fb_exchange_token`, and "refresh" = re-exchange the long-lived
 * token. Revocation is `DELETE /me/permissions`, not a token POST. All three
 * are wired through the framework's exchangeToken/refresh/revoke hooks.
 *
 * Env (lazy — not in env.ts): META_OAUTH_CLIENT_ID / META_OAUTH_CLIENT_SECRET /
 * META_OAUTH_REDIRECT_URI; optional META_GRAPH_VERSION (default v21.0),
 * META_SCOPES (comma-separated). Distinct from any Google/LinkedIn creds.
 *
 * ⚠️ Graph version + field shapes should be confirmed against current Meta
 * docs at provisioning (versions sunset on a rolling schedule).
 */
import type { OAuthConfig, ProviderIdentity, TokenSet } from "./types";

export const META_PROVIDER = "meta";

const DEFAULT_SCOPES =
  "public_profile,pages_show_list,pages_read_engagement,instagram_basic,business_management";
const LONG_LIVED_DEFAULT_SEC = 60 * 24 * 3600; // ~60 days when expires_in is absent

function version(): string {
  return process.env.META_GRAPH_VERSION ?? "v21.0";
}
export function graphBase(): string {
  return `https://graph.facebook.com/${version()}`;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      "Meta OAuth is not configured — set META_OAUTH_CLIENT_ID, " +
        "META_OAUTH_CLIENT_SECRET and META_OAUTH_REDIRECT_URI.",
    );
  }
  return v;
}

export const metaOAuthConfig: OAuthConfig = {
  isConfigured: () =>
    !!process.env.META_OAUTH_CLIENT_ID &&
    !!process.env.META_OAUTH_CLIENT_SECRET &&
    !!process.env.META_OAUTH_REDIRECT_URI,
  clientId: () => required("META_OAUTH_CLIENT_ID"),
  clientSecret: () => required("META_OAUTH_CLIENT_SECRET"),
  redirectUri: () => required("META_OAUTH_REDIRECT_URI"),
  authEndpoint: `https://www.facebook.com/${version()}/dialog/oauth`,
  tokenEndpoint: `${graphBase()}/oauth/access_token`,
  // Revocation is DELETE /me/permissions (metaRevoke hook); leave revokeEndpoint
  // unset so the generic POST-revoke no-ops.
  scopes: (process.env.META_SCOPES ?? DEFAULT_SCOPES)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  usesPKCE: false, // confidential client
  scopeSeparator: ",", // Meta expects a comma-separated scope list
};

/** Short-lived (code-exchange) → long-lived token. A short-lived token is never
 * stored. Returns the long-lived token as BOTH access and "refresh" so the
 * generic token service can re-exchange it (Meta has no real refresh token). */
export async function metaExchangeToken(tokens: TokenSet): Promise<TokenSet> {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", metaOAuthConfig.clientId());
  url.searchParams.set("client_secret", metaOAuthConfig.clientSecret());
  url.searchParams.set("fb_exchange_token", tokens.accessToken);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Meta long-lived exchange ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.access_token, // convention: re-exchange anchor
    expiresInSec: j.expires_in ?? LONG_LIVED_DEFAULT_SEC,
    scope: tokens.scope,
  };
}

/** Re-exchange the current long-lived token for a fresh one. Returns the new
 * token as `refreshToken` too so the token service rolls the anchor (otherwise
 * the original would expire at ~60 days). */
export async function metaRefresh(
  currentToken: string,
): Promise<{ accessToken: string; expiresInSec: number; refreshToken: string }> {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", metaOAuthConfig.clientId());
  url.searchParams.set("client_secret", metaOAuthConfig.clientSecret());
  url.searchParams.set("fb_exchange_token", currentToken);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Meta token refresh ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: j.access_token,
    expiresInSec: j.expires_in ?? LONG_LIVED_DEFAULT_SEC,
    refreshToken: j.access_token,
  };
}

/** Disconnect: Meta revokes via DELETE /me/permissions. Best-effort. */
export async function metaRevoke(token: string): Promise<void> {
  try {
    const url = new URL(`${graphBase()}/me/permissions`);
    url.searchParams.set("access_token", token);
    await fetch(url, { method: "DELETE" });
  } catch {
    // best-effort — local row still deleted
  }
}

/** Identify the connected Meta user. */
export async function metaIdentity(accessToken: string): Promise<ProviderIdentity> {
  const url = new URL(`${graphBase()}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Meta /me ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { id: string; name?: string };
  return { accountId: j.id, accountName: j.name ?? null };
}
