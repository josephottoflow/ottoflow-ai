/**
 * Pexels Video Search — finds a topic-relevant stock MP4 for the Video
 * Pipeline so the rendered output actually matches the user's prompt
 * (instead of always showing the same placeholder clip).
 *
 * Returns a single MP4 URL plus attribution metadata. The pipeline's
 * `videoUrl` is set to this URL on the SSE `done` event, so the page's
 * <video> element streams it directly from Pexels' CDN.
 *
 * Free tier: 200 requests/hour, 20,000/month — well within our scale.
 *
 * API docs: https://www.pexels.com/api/documentation/#videos
 *
 * Strategy:
 *   1. Build candidate queries from the prompt:
 *      - Domain overrides (`startup` → `startup office team dark`, etc.)
 *      - Topic-keyword extraction (longest 3 content words)
 *      - Script hook fallback if provided
 *   2. Try each query as portrait (TikTok 9:16). If portrait yields no
 *      usable clip, retry as landscape so we always return something.
 *   3. Filter: 5–90s duration, MP4 file present, prefer HD (height ≥ 720).
 *   4. Return the first usable hit's best MP4 link.
 *
 * No file I/O — this runs on Vercel serverless where the filesystem is
 * read-only outside /tmp. We just return the CDN URL; the <video> element
 * streams it from Pexels directly.
 */

const PEXELS_BASE = "https://api.pexels.com";

export interface PexelsVideoFile {
  id: number;
  quality: string;       // "sd" | "hd" | "uhd"
  file_type: string;     // "video/mp4"
  width: number;
  height: number;
  link: string;          // direct MP4 URL
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;      // seconds
  url: string;           // Pexels page URL (for attribution)
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
}

export interface StockClip {
  url: string;            // direct MP4 link
  durationSec: number;
  width: number;
  height: number;
  photographer: string;   // for attribution
  pexelsPageUrl: string;
  query: string;          // which query matched (for logging)
  orientation: "portrait" | "landscape";
}

export class PexelsNotConfiguredError extends Error {
  constructor() {
    super("PEXELS_API_KEY not set");
  }
}

// ─── Domain keyword overrides — map common topic patterns to query plans ────
// Same strategy as the root project's PexelsClient but trimmed to query
// vocabularies that match TikTok-ad-style content. Each match returns a list
// of pre-baked queries known to surface good Pexels stock for that domain.
const TOPIC_OVERRIDES: { pattern: RegExp; queries: string[] }[] = [
  {
    pattern: /standing\s*desk|ergonomic|office\s*chair|posture|workstation/i,
    queries: [
      "ergonomic standing desk modern office",
      "home office workspace minimalist",
      "remote worker laptop posture",
      "modern desk setup product",
    ],
  },
  {
    pattern: /coffee|espresso|latte|barista|cafe/i,
    queries: [
      "coffee pour cinematic closeup",
      "barista espresso morning",
      "cafe interior modern minimal",
      "coffee beans roasting product",
    ],
  },
  {
    pattern: /skincare|beauty|cosmetic|serum|lotion/i,
    queries: [
      "skincare product application closeup",
      "beauty routine bathroom mirror",
      "cosmetics flat lay minimal",
      "serum bottle elegant lifestyle",
    ],
  },
  {
    pattern: /fitness|workout|gym|yoga|exercise|training/i,
    queries: [
      "gym workout motivation cinematic",
      "fitness training closeup",
      "yoga studio peaceful",
      "athlete running outdoor",
    ],
  },
  {
    pattern: /tech|software|saas|ai|automation|developer|coding/i,
    queries: [
      "developer coding screen dark",
      "software interface closeup",
      "data visualization modern",
      "tech startup team office",
    ],
  },
  {
    pattern: /finance|invest|money|stock|crypto|wealth|budget/i,
    queries: [
      "financial chart screen analysis",
      "investment portfolio modern",
      "money savings closeup",
      "stock market trader desk",
    ],
  },
  {
    pattern: /food|recipe|cook|kitchen|restaurant|chef/i,
    queries: [
      "food preparation chef closeup",
      "cooking kitchen modern",
      "restaurant plating cinematic",
      "ingredients flat lay overhead",
    ],
  },
  {
    pattern: /fashion|clothing|apparel|outfit|style/i,
    queries: [
      "fashion model studio portrait",
      "clothing closeup texture",
      "lifestyle outfit street",
      "wardrobe minimalist",
    ],
  },
  {
    pattern: /travel|vacation|hotel|flight|destination/i,
    queries: [
      "travel cinematic landscape",
      "hotel suite luxury",
      "destination aerial drone",
      "luggage airport modern",
    ],
  },
  {
    pattern: /home|furniture|decor|interior|kitchen|bedroom/i,
    queries: [
      "modern interior design minimalist",
      "furniture product closeup",
      "home decor lifestyle",
      "kitchen bright clean",
    ],
  },
  {
    pattern: /startup|entrepreneur|founder|launch/i,
    queries: [
      "startup office team modern",
      "entrepreneur laptop focused",
      "pitch presentation meeting",
      "founder writing notebook",
    ],
  },
  {
    pattern: /marketing|brand|content|social\s*media|advertising/i,
    queries: [
      "creative team brainstorm studio",
      "content creator phone camera",
      "social media scrolling closeup",
      "marketing strategy whiteboard",
    ],
  },
];

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "for",
  "of", "to", "in", "on", "at", "by", "with", "from", "into", "as", "this",
  "that", "these", "those", "your", "our", "their", "his", "her", "its",
  "second", "minute", "tiktok", "instagram", "ad", "video", "clip",
  "ending", "ends", "end", "discount", "off", "free", "buy", "shop",
  "click", "link", "bio",
]);

/** Extract up to 3 strongest content keywords from the prompt. */
function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  // Dedupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of tokens) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Build a prioritized list of search queries from prompt + optional hook.
 *
 * Video Pipeline v2 P1b — when explicit brand/topic context is provided,
 * those queries are prepended at HIGHEST priority. They reflect the user's
 * actual brand (passed straight from /api/generate or the worker) rather
 * than the 12 hand-tuned TOPIC_OVERRIDES regexes, which collectively cover
 * only a tiny slice of possible industries. The override + keyword layers
 * still run as fallbacks so legacy callers without brand context aren't
 * affected.
 */
// Phase 1B — VIDEO_VARIATION_AUDIT §P1.3. Fisher-Yates copy-shuffle; used to
// rotate domain-override query order and to pick among the top relevance hits
// instead of always taking the first.
function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickTop<T>(arr: readonly T[], topN = 3): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * Math.min(topN, arr.length))];
}

function buildQueries(
  prompt: string,
  hook?: string,
  ctx?: {
    brandIndustry?: string | null;
    topicTitle?: string | null;
    shotType?: string | null;
  },
): string[] {
  const queries: string[] = [];

  // 0. Brand/topic-aware queries (v2 P1b). When the caller has structured
  // brand context, these are tried BEFORE the regex overrides — they're
  // strictly more relevant because they reflect the real brand instead of
  // a pattern-matched generic category.
  const normalizedShot = ctx?.shotType
    ? ctx.shotType.toLowerCase().replace(/[_-]+/g, " ").trim()
    : null;
  if (ctx?.topicTitle) {
    const topicKws = extractKeywords(ctx.topicTitle);
    if (topicKws.length > 0) {
      const core = topicKws.slice(0, 2).join(" ");
      if (normalizedShot) {
        queries.push(`${core} ${normalizedShot} cinematic`);
      }
      queries.push(`${core} cinematic closeup`);
      if (ctx.brandIndustry) {
        queries.push(`${core} ${ctx.brandIndustry.toLowerCase()}`);
      }
    }
  }
  if (ctx?.brandIndustry) {
    const ind = ctx.brandIndustry.toLowerCase().trim();
    if (ind.length > 0) {
      const shotPart = normalizedShot ?? "closeup";
      queries.push(`${ind} ${shotPart} cinematic`);
      queries.push(`${ind} lifestyle modern`);
    }
  }

  // 1. Domain overrides (hand-tuned regex hits — middle layer).
  // Phase 1B (P1.3) — shuffled so the same domain doesn't always lead with
  // the same query (first-hit selection made every video in a domain open
  // on the identical stock clip).
  for (const { pattern, queries: q } of TOPIC_OVERRIDES) {
    if (pattern.test(prompt)) {
      queries.push(...shuffled(q));
      break; // one domain match is enough
    }
  }

  // 2. Keyword-derived queries
  const kws = extractKeywords(prompt);
  if (kws.length >= 2) {
    queries.push(`${kws[0]} ${kws[1]} cinematic`);
    queries.push(`${kws[0]} closeup product`);
    queries.push(`${kws[1]} lifestyle modern`);
  } else if (kws.length === 1) {
    queries.push(`${kws[0]} cinematic`);
    queries.push(`${kws[0]} modern lifestyle`);
  }

  // 3. Hook-derived fallback if provided (script hooks often contain
  // visual hints like "still coding hunched over")
  if (hook) {
    const hookKws = extractKeywords(hook);
    if (hookKws.length > 0) {
      queries.push(hookKws.slice(0, 2).join(" "));
    }
  }

  // 4. Dedupe (preserve order)
  const seen = new Set<string>();
  return queries.filter((q) => {
    if (seen.has(q)) return false;
    seen.add(q);
    return true;
  });
}

/** Search Pexels videos for one query at a given orientation. */
async function searchOnce(
  apiKey: string,
  query: string,
  orientation: "portrait" | "landscape",
  perPage = 5,
): Promise<PexelsVideo[]> {
  const url = new URL(`${PEXELS_BASE}/videos/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("size", "medium"); // Full HD, avoids 4K bandwidth

  const res = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as PexelsSearchResponse;
  return data.videos ?? [];
}

/** Filter a video list down to usable MP4 clips with reasonable duration. */
function filterUsable(videos: PexelsVideo[]): PexelsVideo[] {
  return videos.filter(
    (v) =>
      v.duration >= 5 &&
      v.duration <= 90 &&
      v.video_files.some(
        (f) => f.file_type === "video/mp4" && f.height >= 360,
      ),
  );
}

/** Pick the best MP4 file from a video — prefer HD, vertical-first. */
function pickBestFile(
  video: PexelsVideo,
  preferPortrait: boolean,
): PexelsVideoFile | null {
  const mp4s = video.video_files.filter(
    (f) => f.file_type === "video/mp4" && Math.max(f.width, f.height) <= 1920,
  );
  if (mp4s.length === 0) return null;

  // Score: portrait orientation match + height (higher = better, capped at 1080)
  const scored = mp4s
    .map((f) => {
      const isPortrait = f.height > f.width;
      const portraitBonus = preferPortrait === isPortrait ? 1000 : 0;
      const hdBonus = Math.min(f.height, 1080);
      return { file: f, score: portraitBonus + hdBonus };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.file ?? null;
}

// ─── Pexels Photos (used as Runway promptImage seeds) ──────────────────────
// Runway Gen-4 is image-to-video — it needs a starter image. We pull a
// topic-relevant Pexels photo at the same aspect ratio as the target clip.

export interface PexelsPhotoLite {
  id: number;
  width: number;
  height: number;
  url: string;          // Pexels page URL (for attribution)
  src: string;          // direct image URL
  photographer: string;
}

interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  portrait: string;
  landscape: string;
  tiny: string;
}

interface PexelsPhotoResp {
  id: number;
  width: number;
  height: number;
  url: string;
  src: PexelsPhotoSrc;
  photographer: string;
}

interface PexelsPhotoSearchResp {
  photos: PexelsPhotoResp[];
}

export async function findStockPhotoByPrompt(input: {
  prompt: string;
  orientation?: "portrait" | "landscape";
  // v2 P1b — parity with findStockVideoByPrompt. Currently not wired from
  // the Runway provider (would require threading SceneRequest), but
  // future-proofs the signature so we can pass context later without
  // another breaking change.
  brandIndustry?: string | null;
  topicTitle?: string | null;
  shotType?: string | null;
}): Promise<PexelsPhotoLite | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new PexelsNotConfiguredError();
  const orientation = input.orientation ?? "portrait";
  const queries = buildQueries(input.prompt, undefined, {
    brandIndustry: input.brandIndustry,
    topicTitle: input.topicTitle,
    shotType: input.shotType,
  });
  for (const q of queries) {
    try {
      const url = new URL(`${PEXELS_BASE}/v1/search`);
      url.searchParams.set("query", q);
      url.searchParams.set("per_page", "5");
      url.searchParams.set("orientation", orientation);
      url.searchParams.set("size", "large");
      const res = await fetch(url.toString(), {
        headers: { Authorization: apiKey },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as PexelsPhotoSearchResp;
      // Phase 1B (P1.3) — random among top 3, not always the first hit.
      const photo = pickTop(data.photos ?? []);
      if (!photo) continue;
      return {
        id: photo.id,
        width: photo.width,
        height: photo.height,
        url: photo.url,
        src:
          orientation === "portrait"
            ? photo.src.portrait
            : photo.src.landscape,
        photographer: photo.photographer,
      };
    } catch {
      continue;
    }
  }
  return null;
}

interface FindOpts {
  prompt: string;
  hook?: string;
  targetSeconds?: number;
  // Video Pipeline v2 P1b — optional structured brand/topic context for
  // query construction. When provided, takes precedence over keyword
  // extraction from `prompt` (which is brittle for industries outside
  // the 12 hardcoded TOPIC_OVERRIDES regexes).
  brandIndustry?: string | null;
  topicTitle?: string | null;
  shotType?: string | null;
}

/**
 * Find a single stock MP4 that matches the prompt.
 * Returns null if no usable clip found (caller falls back to placeholder).
 */
export async function findStockVideoByPrompt(
  opts: FindOpts,
): Promise<StockClip | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new PexelsNotConfiguredError();

  const queries = buildQueries(opts.prompt, opts.hook, {
    brandIndustry: opts.brandIndustry,
    topicTitle: opts.topicTitle,
    shotType: opts.shotType,
  });
  if (queries.length === 0) return null;

  // Try portrait first (9:16 TikTok), then landscape for each query.
  for (const query of queries) {
    for (const orientation of ["portrait", "landscape"] as const) {
      try {
        const videos = await searchOnce(apiKey, query, orientation);
        const usable = filterUsable(videos);
        if (usable.length === 0) continue;

        // Phase 1B (P1.3) — Pexels orders by relevance, but always taking
        // the first hit meant identical topic → identical clip. Random
        // among the top 3 keeps relevance while breaking determinism.
        const video = pickTop(usable);
        if (!video) continue;
        const file = pickBestFile(video, orientation === "portrait");
        if (!file) continue;

        return {
          url: file.link,
          durationSec: video.duration,
          width: file.width,
          height: file.height,
          photographer: video.user?.name ?? "Unknown",
          pexelsPageUrl: video.url,
          query,
          orientation,
        };
      } catch {
        // Try next query on any error.
        continue;
      }
    }
  }

  return null;
}
