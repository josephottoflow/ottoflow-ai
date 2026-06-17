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
  /** Separator for the authorize-URL `scope` param. Default " "; Meta uses ",". */
  scopeSeparator?: string;
}

/** OAuth token set returned by code exchange / refresh / exchangeToken. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  scope: string | null;
}

export interface ProviderIdentity {
  /** Stable provider account id (sub / urn / page id / permission id). */
  accountId: string;
  /** Human label for the UI. */
  accountName: string | null;
}

/** A targetable sub-account: LinkedIn org page, Facebook Page, IG business
 * account, YouTube channel, etc. Providers without sub-targets (e.g. Drive)
 * expose none. Framework type only — no provider implements it in P3.1b. */
export interface Destination {
  /** Provider's destination id (page id / channel id / profile urn). */
  id: string;
  name: string;
  /** e.g. "personal" | "company_page" | "facebook_page" | "ig_business" | "youtube_channel". */
  type: string;
  metadata?: Record<string, unknown>;
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

  // ─── Optional capability hooks (P3.1b). All backward-compatible: when a
  // provider omits a hook the generic implementation is used. Drive defines
  // none, so its behaviour is unchanged. ──────────────────────────────────────

  /** Enumerate targetable destinations for a connected account, given a valid
   * access token. Omit for providers with no sub-targets (Drive). */
  enumerateDestinations?: (accessToken: string) => Promise<Destination[]>;

  /** Custom token refresh (e.g. Meta long-lived `fb_exchange_token`). Falls
   * back to the generic RFC-6749 refresh_token grant (oauth.ts) when omitted. */
  refresh?: (refreshToken: string) => Promise<{ accessToken: string; expiresInSec: number }>;

  /** Custom token revocation (e.g. Meta `DELETE /me/permissions`). Falls back
   * to the generic revoke-endpoint POST (oauth.ts) when omitted. */
  revoke?: (token: string) => Promise<void>;

  /** Transform the freshly-exchanged token set before the account is created
   * (P3.1c). The generic callback invokes this immediately after exchangeCode,
   * before identity/upsert. Meta uses it to convert the short-lived token into
   * a long-lived one (so a short-lived token is never stored). Omit for
   * providers whose code-exchange token is already the final token. */
  exchangeToken?: (tokens: TokenSet) => Promise<TokenSet>;
}

/** A ProviderDefinition known to be an OAuth provider (oauth is non-null). */
export type OAuthProvider = ProviderDefinition & {
  oauth: OAuthConfig;
  identity: (accessToken: string) => Promise<ProviderIdentity>;
};
