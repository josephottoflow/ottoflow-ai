/**
 * App-owned media URLs — the customer NEVER sees `*.r2.dev`.
 *
 * Cloudflare states plainly that the managed `r2.dev` domain "is not intended
 * for production usage and has a variable rate limit"; production buckets must
 * sit behind a custom domain. On top of that, some customer networks DNS-block
 * `*.r2.dev`, so a video that rendered perfectly fails to play.
 *
 * We solve both by making the APPLICATION own the customer-facing URL. The DB
 * still stores the canonical R2 URL (storage is the source of truth), but every
 * URL handed to the browser is transformed at READ time by `toAppMediaUrl()`.
 * This makes the fix retroactive: existing rows that hold an `r2.dev` URL are
 * rewritten on the way out, so there is no data migration and no broken link
 * (zero-downtime).
 *
 * SAFE BY DEFAULT — dormant until an operator explicitly enables a backend, so
 * deploying this code changes NOTHING about current playback (no regression).
 * Two opt-in backends, selected by env:
 *
 *   1. NEXT_PUBLIC_MEDIA_BASE_URL set (e.g. https://cdn.ottoflow.ai)
 *      → return `${base}/${key}`. The PRODUCTION target: an R2 custom domain,
 *        served directly from Cloudflare's edge (cached, no r2.dev rate limit),
 *        and it needs NO R2 secrets on the web tier. Recommended.
 *
 *   2. NEXT_PUBLIC_MEDIA_PROXY === "1" (and no custom domain)
 *      → return `/api/media/${key}`, our same-origin proxy that signs a GET to
 *        R2 server-side and streams the bytes. Works on every network with zero
 *        DNS setup, BUT requires the four R2_* vars in the WEB tier's env
 *        (they currently live only on the Railway worker — runtime-confirmed
 *        503 otherwise). Enable only after adding them to Vercel.
 *
 *   3. neither set (current default) → return the stored URL UNCHANGED.
 *
 * Either backend makes the customer link app-owned and the storage provider
 * replaceable without changing customer-visible URLs.
 */

const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "").replace(/\/$/, "");
const PROXY_ENABLED = process.env.NEXT_PUBLIC_MEDIA_PROXY === "1";

/** True for the R2 hosts whose URLs we must re-own before exposing them. */
function isR2Host(host: string): boolean {
  return host.endsWith(".r2.dev") || host.endsWith(".r2.cloudflarestorage.com");
}

/**
 * Extract the object key from a stored R2 URL.
 * - r2.dev / custom-domain form: `https://host/<key>`        → key = path
 * - S3 endpoint form:            `https://host/<bucket>/<key>` → key = path minus bucket
 * Returns the path WITHOUT a leading slash, preserving any existing encoding.
 */
function objectKeyFromUrl(u: URL): string {
  const path = u.pathname.replace(/^\/+/, "");
  if (u.host.endsWith(".r2.cloudflarestorage.com")) {
    // Drop the leading `<bucket>/` segment.
    const slash = path.indexOf("/");
    return slash >= 0 ? path.slice(slash + 1) : path;
  }
  return path;
}

/**
 * Convert any stored media URL into an app-owned URL. Pass-through for values
 * that are already app-owned (relative paths, or already on the configured
 * media base) or that point at hosts we don't manage.
 */
export function toAppMediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return stored ?? null;

  // Dormant unless an operator opted into a backend — preserves current
  // behavior on deploy (no regression for users already on working networks).
  if (!MEDIA_BASE && !PROXY_ENABLED) return stored;

  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    // Relative path (e.g. already `/api/media/...`) — already app-owned.
    return stored;
  }

  // Already on our branded media domain → leave it.
  if (MEDIA_BASE && stored.startsWith(MEDIA_BASE)) return stored;

  // Only re-own URLs that point at R2 storage; never rewrite unrelated hosts.
  if (!isR2Host(url.host)) return stored;

  const key = objectKeyFromUrl(url);
  if (!key) return stored;

  if (MEDIA_BASE) return `${MEDIA_BASE}/${key}`;     // custom domain (preferred)
  if (PROXY_ENABLED) return `/api/media/${key}`;     // same-origin proxy (opt-in)
  return stored;                                      // unreachable; keep safe
}
