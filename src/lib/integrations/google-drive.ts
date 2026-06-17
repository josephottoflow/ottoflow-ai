/**
 * Google Drive OAuth + identity helpers (Phase 3 / P1).
 *
 * Authorization-Code + PKCE, least-privilege `drive.file` scope (the app can
 * only see/manage files IT creates — never the user's existing Drive). Thin
 * fetch wrappers over Google's OAuth + Drive REST endpoints; no googleapis dep.
 *
 * The actual file upload is done by the existing
 * src/lib/ffmpeg-pipeline/gdrive.ts `uploadToGDrive()` (reused, not duplicated).
 * This module owns the auth side only.
 *
 * Env (validated lazily — NOT added to env.ts, so prod without these still
 * boots; throws a clear error only when a Drive route is actually hit):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI
 * Note: distinct from GOOGLE_API_KEY (Gemini/Imagen), which is NOT OAuth.
 */
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_DRIVE_PROVIDER = "google_drive";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_ABOUT =
  "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)";

interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function oauthEnv(): OAuthEnv {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Drive OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** True when the OAuth client env is present. Never throws. */
export function isDriveOAuthConfigured(): boolean {
  try {
    oauthEnv();
    return true;
  } catch {
    return false;
  }
}

function b64url(buf: Buffer): string {
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

/** Build the Google consent URL (offline access → refresh token). */
export function buildAuthUrl(opts: { state: string; codeChallenge: string }): string {
  const { clientId, redirectUri } = oauthEnv();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

export interface DriveTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  scope: string | null;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
}): Promise<DriveTokenSet> {
  const { clientId, clientSecret, redirectUri } = oauthEnv();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google token exchange ${res.status}: ${t.slice(0, 300)}`);
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
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const { clientId, clientSecret } = oauthEnv();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google token refresh ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: j.access_token, expiresInSec: j.expires_in };
}

/** Best-effort token revocation (used on disconnect). Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // best-effort — local row is still marked revoked by the caller
  }
}

/** Identify the connected account (stable id + display email). */
export async function fetchDriveIdentity(
  accessToken: string,
): Promise<{ accountId: string; accountName: string | null }> {
  const res = await fetch(DRIVE_ABOUT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google Drive about ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    user?: { displayName?: string; emailAddress?: string; permissionId?: string };
  };
  const u = j.user ?? {};
  return {
    accountId: u.permissionId || u.emailAddress || "unknown",
    accountName: u.emailAddress || u.displayName || null,
  };
}
