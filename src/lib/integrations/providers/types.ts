/**
 * Provider framework types (Phase 3.1a).
 *
 * A ProviderDefinition is the single source of per-provider behaviour the
 * generic OAuth/token service + routes consume. Google Drive is the reference
 * implementation (providers/google-drive.ts); future providers (Gmail,
 * LinkedIn, Meta, X, YouTube) register the same shape — no provider-specific
 * tables, no per-provider route trees.
 */

export type ProviderCapability = "storage" | "email" | "publish" | "analytics";

/** Everything the generic OAuth helpers (oauth.ts) need for one provider.
 * Credentials are resolved lazily (env), so an unconfigured provider doesn't
 * break boot — only a clear error when a flow is actually invoked. */
export interface OAuthConfig {
  /** True when client id/secret/redirect env are all present. Never throws. */
  isConfigured(): boolean;
  clientId(): string; // throws with a clear message if unset
  clientSecret(): string;
  redirectUri(): string;
  authEndpoint: string;
  tokenEndpoint: string;
  /** Optional token-revocation endpoint (used on disconnect). */
  revokeEndpoint?: string;
  scopes: string[];
  /** Authorization-Code + PKCE when true. */
  usesPKCE: boolean;
  /** Extra params appended to the authorize URL only (e.g. access_type, prompt). */
  authParams?: Record<string, string>;
}

export interface ProviderIdentity {
  /** Stable provider account id (sub / urn / page id / permission id). */
  accountId: string;
  /** Human label for the UI. */
  accountName: string | null;
}

export interface ProviderDefinition {
  id: string; // e.g. "google_drive"
  label: string; // e.g. "Google Drive"
  kind: "oauth" | "api_key";
  capabilities: ProviderCapability[];
  /** Present for kind === "oauth". */
  oauth?: OAuthConfig;
  /** Identify the connected account from an access token (OAuth providers). */
  identity?: (accessToken: string) => Promise<ProviderIdentity>;
}

/** A ProviderDefinition known to be an OAuth provider (oauth is non-null). */
export type OAuthProvider = ProviderDefinition & {
  oauth: OAuthConfig;
  identity: (accessToken: string) => Promise<ProviderIdentity>;
};
