/**
 * LinkedIn provider (Phase 3.1c) — first non-Google provider, registered
 * entirely through the generic framework (oauth.ts + generic [provider] routes
 * + generic token service). No LinkedIn-specific routes.
 *
 * Capabilities: publish (connection + destination discovery only in P3.1c — NO
 * publishing implementation). Destinations = the member's personal profile +
 * organization pages they administer.
 *
 * OAuth: Authorization-Code (confidential client; client_secret required).
 * LinkedIn's standard 3-legged flow does not use PKCE, so usesPKCE=false.
 * Refresh tokens are only issued to apps approved for them (Marketing Developer
 * Platform); otherwise tokens are ~60-day and non-refreshable → the generic
 * token service marks the account reauth_required on expiry (no override).
 * Revocation needs client credentials, so we provide a `revoke` override.
 *
 * Env (lazy — not in env.ts):
 *   LINKEDIN_OAUTH_CLIENT_ID / LINKEDIN_OAUTH_CLIENT_SECRET / LINKEDIN_OAUTH_REDIRECT_URI
 *   LINKEDIN_SCOPES        (optional, space-separated; default below)
 *   LINKEDIN_API_VERSION   (optional; the LinkedIn-Version header, e.g. 202405)
 *
 * ⚠️ Endpoint/scope/version specifics should be confirmed against current
 * LinkedIn docs at provisioning (their REST API versions are sunset on a
 * rolling basis) — same "verify the live contract" caveat as any external API.
 */
import type {
  Destination,
  OAuthConfig,
  ProviderDefinition,
  ProviderIdentity,
} from "./types";

export const LINKEDIN_PROVIDER = "linkedin";

const DEFAULT_SCOPES = "openid profile email r_organization_admin";

const AUTH_ENDPOINT = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_ENDPOINT = "https://www.linkedin.com/oauth/v2/revoke";
const USERINFO = "https://api.linkedin.com/v2/userinfo";
const ORG_ACLS =
  "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(localizedName)))";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      "LinkedIn OAuth is not configured — set LINKEDIN_OAUTH_CLIENT_ID, " +
        "LINKEDIN_OAUTH_CLIENT_SECRET and LINKEDIN_OAUTH_REDIRECT_URI.",
    );
  }
  return v;
}

const linkedinOAuthConfig: OAuthConfig = {
  isConfigured: () =>
    !!process.env.LINKEDIN_OAUTH_CLIENT_ID &&
    !!process.env.LINKEDIN_OAUTH_CLIENT_SECRET &&
    !!process.env.LINKEDIN_OAUTH_REDIRECT_URI,
  clientId: () => required("LINKEDIN_OAUTH_CLIENT_ID"),
  clientSecret: () => required("LINKEDIN_OAUTH_CLIENT_SECRET"),
  redirectUri: () => required("LINKEDIN_OAUTH_REDIRECT_URI"),
  authEndpoint: AUTH_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
  revokeEndpoint: REVOKE_ENDPOINT,
  scopes: (process.env.LINKEDIN_SCOPES ?? DEFAULT_SCOPES).split(/\s+/).filter(Boolean),
  usesPKCE: false, // confidential client; LinkedIn standard flow uses client_secret
};

function apiHeaders(accessToken: string): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  const version = process.env.LINKEDIN_API_VERSION;
  if (version) {
    h["LinkedIn-Version"] = version;
    h["X-Restli-Protocol-Version"] = "2.0.0";
  }
  return h;
}

interface UserInfo {
  sub: string;
  name?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch(USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LinkedIn userinfo ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as UserInfo;
}

/** Identify the connected member (OpenID Connect /userinfo). */
async function fetchLinkedInIdentity(accessToken: string): Promise<ProviderIdentity> {
  const u = await fetchUserInfo(accessToken);
  return {
    accountId: u.sub,
    accountName: u.email || u.name || [u.given_name, u.family_name].filter(Boolean).join(" ") || null,
  };
}

/** Personal profile + administered organization pages. Defensive: a failure to
 * read org ACLs still returns the personal destination. */
async function enumerateLinkedInDestinations(accessToken: string): Promise<Destination[]> {
  const destinations: Destination[] = [];

  // Personal profile (publish-as-member target).
  try {
    const u = await fetchUserInfo(accessToken);
    destinations.push({
      id: `urn:li:person:${u.sub}`,
      name: u.name || u.email || "Personal profile",
      type: "personal",
    });
  } catch {
    // identity already validated at connect; skip if transient
  }

  // Organization pages the member administers.
  try {
    const res = await fetch(ORG_ACLS, { headers: apiHeaders(accessToken) });
    if (res.ok) {
      const j = (await res.json()) as {
        elements?: Array<{
          organization?: string;
          "organization~"?: { localizedName?: string };
        }>;
      };
      for (const el of j.elements ?? []) {
        if (!el.organization) continue;
        destinations.push({
          id: el.organization, // urn:li:organization:<id>
          name: el["organization~"]?.localizedName ?? el.organization,
          type: "company_page",
          metadata: { role: "ADMINISTRATOR" },
        });
      }
    }
    // Non-2xx (e.g. app lacks org product) → personal-only; not fatal.
  } catch {
    // network/parse error → personal-only
  }

  return destinations;
}

/** LinkedIn token revocation requires client credentials (override the generic
 * token-only revoke). Best-effort; never throws into the caller. */
async function revokeLinkedInToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: linkedinOAuthConfig.clientId(),
        client_secret: linkedinOAuthConfig.clientSecret(),
        token,
      }),
    });
  } catch {
    // best-effort
  }
}

export const linkedinProvider: ProviderDefinition = {
  id: LINKEDIN_PROVIDER,
  label: "LinkedIn",
  kind: "oauth",
  capabilities: ["publish"],
  oauth: linkedinOAuthConfig,
  identity: fetchLinkedInIdentity,
  enumerateDestinations: enumerateLinkedInDestinations,
  revoke: revokeLinkedInToken,
};
