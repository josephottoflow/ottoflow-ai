/**
 * Pexels stock-video provider — fallback when AI generation isn't
 * available or fails. Wraps the existing findStockVideoByPrompt() so the
 * Video Pipeline can consume Pexels via the same VideoProvider interface
 * as Runway / Higgsfield / Veo.
 *
 * Always last in the chain — we never want to return a 500 just because
 * Runway's API hiccuped. A topic-relevant stock clip is strictly better
 * than failing.
 */
import { findStockVideoByPrompt, PexelsNotConfiguredError } from "@/lib/pexels";
import type { SceneRequest, SceneResult, VideoProvider } from "./types";

export class PexelsFallbackProvider implements VideoProvider {
  name = "pexels";

  isConfigured(): boolean {
    return !!process.env.PEXELS_API_KEY;
  }

  async generateScene(request: SceneRequest): Promise<SceneResult> {
    try {
      // v2 F3 — forward brand/topic context so the per-scene Pexels
      // fallback uses the same query priority as the route's prefetch.
      // Falls back gracefully when the fields aren't provided (legacy
      // callers without brand records).
      const clip = await findStockVideoByPrompt({
        prompt: request.prompt,
        targetSeconds: request.durationSec,
        brandIndustry: request.brandIndustry ?? null,
        topicTitle: request.topicTitle ?? null,
        shotType: request.shotType ?? null,
        // Sprint 46 — the scene's literal semantic search phrase leads.
        searchQuery: request.searchQuery ?? null,
        // Cross-scene de-dup: exclude clips earlier scenes already used.
        // Numeric Pexels ids; non-numeric entries are ignored.
        excludeIds: (request.excludeSourceIds ?? [])
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n)),
        // Sprint 48 — soft-avoid creators earlier scenes used (twin-clip fix).
        excludeCreators: request.excludeCreators ?? [],
      });
      if (!clip) {
        throw new Error(
          `No Pexels match for keywords extracted from: "${request.prompt.slice(0, 80)}…"`,
        );
      }
      return {
        url: clip.url,
        durationSec: clip.durationSec,
        width: clip.width,
        height: clip.height,
        provider: this.name,
        costUsd: 0,
        attribution: `${clip.photographer} via Pexels`,
        metadata: {
          // Surfaced so the caller can record + exclude this asset on later scenes.
          pexelsId: clip.id,
          query: clip.query,
          orientation: clip.orientation,
          pexelsPageUrl: clip.pexelsPageUrl,
          // Sprint 48 — so the caller can record + soft-avoid this creator on
          // later scenes (twin-clip fix).
          photographer: clip.photographer,
        },
      };
    } catch (err) {
      if (err instanceof PexelsNotConfiguredError) {
        throw new Error("PEXELS_API_KEY not configured");
      }
      throw err;
    }
  }
}
