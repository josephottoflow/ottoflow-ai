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

import { fetchWithTimeout } from "@/lib/http";

const PEXELS_BASE = "https://api.pexels.com";

// Royalty-Free is the primary render path: a single stock search normally
// returns in <1s. 15s bounds a hung Pexels request so one slow query can't
// block the whole per-scene query loop (each caller already `continue`s past a
// thrown/aborted search to the next query).
const PEXELS_TIMEOUT_MS = 15_000;

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
  image?: string;        // poster frame (Pexels returns this; used as thumbnail)
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
  id: number;             // Pexels video id — used for cross-scene de-duplication
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

/** Test-only alias so scripts/validate-scene-relevance.ts can exercise the
 *  REAL query construction without a network call. Not for production use. */
export function __testBuildQueries(
  ...args: Parameters<typeof buildQueries>
): string[] {
  return buildQueries(...args);
}

function buildQueries(
  prompt: string,
  hook?: string,
  ctx?: {
    brandIndustry?: string | null;
    topicTitle?: string | null;
    shotType?: string | null;
    searchQuery?: string | null;
  },
): string[] {
  const queries: string[] = [];

  // -1. Sprint 46 (Scene Relevance) — the scene's LITERAL semantic search
  // phrase (subject + action + setting, from the story agent's structured
  // fields). When present it leads, and the pollution-prone layers below
  // (regex domain overrides + raw-prompt keyword extraction) are SKIPPED:
  // they extract from the flattened cinematic prompt, whose wardrobe/lighting
  // tokens produced off-topic footage ("reusable coffee cup" → /coffee/
  // override → coffee-roasting b-roll). Topic/industry stay as fallbacks.
  const sq = ctx?.searchQuery?.trim().toLowerCase() || null;
  if (sq) {
    queries.push(sq);
    queries.push(`${sq} cinematic`);
    const sqWords = sq.split(/\s+/);
    if (sqWords.length > 2) queries.push(sqWords.slice(0, 2).join(" "));
  }

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

  // 1-3. Prompt-derived layers — SKIPPED when a semantic searchQuery exists
  // (they mine the flattened cinematic prompt, which is exactly the pollution
  // source the searchQuery replaces).
  if (!sq) {
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

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { Authorization: apiKey } },
    PEXELS_TIMEOUT_MS,
  );
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
      const res = await fetchWithTimeout(
        url.toString(),
        { headers: { Authorization: apiKey } },
        PEXELS_TIMEOUT_MS,
      );
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
  /** Sprint 46 — literal semantic search phrase for the shot (leads the query
   *  list and disables the pollution-prone prompt-keyword layers). */
  searchQuery?: string | null;
  /**
   * Pexels video ids used by earlier scenes in this render. Excluded from
   * selection so two scenes never get the identical clip. If exclusion would
   * empty a query's candidate pool, the unfiltered pool is used as a last
   * resort — a relevant (even if repeated) clip beats failing the scene.
   */
  excludeIds?: number[];
  /**
   * Sprint 48 (Twin-Clip fix) — photographer names of clips already used by
   * earlier scenes in this render. Pexels creators upload SERIES: two
   * different video ids from the same shoot look near-identical (verified in
   * prod render 917794e4: scene-1 and scene-2 were distinct files of the same
   * model at the same desk — the opening read as a stuck/repeated shot). A
   * different-id-same-creator clip passes the id de-dup but not the eye.
   * Soft preference, never a hard block: unused-creator candidates win; a
   * same-creator (but new) clip is the tier-2 fallback; an outright repeated
   * clip stays the absolute last resort.
   */
  excludeCreators?: string[];
  /**
   * Sprint 49 (Subject-Count Consistency) — how many people the scene's
   * storyboard plans (0 or 1 for the single-protagonist commercial arc).
   * When ≤ 1, candidates whose Pexels page slug names MULTIPLE people
   * (couple/group/team/friends/…, verified defect: prod e009c7fb scene 5
   * returned a couple walking for a single-protagonist story) are
   * soft-rejected: preferred away whenever a subject-clean alternative
   * exists, kept as a graceful fallback tier otherwise. null/undefined →
   * no subject filtering (legacy behavior).
   */
  subjectCount?: number | null;
}

/** Sprint 49 — slug words that deterministically indicate 2+ people on
 *  screen. Matched as WHOLE hyphen-delimited slug words from the Pexels page
 *  URL (e.g. …/video/a-couple-walking-in-the-park-8967543/), never as
 *  substrings — "businessmen" is NOT matched by "men"… it has its own entry.
 *  Conservative by design: false positives cost a better-ranked clip, false
 *  negatives cost immersion, and this list only ever demotes, never blocks. */
const MULTI_SUBJECT_SLUG_WORDS = new Set([
  "couple", "couples", "group", "groups", "team", "teams", "meeting",
  "friends", "family", "families", "crowd", "crowds", "colleagues",
  "coworkers", "people", "men", "women", "boys", "girls", "kids",
  "children", "students", "partners", "businessmen", "businesswomen",
  "together", "teamwork",
]);

/** True when the Pexels page URL's slug names multiple people. */
function slugNamesMultiplePeople(pageUrl: string | undefined): boolean {
  if (!pageUrl) return false;
  const slug = (pageUrl.split("/video/")[1] ?? pageUrl)
    .toLowerCase()
    .replace(/\/+$/, "");
  for (const word of slug.split(/[-/]+/)) {
    if (MULTI_SUBJECT_SLUG_WORDS.has(word)) return true;
  }
  return false;
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
    searchQuery: opts.searchQuery,
  });
  if (queries.length === 0) return null;

  const exclude = new Set(opts.excludeIds ?? []);
  // Sprint 48 — creators (photographers) already used in this render, for the
  // twin-clip tier. Lower-cased for case-insensitive matching.
  const usedCreators = new Set(
    (opts.excludeCreators ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );

  // Duplicate-scene fix (verified in prod render 6624cd5a: scene-4.mp4 and
  // scene-6.mp4 were byte-identical). Previously, when every hit for the FIRST
  // query was already used in this render, we repeated a used clip immediately
  // instead of trying the remaining queries — which usually DO hold fresh
  // footage. Now: exhausted pools are remembered as a true last resort, tried
  // only after every query/orientation failed to yield an unused clip.
  let lastResort: {
    pool: PexelsVideo[];
    orientation: "portrait" | "landscape";
    query: string;
  } | null = null;
  // Sprint 48 (Twin-Clip fix) — tier-2 fallback: a NEW clip from an
  // already-used creator. Better than repeating a clip outright, worse than a
  // new clip from a new creator (same-shoot footage looks near-identical).
  let creatorRepeat: {
    pool: PexelsVideo[];
    orientation: "portrait" | "landscape";
    query: string;
  } | null = null;
  // Sprint 49 (Subject-Count) — tier-3 fallback: a NEW clip whose slug names
  // multiple people while the scene plans ≤1. A couple/group on screen breaks
  // the single-protagonist story harder than a creator repeat, so this sits
  // BELOW creatorRepeat but still above repeating a clip outright.
  const subjectFilterOn =
    typeof opts.subjectCount === "number" && opts.subjectCount <= 1;
  let subjectViolation: {
    pool: PexelsVideo[];
    orientation: "portrait" | "landscape";
    query: string;
  } | null = null;

  const toClip = (
    video: PexelsVideo,
    query: string,
    orientation: "portrait" | "landscape",
  ): StockClip | null => {
    const file = pickBestFile(video, orientation === "portrait");
    if (!file) return null;
    return {
      id: video.id,
      url: file.link,
      durationSec: video.duration,
      width: file.width,
      height: file.height,
      photographer: video.user?.name ?? "Unknown",
      pexelsPageUrl: video.url,
      query,
      orientation,
    };
  };

  // Try portrait first (9:16 TikTok), then landscape for each query.
  for (const query of queries) {
    for (const orientation of ["portrait", "landscape"] as const) {
      try {
        const videos = await searchOnce(apiKey, query, orientation);
        const usable = filterUsable(videos);
        if (usable.length === 0) continue;

        // De-dup: only clips not already used in this render. If every hit
        // for this query was used, remember the pool and try the NEXT query —
        // a different relevant clip beats repeating one ("no duplicated
        // scenes"). Repeats remain possible only as the absolute last resort.
        const fresh = usable.filter((v) => !exclude.has(v.id));
        if (fresh.length === 0) {
          if (!lastResort) lastResort = { pool: usable, orientation, query };
          continue;
        }

        // Sprint 49 (Subject-Count) — when the scene plans ≤1 person, demote
        // candidates whose slug names multiple people (couple/group/team/…).
        // Verified defect: prod e009c7fb scene 5 cut to a COUPLE in a
        // single-protagonist story. Soft: a violating pool is remembered as
        // tier-3; selection proceeds with subject-clean candidates.
        const subjectOk = subjectFilterOn
          ? fresh.filter((v) => !slugNamesMultiplePeople(v.url))
          : fresh;
        if (subjectOk.length === 0) {
          if (!subjectViolation) subjectViolation = { pool: fresh, orientation, query };
          continue;
        }

        // Sprint 48 (Twin-Clip fix) — prefer clips from creators no earlier
        // scene used: same-creator "series" clips are visual twins even with
        // distinct video ids (prod 917794e4 scenes 1+2). If this query only
        // has same-creator footage, remember it as tier-2 and try the next
        // query first.
        const freshNewCreator = subjectOk.filter(
          (v) => !usedCreators.has((v.user?.name ?? "").trim().toLowerCase()),
        );
        if (freshNewCreator.length === 0) {
          if (!creatorRepeat) creatorRepeat = { pool: subjectOk, orientation, query };
          continue;
        }

        // Phase 1B (P1.3) — Pexels orders by relevance, but always taking
        // the first hit meant identical topic → identical clip. Random
        // among the top 3 keeps relevance while breaking determinism.
        const video = pickTop(freshNewCreator);
        if (!video) continue;
        const clip = toClip(video, query, orientation);
        if (clip) return clip;
      } catch {
        // Try next query on any error.
        continue;
      }
    }
  }

  // Sprint 48 tier-2: every query either had zero unused clips or only clips
  // from already-used creators. A NEW clip from a used creator still beats
  // repeating a clip outright.
  if (creatorRepeat) {
    const video = pickTop(creatorRepeat.pool);
    if (video) {
      const clip = toClip(video, creatorRepeat.query, creatorRepeat.orientation);
      if (clip) return clip;
    }
  }

  // Sprint 49 tier-3: only multi-person candidates were available for every
  // query. A NEW (if crowded) clip still beats repeating one — graceful
  // degradation, never fail the scene because of the subject rule.
  if (subjectViolation) {
    const video = pickTop(subjectViolation.pool);
    if (video) {
      const clip = toClip(video, subjectViolation.query, subjectViolation.orientation);
      if (clip) return clip;
    }
  }

  // Every query's pool was already fully used in this render (tiny topic
  // pools). A repeated but relevant clip still beats failing the scene —
  // Pexels is the hard fallback.
  if (lastResort) {
    const video = pickTop(lastResort.pool);
    if (video) {
      const clip = toClip(video, lastResort.query, lastResort.orientation);
      if (clip) return clip;
    }
  }

  return null;
}

/** A ranked alternative clip for the Scene Inspector (Sprint 39). Carries only
 *  HONEST signals the render engine actually computes — no fabricated scores. */
export interface StockCandidate {
  id: number;
  provider: "pexels";
  /** Direct MP4 — used both as the in-card preview and the chosen clip. */
  url: string;
  thumbnailUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  photographer: string;
  pexelsPageUrl: string;
  /** The query that surfaced it — the honest "why we found this". */
  query: string;
  /** The render engine's OWN ranking signal: orientation-fit (+1000) + HD height. */
  score: number;
}

/**
 * Return the RANKED candidate pool the render engine would choose among, for one
 * scene prompt. Reuses the SAME buildQueries → searchOnce → filterUsable →
 * pickBestFile path as findStockVideoByPrompt() (which returns only the top
 * pick), so the candidates a customer sees ARE the pool the renderer selects
 * from — no second/duplicate search engine. Search-only: no download, no R2,
 * no render, no enqueue.
 */
export async function searchStockVideoCandidates(
  opts: FindOpts & { limit?: number; preferPortrait?: boolean },
): Promise<StockCandidate[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new PexelsNotConfiguredError();

  const limit = opts.limit ?? 8;
  const preferPortrait = opts.preferPortrait ?? true;
  const queries = buildQueries(opts.prompt, opts.hook, {
    brandIndustry: opts.brandIndustry,
    topicTitle: opts.topicTitle,
    shotType: opts.shotType,
    searchQuery: opts.searchQuery,
  });
  const exclude = new Set(opts.excludeIds ?? []);
  const byId = new Map<number, StockCandidate>();

  const orientations: ("portrait" | "landscape")[] = preferPortrait
    ? ["portrait", "landscape"]
    : ["landscape", "portrait"];

  for (const query of queries) {
    if (byId.size >= limit * 3) break; // enough to rank a good top-N
    for (const orientation of orientations) {
      let videos: PexelsVideo[];
      try {
        videos = await searchOnce(apiKey, query, orientation);
      } catch {
        continue; // try next orientation/query on any error
      }
      for (const v of filterUsable(videos)) {
        if (exclude.has(v.id) || byId.has(v.id)) continue;
        const file = pickBestFile(v, orientation === "portrait");
        if (!file) continue;
        const isPortrait = file.height > file.width;
        const score = (preferPortrait === isPortrait ? 1000 : 0) + Math.min(file.height, 1080);
        byId.set(v.id, {
          id: v.id,
          provider: "pexels",
          url: file.link,
          thumbnailUrl: v.image ?? null,
          durationSec: v.duration,
          width: file.width,
          height: file.height,
          orientation,
          photographer: v.user?.name ?? "Unknown",
          pexelsPageUrl: v.url,
          query,
          score,
        });
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
