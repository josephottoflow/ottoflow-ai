/**
 * Provider registry — the single entry point Video Pipeline code uses to
 * generate a scene clip. Walks the configured chain in priority order;
 * returns first success; aggregates errors into AllProvidersExhaustedError
 * if every provider fails.
 *
 * Order matters: more expensive but higher-quality providers go first.
 * Pexels is ALWAYS last because it never fails for sensible prompts.
 */
import { captureFallback } from "@/lib/observability";
import { isRunwayEnabled, isLumaEnabled } from "@/lib/video/flags";
import { PexelsFallbackProvider } from "./pexels";
import { SeedanceProvider } from "./seedance";
import { RunwayProvider } from "./runway";
import { LumaProvider } from "./luma";
import {
  AllProvidersExhaustedError,
  type SceneRequest,
  type SceneResult,
  type VideoProvider,
} from "./types";

// NOTE: the chain is NOT memoized — it is rebuilt per call so the paid-fallback
// flags are honored at request time (and so a flag change doesn't require a
// worker restart). Provider constructors are trivial.
function getChain(): VideoProvider[] {
  // Provider safety (hardening): the DEFAULT chain is Seedance → Pexels only.
  // Paid AI fallbacks (Runway gen4.5 ~$0.25/5s, Luma ray-flash ~$0.14/5s) are
  // OFF unless explicitly enabled (VIDEO_ENABLE_RUNWAY / VIDEO_ENABLE_LUMA), so
  // a Seedance miss falls straight to FREE Pexels instead of silently spending
  // on a second/third paid provider. Pexels is ALWAYS last so a scene never 500s.
  //
  // Higgsfield is intentionally NOT in this chain (SSE MCP only, no REST API).
  const chain: VideoProvider[] = [new SeedanceProvider()];
  if (isRunwayEnabled()) chain.push(new RunwayProvider());
  if (isLumaEnabled()) chain.push(new LumaProvider());
  chain.push(new PexelsFallbackProvider());
  return chain;
}

/**
 * Generate a single scene clip, walking the provider chain.
 *
 * Pass `preferProvider` to bias toward a specific backend (e.g. UI lets the
 * user request "stock only" → preferProvider="pexels"). Skipped providers
 * are NOT counted as failures.
 */
export async function generateScene(
  request: SceneRequest,
  opts?: { preferProvider?: string },
): Promise<SceneResult> {
  const ordered = getChain();
  // If user prefers a specific provider, put it first in the local chain.
  const sortedChain =
    opts?.preferProvider
      ? [
          ...ordered.filter((p) => p.name === opts.preferProvider),
          ...ordered.filter((p) => p.name !== opts.preferProvider),
        ]
      : ordered;

  const attempts: { provider: string; error: string }[] = [];

  for (const provider of sortedChain) {
    if (!provider.isConfigured()) {
      attempts.push({ provider: provider.name, error: "not configured" });
      continue;
    }
    try {
      return await provider.generateScene(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: provider.name, error: message });
      captureFallback("video-provider.scene_failed", err, {
        provider: provider.name,
        promptLength: request.prompt.length,
        durationSec: request.durationSec,
      });
      // continue to next provider
    }
  }

  throw new AllProvidersExhaustedError(attempts);
}

/** Diagnostic view — which providers are currently active. */
export function listProviders(): { name: string; configured: boolean }[] {
  return getChain().map((p) => ({ name: p.name, configured: p.isConfigured() }));
}
