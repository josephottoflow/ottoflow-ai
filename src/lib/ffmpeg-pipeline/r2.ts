/**
 * Cloudflare R2 upload via the S3-compatible API.
 *
 * We sign requests with AWS SigV4 using only node:crypto — NO @aws-sdk
 * dependency. This keeps the worker's esbuild bundle lean (the project
 * deliberately avoids dragging the full AWS SDK into the worker) and means
 * the pipeline ports to any Node runtime without native modules.
 *
 * Env:
 *   R2_ACCOUNT_ID        — Cloudflare account id (subdomain of the endpoint)
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret
 *   R2_BUCKET            — bucket name (e.g. "ottoflow-renders")
 *   R2_PUBLIC_BASE_URL   — public base, e.g. "https://cdn.ottoflow.ai"
 *                          (R2 public bucket custom domain). Used to build
 *                          the returned URL.
 *
 * R2 endpoint: https://<accountid>.r2.cloudflarestorage.com
 * Region for SigV4 is always "auto" for R2.
 */
import { createHash, createHmac } from "node:crypto";

const REGION = "auto";
const SERVICE = "s3";

export class R2NotConfiguredError extends Error {
  constructor() {
    super("R2 env not fully configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)");
  }
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Build the SigV4 signing key for a given date/region/service.
 */
function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/**
 * Encode an object key for use in a URI path — preserve "/" but encode
 * everything else per RFC 3986 (matching SigV4's canonical URI rules).
 */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export interface R2UploadResult {
  objectKey: string;
  publicUrl: string;
  etag: string | null;
}

/**
 * PUT an object to R2. Returns the public URL (via R2_PUBLIC_BASE_URL) +
 * the object key written. Throws on non-2xx.
 */
export async function uploadToR2(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<R2UploadResult> {
  if (!isR2Configured()) throw new R2NotConfiguredError();

  const accountId = process.env.R2_ACCOUNT_ID as string;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID as string;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY as string;
  const bucket = process.env.R2_BUCKET as string;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucket}/${encodeKey(objectKey)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);                          // YYYYMMDD

  const payloadHash = sha256Hex(body);

  // Canonical headers (must be sorted by lowercase name).
  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // empty query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(secretKey, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      ...headers,
      authorization,
      "content-length": String(body.byteLength),
    },
    // Node's fetch (undici) accepts a Buffer body at runtime; the DOM lib's
    // BodyInit type doesn't list it, so cast through unknown.
    body: body as unknown as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }

  const base = (process.env.R2_PUBLIC_BASE_URL ?? `https://${host}/${bucket}`).replace(/\/$/, "");
  return {
    objectKey,
    publicUrl: `${base}/${encodeKey(objectKey)}`,
    etag: res.headers.get("etag"),
  };
}

// sha256 of an empty payload — the canonical value for an unsigned-body GET.
const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface R2SignedGet {
  url: string;
  headers: Record<string, string>;
}

/**
 * Build a signed (SigV4) GET request for an R2 object so a server-side route
 * can stream it WITHOUT exposing the bucket's public r2.dev URL to the client.
 *
 * This is the backend for the app-owned `/api/media/[...key]` proxy. The
 * customer's browser only ever talks to our own domain; we fetch from R2's
 * S3 endpoint here (server-side), which also sidesteps networks that DNS-block
 * `*.r2.dev`. An optional `range` header is signed through for streaming /
 * resumable downloads.
 */
export function r2SignedGet(objectKey: string, opts: { range?: string } = {}): R2SignedGet {
  if (!isR2Configured()) throw new R2NotConfiguredError();

  const accountId = process.env.R2_ACCOUNT_ID as string;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID as string;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY as string;
  const bucket = process.env.R2_BUCKET as string;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucket}/${encodeKey(objectKey)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // Range (when present) is a signed header — include it in the canonical set.
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  if (opts.range) headers["range"] = opts.range;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", signingKey(secretKey, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: { ...headers, authorization },
  };
}
