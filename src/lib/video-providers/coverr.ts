/**
 * Coverr — free 4K stock with a public REST API.
 *
 * https://coverr.co/api
 * Auth: COVERR_API_KEY (free tier).
 *
 * Returns CC0-licensed MP4s. Reasonable mix of cinematic-looking footage,
 * skews aesthetic / minimal — fits well with the "moody" + "cinematic"
 * VisualStyle picks from the Scene Planner.
 */
import type { ClipCandidate } from "@/lib/ffmpeg-pipeline/types";

const BASE = "https://api.coverr.co";

export class CoverrNotConfiguredError extends Error {
  constructor() {
    super("COVERR_API_KEY not set");
  }
}

interface CoverrVideo {
  id: string;
  title: string;
  poster: string;
  // Coverr exposes a `urls` map keyed by resolution.
  urls?: {
    mp4?:           string;
    mp4_preview?:   string;
    mp4_download?:  string;
    mp4_hd?:        string;
  };
  duration?: number;
  width?: number;
  height?: number;
  tags?: string[];
}

interface CoverrSearchResponse {
  total: number;
  page: number;
  hits: CoverrVideo[];
}

export async function searchCoverr(
  query: string,
  opts: { limit?: number } = {},
): Promise<ClipCandidate[]> {
  const key = process.env.COVERR_API_KEY;
  if (!key) throw new CoverrNotConfiguredError();

  const url = new URL(`${BASE}/videos`);
  url.searchParams.set("query", query);
  url.searchParams.set("page_size", String(opts.limit ?? 12));
  url.searchParams.set("urls", "true");

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": key, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Coverr search failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as CoverrSearchResponse;

  return body.hits
    .map<ClipCandidate | null>((v) => {
      const directUrl =
        v.urls?.mp4_download ?? v.urls?.mp4_hd ?? v.urls?.mp4 ?? null;
      if (!directUrl) return null;
      return {
        source: "coverr",
        sourceId: v.id,
        url: directUrl,
        previewUrl: v.urls?.mp4_preview ?? directUrl,
        thumbnailUrl: v.poster,
        width: v.width ?? 1920,
        height: v.height ?? 1080,
        durationSec: v.duration ?? 10,
        query,
        attribution: `${v.title} via Coverr (CC0)`,
        metadata: { tags: v.tags ?? [] },
      };
    })
    .filter((c): c is ClipCandidate => c !== null);
}
