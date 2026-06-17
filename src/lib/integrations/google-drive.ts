/**
 * Google Drive — backward-compatibility facade (Phase 3.1a).
 *
 * The Drive OAuth/identity/folder logic now lives in
 * providers/google-drive.ts and the generic helpers in oauth.ts; the token
 * service is in accounts.ts. This module preserves the exact import surface the
 * existing Drive routes + workers use, so their code, URLs, and behaviour are
 * unchanged. New code should import from the registry / oauth.ts / providers/*.
 */
import { googleDriveProvider } from "./providers/google-drive";
import {
  buildAuthUrl as buildAuthUrlGeneric,
  exchangeCode as exchangeCodeGeneric,
  type TokenSet,
} from "./oauth";

// Generic helpers re-exported unchanged.
export { generatePkce, randomState } from "./oauth";

// Drive provider surface re-exported unchanged.
export {
  GOOGLE_DRIVE_PROVIDER,
  GOOGLE_DRIVE_SCOPE,
  DRIVE_FOLDER_LAYOUT,
  DRIVE_ROOT_FOLDER,
  fetchDriveIdentity,
  findOrCreateFolder,
  ensureOttoflowFolders,
  listAppFolders,
} from "./providers/google-drive";
export type { DriveFolderKey, DriveFolderMap } from "./providers/google-drive";

/** Drive OAuth client env present? */
export function isDriveOAuthConfigured(): boolean {
  return googleDriveProvider.oauth!.isConfigured();
}

/** Build the Drive consent URL (Drive-bound wrapper over the generic helper). */
export function buildAuthUrl(opts: { state: string; codeChallenge: string }): string {
  return buildAuthUrlGeneric(googleDriveProvider.oauth!, opts);
}

export type DriveTokenSet = TokenSet;

/** Exchange a code for Drive tokens (Drive-bound wrapper). */
export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
}): Promise<DriveTokenSet> {
  return exchangeCodeGeneric(googleDriveProvider.oauth!, opts);
}
