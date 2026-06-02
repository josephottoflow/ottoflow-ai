/**
 * VideoProvider abstraction (Phase 5).
 *
 * Lets the Video Pipeline consume any backend (Runway, Higgsfield, Veo,
 * Pexels stock fallback) via one shape. The route layer iterates a chain
 * in priority order — first configured provider that succeeds wins; any
 * caught failure falls through to the next provider. Pexels stock is
 * ALWAYS the last fallback so we never return an empty result.
 *
 * Why generic SceneResult instead of file blobs:
 *   Providers return URLs (their own CDN). The merge worker downloads them
 *   alongside narration + music in the same parallel I/O step that already
 *   exists in processVideoMerge. Returning blobs would force every provider
 *   to write through our worker which doesn't scale.
 */

export interface SceneRequest {
  /** Visual description of the scene — passed to text-to-video models. */
  prompt: string;
  /** Target clip duration in seconds. Provider may truncate or pad. */
  durationSec: number;
  /** Optional style hint (cinematic / ugc / minimal / etc). */
  style?: string;
  /** Output aspect ratio. TikTok = "9:16". */
  aspectRatio?: "9:16" | "16:9" | "1:1";
  /** Seed for deterministic generation when supported. */
  seed?: number;
}

export interface SceneResult {
  /** Direct MP4 (or M3U8 in some cases) URL the merge worker can fetch. */
  url: string;
  durationSec: number;
  width: number;
  height: number;
  /** Provider identifier — 'runway' | 'higgsfield' | 'pexels' | 'veo'. */
  provider: string;
  /** Approximate cost in USD for billing aggregation later. */
  costUsd?: number;
  /** Human-readable attribution (Pexels TOS, etc). */
  attribution?: string;
  /** Anything provider-specific the caller may want. */
  metadata?: Record<string, unknown>;
}

export interface VideoProvider {
  /** Stable identifier — matches `SceneResult.provider`. */
  name: string;
  /**
   * Is this provider's runtime dependency satisfied (env vars, etc)?
   * Called before each request so unconfigured providers skip cleanly.
   */
  isConfigured(): boolean;
  /**
   * Generate a single scene clip. THROWS on failure — the registry
   * catches and falls through to the next provider.
   */
  generateScene(request: SceneRequest): Promise<SceneResult>;
}

/** Thrown when no configured provider could produce a scene. */
export class AllProvidersExhaustedError extends Error {
  constructor(public readonly attempts: { provider: string; error: string }[]) {
    super(
      `All ${attempts.length} video providers failed: ${attempts
        .map((a) => `${a.provider}: ${a.error}`)
        .join("; ")}`,
    );
  }
}
