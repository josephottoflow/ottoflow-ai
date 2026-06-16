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

let chain: VideoProvider[] | null = null;
function getChain(): VideoProvider[] {
  if (chain) return chain;
  // Order matters. Premium quality first, cheaper fallbacks behind.
  //
  //   Runway gen4.5  $0.25/5s — highest cinematic quality, requires
  //                  Pexels photo seed + RUNWAYML_API_SECRET
  //   Luma ray-flash $0.14/5s — pure text-to-video, requires LUMA_API_KEY
  //   Pexels         free    — stock-clip fallback, always last so we
  //                            never return 500 just because both AI
  //                            providers were down
  //
  // Higgsfield is intentionally NOT in this chain. It exposes an SSE
  // MCP server (`.mcp.json` `mcp.higgsfield.ai`) but no documented public
  // REST API. Adding it later requires running an MCP client inside the
  // Railway worker — outside this phase's scope.
  //
  // Seedance (BytePlus ModelArk) leads the chain for the Video V1 AI-first
  // path: bespoke per-scene AI video, native 9:16, cheap. Runway/Luma stay
  // as fallbacks; Pexels stock is ALWAYS last so a scene never 500s.
  chain = [
    new SeedanceProvider(),
    new RunwayProvider(),
    new LumaProvider(),
    new PexelsFallbackProvider(),
  ];
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
