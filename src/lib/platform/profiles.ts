/**
 * Platform Agent (Video V1.1 — Sprint 2).
 *
 * Deterministic, LLM-free config: the ROOT of the V1.1 planning layer. Given a
 * selected platform it emits three constraint bundles —
 *   • video   (aspect, safe zones, duration, scene count, MAX scene duration, caption density, CTA length)
 *   • content (post/headline/CTA length, hashtag count, reading time)
 *   • story   (hook intensity, pacing, scene complexity, conversion style)
 *
 * These parameterize content generation and (Sprint 3) the Story Agent. This
 * module is PURE DATA + helpers — it imports nothing from the render path and is
 * not yet wired into any route, so adding it cannot affect the certified V1
 * render (additive, zero runtime impact until a caller opts in).
 *
 * HARD RULE: no scene may exceed MAX_SCENE_DURATION_SEC (8s). Enforced here
 * (per-profile maxSceneDurationSec ≤ 8 + clampSceneDurationSec()), in the Story
 * layer (buildVideoStrategy), and at the provider backstop (seedanceDuration).
 */

/** Absolute ceiling for ANY scene, every platform. Impossible-to-bypass cap. */
export const MAX_SCENE_DURATION_SEC = 8;

export type Platform =
  | "tiktok"
  | "instagram_reels"
  | "instagram_feed"
  | "youtube_shorts"
  | "youtube_standard"
  | "facebook_reels"
  | "facebook_feed"
  | "linkedin"
  | "x";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface SafeZones {
  /** Fractions of the frame to keep clear of on-screen text/UI chrome. */
  topPct: number;
  bottomPct: number;
  rightPct: number;
}

export interface PlatformVideoConstraints {
  aspect: AspectRatio;
  safeZones: SafeZones;
  /** [min, max] target total video length (seconds). */
  targetDurationSec: [number, number];
  /** [min, max] scene count. */
  sceneCount: [number, number];
  /** Per-scene hard ceiling — always ≤ MAX_SCENE_DURATION_SEC. */
  maxSceneDurationSec: number;
  /** How often captions appear: "high" = every scene, "medium" = key beats. */
  captionDensity: "high" | "medium" | "low";
  /** Max CTA characters (on-screen). */
  ctaLengthChars: number;
}

export interface PlatformContentConstraints {
  /** Max post/caption characters (visible-before-fold guidance in comment). */
  postLengthChars: number;
  headlineLengthChars: number;
  ctaLengthChars: number;
  hashtagCount: [number, number];
  /** Target reading time of the post copy (seconds). */
  readingTimeSec: number;
  /** Max characters per on-screen caption line (matches wrapCaption ≈ 24). */
  captionMaxCharsPerLine: number;
}

export interface PlatformStoryConstraints {
  /** Higher = faster, harder pattern-interrupt hook. */
  hookIntensity: "high" | "medium" | "low";
  pacing: "fast" | "moderate" | "slow";
  sceneComplexity: "simple" | "moderate" | "rich";
  conversionStyle: "soft" | "direct" | "authority";
  /** Hook must land by this many seconds. */
  hookBySec: number;
}

export interface PlatformProfile {
  id: Platform;
  label: string;
  video: PlatformVideoConstraints;
  content: PlatformContentConstraints;
  story: PlatformStoryConstraints;
}

const VERTICAL_SAFE: SafeZones = { topPct: 0.1, bottomPct: 0.15, rightPct: 0.12 };
const FLAT_SAFE: SafeZones = { topPct: 0.06, bottomPct: 0.1, rightPct: 0.04 };

export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    video: { aspect: "9:16", safeZones: VERTICAL_SAFE, targetDurationSec: [15, 34], sceneCount: [4, 6], maxSceneDurationSec: 7, captionDensity: "high", ctaLengthChars: 24 },
    content: { postLengthChars: 2200, headlineLengthChars: 100, ctaLengthChars: 24, hashtagCount: [3, 5], readingTimeSec: 8, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "high", pacing: "fast", sceneComplexity: "simple", conversionStyle: "soft", hookBySec: 3 },
  },
  instagram_reels: {
    id: "instagram_reels",
    label: "Instagram Reels",
    video: { aspect: "9:16", safeZones: VERTICAL_SAFE, targetDurationSec: [15, 30], sceneCount: [4, 6], maxSceneDurationSec: 7, captionDensity: "high", ctaLengthChars: 24 },
    content: { postLengthChars: 2200, headlineLengthChars: 125, ctaLengthChars: 24, hashtagCount: [5, 10], readingTimeSec: 10, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "high", pacing: "fast", sceneComplexity: "moderate", conversionStyle: "soft", hookBySec: 3 },
  },
  instagram_feed: {
    id: "instagram_feed",
    label: "Instagram Feed",
    video: { aspect: "1:1", safeZones: FLAT_SAFE, targetDurationSec: [15, 30], sceneCount: [4, 6], maxSceneDurationSec: 7, captionDensity: "medium", ctaLengthChars: 24 },
    content: { postLengthChars: 2200, headlineLengthChars: 125, ctaLengthChars: 24, hashtagCount: [5, 10], readingTimeSec: 12, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "medium", pacing: "moderate", sceneComplexity: "moderate", conversionStyle: "soft", hookBySec: 3 },
  },
  youtube_shorts: {
    id: "youtube_shorts",
    label: "YouTube Shorts",
    video: { aspect: "9:16", safeZones: VERTICAL_SAFE, targetDurationSec: [20, 40], sceneCount: [5, 7], maxSceneDurationSec: 8, captionDensity: "medium", ctaLengthChars: 30 },
    content: { postLengthChars: 100, headlineLengthChars: 100, ctaLengthChars: 30, hashtagCount: [3, 5], readingTimeSec: 8, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "high", pacing: "fast", sceneComplexity: "moderate", conversionStyle: "direct", hookBySec: 2 },
  },
  youtube_standard: {
    id: "youtube_standard",
    label: "YouTube Standard",
    video: { aspect: "16:9", safeZones: FLAT_SAFE, targetDurationSec: [30, 90], sceneCount: [5, 8], maxSceneDurationSec: 8, captionDensity: "medium", ctaLengthChars: 40 },
    content: { postLengthChars: 5000, headlineLengthChars: 100, ctaLengthChars: 40, hashtagCount: [3, 5], readingTimeSec: 30, captionMaxCharsPerLine: 28 },
    story: { hookIntensity: "medium", pacing: "moderate", sceneComplexity: "rich", conversionStyle: "authority", hookBySec: 5 },
  },
  facebook_reels: {
    id: "facebook_reels",
    label: "Facebook Reels",
    video: { aspect: "9:16", safeZones: VERTICAL_SAFE, targetDurationSec: [15, 45], sceneCount: [4, 6], maxSceneDurationSec: 7, captionDensity: "high", ctaLengthChars: 30 },
    content: { postLengthChars: 400, headlineLengthChars: 80, ctaLengthChars: 30, hashtagCount: [3, 5], readingTimeSec: 10, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "high", pacing: "fast", sceneComplexity: "moderate", conversionStyle: "direct", hookBySec: 3 },
  },
  facebook_feed: {
    id: "facebook_feed",
    label: "Facebook Feed",
    video: { aspect: "1:1", safeZones: FLAT_SAFE, targetDurationSec: [15, 45], sceneCount: [4, 6], maxSceneDurationSec: 7, captionDensity: "medium", ctaLengthChars: 30 },
    content: { postLengthChars: 400, headlineLengthChars: 80, ctaLengthChars: 30, hashtagCount: [0, 2], readingTimeSec: 12, captionMaxCharsPerLine: 26 },
    story: { hookIntensity: "medium", pacing: "moderate", sceneComplexity: "moderate", conversionStyle: "direct", hookBySec: 3 },
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    video: { aspect: "16:9", safeZones: FLAT_SAFE, targetDurationSec: [30, 60], sceneCount: [5, 7], maxSceneDurationSec: 8, captionDensity: "medium", ctaLengthChars: 40 },
    content: { postLengthChars: 3000, headlineLengthChars: 140, ctaLengthChars: 40, hashtagCount: [3, 5], readingTimeSec: 25, captionMaxCharsPerLine: 28 },
    story: { hookIntensity: "medium", pacing: "slow", sceneComplexity: "rich", conversionStyle: "authority", hookBySec: 5 },
  },
  x: {
    id: "x",
    label: "X",
    video: { aspect: "16:9", safeZones: FLAT_SAFE, targetDurationSec: [15, 45], sceneCount: [4, 6], maxSceneDurationSec: 6, captionDensity: "low", ctaLengthChars: 30 },
    content: { postLengthChars: 280, headlineLengthChars: 80, ctaLengthChars: 30, hashtagCount: [1, 2], readingTimeSec: 6, captionMaxCharsPerLine: 24 },
    story: { hookIntensity: "high", pacing: "moderate", sceneComplexity: "moderate", conversionStyle: "direct", hookBySec: 2 },
  },
};

/** Resolve a platform profile; falls back to LinkedIn (the certified default). */
export function getPlatformProfile(platform?: string | null): PlatformProfile {
  if (platform && platform in PLATFORM_PROFILES) {
    return PLATFORM_PROFILES[platform as Platform];
  }
  return PLATFORM_PROFILES.linkedin;
}

/**
 * Clamp a requested scene duration to the platform ceiling AND the absolute
 * 8s hard rule. Layer 1 of the ≤8s enforcement (impossible to bypass).
 */
export function clampSceneDurationSec(requestedSec: number, profile: PlatformProfile): number {
  const ceiling = Math.min(profile.video.maxSceneDurationSec, MAX_SCENE_DURATION_SEC);
  if (!Number.isFinite(requestedSec)) return ceiling;
  return Math.max(1, Math.min(requestedSec, ceiling));
}
