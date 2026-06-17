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

// ─── Folder management (drive.file: the app only sees folders it created) ─────

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Default Ottoflow folder structure. Keys are the stable mapping keys stored
 * in connected_accounts.metadata.folders. */
export const DRIVE_FOLDER_LAYOUT = {
  brand_assets: "Brand Assets",
  creatives: "Generated Creatives",
  videos: "Generated Videos",
  reports: "Reports", // mapped now; report-save deferred (no report artifact yet)
} as const;
export type DriveFolderKey = keyof typeof DRIVE_FOLDER_LAYOUT;
export const DRIVE_ROOT_FOLDER = "Ottoflow";

function driveQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Find a folder by exact name under a parent (or My Drive root), else create
 * it. Idempotent — repeated connects reuse the same folder ids. */
export async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string | null,
): Promise<string> {
  const parentClause = parentId
    ? ` and '${driveQuote(parentId)}' in parents`
    : "";
  const q = `mimeType='${FOLDER_MIME}' and name='${driveQuote(name)}' and trashed=false${parentClause}`;
  const findRes = await fetch(
    `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (findRes.ok) {
    const j = (await findRes.json()) as { files?: { id: string }[] };
    if (j.files && j.files[0]) return j.files[0].id;
  }
  const createRes = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Drive folder create "${name}" ${createRes.status}: ${t.slice(0, 200)}`);
  }
  const j = (await createRes.json()) as { id: string };
  return j.id;
}

export interface DriveFolderMap {
  root: string;
  brand_assets: string;
  creatives: string;
  videos: string;
  reports: string;
}

/** Ensure the Ottoflow/{…} folder tree exists; return the id map. */
export async function ensureOttoflowFolders(accessToken: string): Promise<DriveFolderMap> {
  const root = await findOrCreateFolder(accessToken, DRIVE_ROOT_FOLDER, null);
  const entries = await Promise.all(
    (Object.entries(DRIVE_FOLDER_LAYOUT) as [DriveFolderKey, string][]).map(
      async ([key, label]) => [key, await findOrCreateFolder(accessToken, label, root)] as const,
    ),
  );
  const sub = Object.fromEntries(entries) as Record<DriveFolderKey, string>;
  return { root, ...sub };
}

/** List the folders the app can see (drive.file → only app-created folders). */
export async function listAppFolders(
  accessToken: string,
): Promise<{ id: string; name: string }[]> {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false`;
  const res = await fetch(
    `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Drive folder list ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { files?: { id: string; name: string }[] };
  return j.files ?? [];
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
