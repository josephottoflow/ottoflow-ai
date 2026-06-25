/**
 * Platform-aware CTA library (Sprint 6).
 *
 * PURE data + a deterministic picker. Each platform has a small set of
 * idiomatic calls-to-action; `pickCta` selects one deterministically from a key
 * (so the same content reproduces the same CTA, but different content/platforms
 * vary — no identical reuse across platforms). Consumed ONLY in commercial_story
 * mode for the branded end-card text; the certified path is untouched.
 */
import type { Platform } from "./profiles";

export const PLATFORM_CTAS: Record<Platform, string[]> = {
  linkedin: ["Book a demo", "Learn more", "Talk to our team"],
  tiktok: ["Follow for more", "Try it today", "Watch part 2"],
  instagram_reels: ["Link in bio", "Save this", "Share with your team"],
  instagram_feed: ["Link in bio", "Save this post", "Tap to learn more"],
  facebook_reels: ["Learn More", "Try it free", "See how it works"],
  facebook_feed: ["Learn More", "Get started", "See how it works"],
  youtube_shorts: ["Subscribe", "Watch the full video", "Try it today"],
  youtube_standard: ["Subscribe", "Learn more", "Get started today"],
  x: ["See the thread", "Try it now", "Follow for more"],
};

/** Stable small hash → non-negative int (for deterministic, content-stable picks). */
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Pick a platform-idiomatic CTA. `key` (e.g. the content item id) makes it
 * deterministic per content while still varying across platforms/content.
 */
export function pickCta(platform: string, key = ""): string {
  const list = PLATFORM_CTAS[(platform as Platform)] ?? PLATFORM_CTAS.linkedin;
  return list[hash(`${platform}:${key}`) % list.length];
}
