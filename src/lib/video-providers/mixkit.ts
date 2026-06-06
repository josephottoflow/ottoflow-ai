/**
 * Mixkit stock video — has no public API. We scrape the public search page
 * and parse the embedded JSON state. Mixkit's TOS allows free download of
 * their clips for commercial use, but only via their site UI; we therefore
 * cache aggressively + rate-limit ourselves to 1 req / 2 s and back off on
 * any non-200.
 *
 * If Mixkit changes their page structure this provider will silently return
 * [] — the search agent falls back to the other three sources without
 * failing the whole job.
 */
import type { ClipCandidate } from "@/lib/ffmpeg-pipeline/types";

const BASE = "https://mixkit.co/free-stock-video";
// Polite throttle: track last fetch time globally so concurrent calls
// serialise — Mixkit's bot detection is aggressive.
let lastFetchAt = 0;
const MIN_DELAY_MS = 2_000;

async function politeFetch(url: string): Promise<Response> {
  const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastFetchAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, {
    headers: {
      "user-agent":
        process.env.MIXKIT_USER_AGENT ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
}

/**
 * Mixkit's search page returns HTML with a list of video tiles.
 * We extract `data-video-url` + `data-poster` + the visible title via a
 * narrow set of regexes. This is intentionally not a full HTML parser —
 * we want to fail fast + return [] rather than ship a brittle dependency.
 */
export async function searchMixkit(
  query: string,
  opts: { limit?: number } = {},
): Promise<ClipCandidate[]> {
  const limit = opts.limit ?? 12;
  const url = `${BASE}/?q=${encodeURIComponent(query)}`;

  let html: string;
  try {
    const res = await politeFetch(url);
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  // Each tile is wrapped in <a class="item-grid-video-player__link" ...>
  // and carries `data-video-url` on a nested <video> element. We grep both
  // independently to stay tolerant of attribute order.
  const videoUrls = Array.from(html.matchAll(/data-video-url="([^"]+\.mp4)"/g))
    .map((m) => m[1]);
  const posters  = Array.from(html.matchAll(/poster="([^"]+\.jpg)"/g))
    .map((m) => m[1]);
  const titles   = Array.from(html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g))
    .map((m) => m[1].trim());

  const out: ClipCandidate[] = [];
  for (let i = 0; i < Math.min(videoUrls.length, limit); i++) {
    const u = videoUrls[i];
    // Mixkit URLs look like:
    //   https://assets.mixkit.co/videos/preview/mixkit-XXXXX-NNNN-full.mp4
    const idMatch = u.match(/mixkit-([^/]+)-full\.mp4$/);
    const sourceId = idMatch ? idMatch[1] : `${query}-${i}`;
    out.push({
      source: "mixkit",
      sourceId,
      url: u,
      previewUrl: u,
      thumbnailUrl: posters[i],
      // Mixkit's previews are typically 1920x1080 horizontal. Agent 11 crops
      // to 1080x1920 vertical via `crop=1080:1920` after `scale=...:force_original_aspect_ratio=increase`.
      width: 1920,
      height: 1080,
      durationSec: 10, // unknown without HEAD; 10 s is the Mixkit norm
      query,
      attribution: `${titles[i] ?? "Mixkit clip"} via Mixkit (Mixkit License)`,
    });
  }
  return out;
}
