/**
 * Google Drive upload (fallback storage).
 *
 * Thin REST wrapper over Drive v3 multipart upload. No googleapis dependency
 * — just fetch + a bearer access token.
 *
 * Scope: this helper does NOT run the OAuth flow. The caller supplies an
 * access token obtained elsewhere (the user authorised `drive.file` during
 * onboarding; the token is refreshed by the auth layer). Drive is the
 * SECONDARY storage path per ADR-002 — used only when R2 is unconfigured or
 * the user explicitly asked to "Save to my Drive". When no token is
 * available the worker simply skips Drive and relies on R2.
 *
 * Drive v3 multipart upload:
 *   POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
 *   body: multipart/related — part 1 = metadata JSON, part 2 = file bytes
 */

export interface GDriveUploadResult {
  fileId: string;
  webViewLink: string | null;
}

export function isGDriveConfigured(accessToken: string | null | undefined): boolean {
  return !!accessToken;
}

/**
 * Upload a file to the user's Drive. Optionally place it in a folder
 * (folderId). Returns the new file id. Throws on non-2xx.
 */
export async function uploadToGDrive(opts: {
  accessToken: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  folderId?: string | null;
}): Promise<GDriveUploadResult> {
  const { accessToken, fileName, contentType, body, folderId } = opts;

  const boundary = `ottoflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata: Record<string, unknown> = { name: fileName, mimeType: contentType };
  if (folderId) metadata.parents = [folderId];

  // Build the multipart/related body manually.
  const pre = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    "utf8",
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const multipartBody = Buffer.concat([pre, body, post]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(multipartBody.byteLength),
      },
      // Node's fetch (undici) accepts a Buffer body at runtime; the DOM lib's
      // BodyInit type doesn't list it, so cast through unknown.
      body: multipartBody as unknown as BodyInit,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive upload failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { id: string; webViewLink?: string };
  return { fileId: json.id, webViewLink: json.webViewLink ?? null };
}
