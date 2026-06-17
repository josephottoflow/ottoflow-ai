/**
 * Generic OAuth helpers (Phase 3.1a).
 *
 * Provider-agnostic Authorization-Code (+ optional PKCE) flow: build auth URL,
 * exchange code, refresh, revoke. Each function takes an OAuthConfig from a
 * ProviderDefinition (providers/*), so the same code serves Drive today and
 * Gmail/LinkedIn/Meta/X/YouTube later with zero changes here.
 *
 * Extracted from the original Drive-specific google-drive.ts; behaviour is
 * preserved exactly (Drive's authParams carry access_type/prompt/include_
 * granted_scopes).
 */
import { createHash, randomBytes } from "node:crypto";
import type { OAuthConfig, TokenSet } from "./providers/types";

export type { TokenSet };

export function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE pair: random verifier + its S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Opaque CSRF state nonce. */
export function randomState(): string {
  return b64url(randomBytes(24));
}

/** Build a provider's consent URL. */
export function buildAuthUrl(
  cfg: OAuthConfig,
  opts: { state: string; codeChallenge?: string },
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: cfg.redirectUri(),
    response_type: "code",
    scope: cfg.scopes.join(cfg.scopeSeparator ?? " "),
    state: opts.state,
    ...(cfg.authParams ?? {}),
  });
  if (cfg.usesPKCE && opts.codeChallenge) {
    p.set("code_challenge", opts.codeChallenge);
    p.set("code_challenge_method", "S256");
  }
  return `${cfg.authEndpoint}?${p.toString()}`;
}

/** Exchange an authorization code (+ optional PKCE verifier) for tokens. */
export async function exchangeCode(
  cfg: OAuthConfig,
  opts: { code: string; codeVerifier?: string },
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId(),
    client_secret: cfg.clientSecret(),
    code: opts.code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri(),
  });
  if (cfg.usesPKCE && opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

  const res = await fetch(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OAuth token exchange ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresInSec: j.expires_in,
    scope: j.scope ?? null,
  };
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(
  cfg: OAuthConfig,
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const res = await fetch(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OAuth token refresh ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: j.access_token, expiresInSec: j.expires_in };
}

/** Best-effort token revocation (disconnect). Never throws. No-op if the
 * provider has no revoke endpoint. */
export async function revokeToken(cfg: OAuthConfig, token: string): Promise<void> {
  if (!cfg.revokeEndpoint) return;
  try {
    await fetch(cfg.revokeEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // best-effort — caller still deletes the local row
  }
}
