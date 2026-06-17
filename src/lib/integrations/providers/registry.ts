/**
 * Provider registry (Phase 3.1a).
 *
 * Single lookup the generic OAuth/token service + routes use. Today it holds
 * only Google Drive; new providers register here with no other code change.
 */
import type { OAuthProvider, ProviderDefinition } from "./types";
import { googleDriveProvider } from "./google-drive";
import { linkedinProvider } from "./linkedin";
import { metaProvider } from "./meta";

const PROVIDERS: Record<string, ProviderDefinition> = {
  [googleDriveProvider.id]: googleDriveProvider,
  [linkedinProvider.id]: linkedinProvider,
  [metaProvider.id]: metaProvider,
};

export function getProvider(id: string): ProviderDefinition | null {
  return PROVIDERS[id] ?? null;
}

export function listProviders(): ProviderDefinition[] {
  return Object.values(PROVIDERS);
}

/** Resolve a provider known to be OAuth, or throw. */
export function getOAuthProvider(id: string): OAuthProvider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown integration provider: ${id}`);
  if (!p.oauth || !p.identity) {
    throw new Error(`Provider ${id} is not an OAuth provider`);
  }
  return p as OAuthProvider;
}
