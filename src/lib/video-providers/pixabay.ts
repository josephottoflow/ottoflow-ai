/**
 * Pixabay Video Search.
 *
 * https://pixabay.com/api/docs/#api_videos
 * Auth: PIXABAY_API_KEY (free tier, 100 req/min).
 *
 * Returns a list of MP4 candidates. Used by Agent 4 (Multi-Source Search) as
 * one of four parallel sources. The agent picks final orientation/quality;
 * we just hand back everything that's playable.
 */
import type { ClipCandidate } from "@/lib/ffmpeg-pipeline/types";

const BASE = "https://pixabay.com/api/videos/";

export class PixabayNotConfiguredError extends Error {
  constructor() {
    super("PIXABAY_API_KEY not set");
  }
}

interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

interface PixabayVideoHit {
  id: number;
  pageURL: string;
  type: string;        // 'film'
  tags: string;
  duration: number;
  videos: {
    large?:  PixabayVideoFile;
    medium?: PixabayVideoFile;
    small?:  PixabayVideoFile;
    tiny?:   PixabayVideoFile;
  };
  user: string;
}

interface PixabaySearchResponse {
  total: number;
  totalHits: number;
  hits: PixabayVideoHit[];
}

export async function searchPixabay(
  query: string,
  opts: { perPage?: number; orientation?: "vertical" | "horizontal" | "all" } = {},
): Promise<ClipCandidate[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new PixabayNotConfiguredError();

  const url = new URL(BASE);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(opts.perPage ?? 20));
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("video_type", "film");
  // Pixabay's "orientation" is not directly supported — we filter post-hoc by
  // height > width when caller asked for vertical.

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Pixabay search failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as PixabaySearchResponse;

  return body.hits
    .map((hit) => {
      // Pick the highest resolution video file the hit ships with.
      const file =
        hit.videos.large ??
        hit.videos.medium ??
        hit.videos.small ??
        hit.videos.tiny;
      if (!file) return null;
      const candidate: ClipCandidate = {
        source: "pixabay",
        sourceId: String(hit.id),
        url: file.url,
        previewUrl: hit.videos.tiny?.url ?? hit.videos.small?.url ?? file.url,
        thumbnailUrl: file.thumbnail,
        width: file.width,
        height: file.height,
        durationSec: hit.duration,
        query,
        attribution: `${hit.user} via Pixabay`,
        metadata: { pageURL: hit.pageURL, tags: hit.tags },
      };
      return candidate;
    })
    .filter((c): c is ClipCandidate => c !== null)
    .filter((c) => {
      if (opts.orientation === "vertical")   return c.height > c.width;
      if (opts.orientation === "horizontal") return c.width  > c.height;
      return true;
    });
}
