/**
 * App-owned media proxy — streams an R2 object from OttoFlow's own domain so
 * the customer never sees `*.r2.dev` and playback works even on networks that
 * DNS-block r2.dev. The browser talks only to this route; we sign a GET to R2's
 * S3 endpoint server-side and pipe the bytes straight back.
 *
 * This is the DEFAULT delivery path. When the operator connects an R2 custom
 * domain and sets NEXT_PUBLIC_MEDIA_BASE_URL, `toAppMediaUrl()` points the
 * browser at that domain instead and this route is bypassed (recommended for
 * production scale — Cloudflare edge caching, no proxy egress).
 *
 * Public route (see middleware): media keys are unguessable UUID paths, matching
 * the existing public-bucket security model. Range requests are forwarded so the
 * native <video> scrubber and resumable downloads work.
 */
import { NextRequest } from "next/server";
import { r2SignedGet, isR2Configured } from "@/lib/ffmpeg-pipeline/r2";

// Stream on Node runtime (SigV4 signing uses node:crypto). No static caching.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Headers worth forwarding from R2 → client for correct playback/caching.
const PASS_THROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  // Re-join the catch-all segments; each segment is already URL-encoded by the
  // router, so decode per-segment to recover the real object key.
  const objectKey = key.map((s) => decodeURIComponent(s)).join("/");
  if (!objectKey) return new Response("Missing media key", { status: 400 });

  const range = req.headers.get("range") ?? undefined;

  // Build the upstream request. Two paths, both server-side (so the customer's
  // network never touches r2.dev):
  //   1. Full S3 creds present → signed GET to the S3 endpoint (no r2.dev rate
  //      limit). Preferred when configured.
  //   2. Public-bucket fallback → fetch the bucket's PUBLIC base URL directly.
  //      Needs ONLY R2_PUBLIC_BASE_URL (no account id / secret), and works from
  //      Vercel even when the *customer's* network DNS-blocks r2.dev. This is
  //      what unblocks playback/download in production today.
  let upstreamUrl: string;
  let upstreamHeaders: Record<string, string> = {};
  if (isR2Configured()) {
    const signed = r2SignedGet(objectKey, { range });
    upstreamUrl = signed.url;
    upstreamHeaders = signed.headers;
  } else {
    const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    if (!base) {
      return new Response(
        "Media storage not configured (no R2_PUBLIC_BASE_URL).",
        { status: 503 },
      );
    }
    upstreamUrl = `${base}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
    if (range) upstreamHeaders["range"] = range;
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });
  } catch {
    return new Response("Upstream storage unreachable", { status: 502 });
  }

  if (upstream.status === 404) return new Response("Not found", { status: 404 });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Storage error (${upstream.status})`, { status: 502 });
  }

  const headers = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Long-lived immutable cache — object keys are content-addressed (per render).
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  headers.set("accept-ranges", headers.get("accept-ranges") ?? "bytes");

  // ?download=1 → force a save dialog with a sensible filename.
  if (req.nextUrl.searchParams.get("download") === "1") {
    const name = objectKey.split("/").pop() || "video.mp4";
    headers.set("content-disposition", `attachment; filename="${name}"`);
  }

  return new Response(upstream.body, {
    status: upstream.status, // 200 full, 206 partial
    headers,
  });
}
