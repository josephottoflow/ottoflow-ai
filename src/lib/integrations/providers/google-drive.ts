/**
 * Google Drive provider (Phase 3.1a — reference implementation).
 *
 * Drive-specific OAuth config + identity + folder logic. The generic
 * connect/callback/token service (oauth.ts + accounts.ts) drive this via the
 * registry. drive.file scope only (app sees only files it creates). Uploads
 * still go through the existing src/lib/ffmpeg-pipeline/gdrive.ts — this module
 * owns auth + folders only.
 *
 * Env (lazy — not in env.ts, so prod without it still boots):
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI
 * (shared Google client; distinct from GOOGLE_API_KEY which is Gemini/Imagen).
 */
import type { OAuthConfig, ProviderDefinition, ProviderIdentity } from "./types";

export const GOOGLE_DRIVE_PROVIDER = "google_drive";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const DRIVE_ABOUT =
  "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// ─── OAuth config (reads GOOGLE_OAUTH_* lazily) ───────────────────────────────
function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      "Google Drive OAuth is not configured — set GOOGLE_OAUTH_CLIENT_ID, " +
        "GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.",
    );
  }
  return v;
}

const driveOAuthConfig: OAuthConfig = {
  isConfigured: () =>
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    !!process.env.GOOGLE_OAUTH_REDIRECT_URI,
  clientId: () => required("GOOGLE_OAUTH_CLIENT_ID"),
  clientSecret: () => required("GOOGLE_OAUTH_CLIENT_SECRET"),
  redirectUri: () => required("GOOGLE_OAUTH_REDIRECT_URI"),
  authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revokeEndpoint: "https://oauth2.googleapis.com/revoke",
  scopes: [GOOGLE_DRIVE_SCOPE],
  usesPKCE: true,
  // Preserves the exact authorize params the original Drive flow used.
  authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
};

/** Identify the connected account (stable id + display email). */
export async function fetchDriveIdentity(accessToken: string): Promise<ProviderIdentity> {
  const res = await fetch(DRIVE_ABOUT, { headers: { authorization: `Bearer ${accessToken}` } });
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

// ─── Folder management (drive.file: only app-created folders are visible) ──────
export const DRIVE_FOLDER_LAYOUT = {
  brand_assets: "Brand Assets",
  creatives: "Generated Creatives",
  videos: "Generated Videos",
  reports: "Reports", // mapped; report-save deferred (no report artifact yet)
} as const;
export type DriveFolderKey = keyof typeof DRIVE_FOLDER_LAYOUT;
export const DRIVE_ROOT_FOLDER = "Ottoflow";

function driveQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string | null,
): Promise<string> {
  const parentClause = parentId ? ` and '${driveQuote(parentId)}' in parents` : "";
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
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
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

// ─── Registry entry ───────────────────────────────────────────────────────────
export const googleDriveProvider: ProviderDefinition = {
  id: GOOGLE_DRIVE_PROVIDER,
  label: "Google Drive",
  kind: "oauth",
  capabilities: ["storage"],
  oauth: driveOAuthConfig,
  identity: fetchDriveIdentity,
};
