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
import {
  PublishError,
  type Destination,
  type MediaSpec,
  type OAuthConfig,
  type ProviderDefinition,
  type ProviderIdentity,
  type PublishContext,
  type PublishResult,
} from "./types";

export const LINKEDIN_PROVIDER = "linkedin";

const REST_POSTS = "https://api.linkedin.com/rest/posts";
const REST_IMAGES = "https://api.linkedin.com/rest/images";

// Includes publish scopes (PUB-2). w_member_social = personal posts;
// w_organization_social = company-page posts. Accounts connected before PUB-2
// lack these and must reconnect (publish → pre_send "missing scope" → failed).
const DEFAULT_SCOPES =
  "openid profile email w_member_social r_organization_admin w_organization_social";

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

// ─── Publishing (PUB-2) ───────────────────────────────────────────────────────
// Posts API (/rest/posts) + Images API (/rest/images). Author urn = the
// destination id (urn:li:person:… or urn:li:organization:…). Requires the
// LinkedIn-Version header (LINKEDIN_API_VERSION) and the publish scopes
// (w_member_social / w_organization_social) — missing scope → 403 → pre_send.
//
// LinkedIn has no documented idempotency key for posts, so at-most-once is
// enforced upstream (worker: compare-and-set claim + external_post_id guard +
// attempts:1, post_send → needs_review). ctx.idempotencyKey is unused here.

function restHeaders(accessToken: string): Record<string, string> {
  const version = process.env.LINKEDIN_API_VERSION;
  if (!version) {
    throw new PublishError("LINKEDIN_API_VERSION is not set (required for /rest)", "pre_send");
  }
  return {
    authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
    "content-type": "application/json",
  };
}

/** Upload an image owned by authorUrn → returns its urn:li:image:… */
async function uploadLinkedInImage(
  accessToken: string,
  authorUrn: string,
  bytesUrl: string,
): Promise<string> {
  // Download the artifact bytes (pre-send — nothing posted on failure).
  let bytes: Buffer;
  try {
    const r = await fetch(bytesUrl);
    if (!r.ok) throw new Error(`download ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    throw new PublishError(`image download failed: ${e instanceof Error ? e.message : e}`, "pre_send");
  }
  // 1. initialize upload
  let uploadUrl: string;
  let imageUrn: string;
  try {
    const init = await fetch(`${REST_IMAGES}?action=initializeUpload`, {
      method: "POST",
      headers: restHeaders(accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
    });
    if (!init.ok) {
      const t = await init.text().catch(() => "");
      throw new PublishError(`image initializeUpload ${init.status}: ${t.slice(0, 200)}`, "pre_send");
    }
    const j = (await init.json()) as { value?: { uploadUrl?: string; image?: string } };
    uploadUrl = j.value?.uploadUrl ?? "";
    imageUrn = j.value?.image ?? "";
    if (!uploadUrl || !imageUrn) throw new PublishError("image init missing uploadUrl/urn", "pre_send");
  } catch (e) {
    if (e instanceof PublishError) throw e;
    throw new PublishError(`image init error: ${e instanceof Error ? e.message : e}`, "pre_send");
  }
  // 2. PUT the bytes (still pre-send: the post hasn't been created yet)
  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}` },
      body: bytes as unknown as BodyInit,
    });
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      throw new PublishError(`image upload PUT ${put.status}: ${t.slice(0, 200)}`, "pre_send");
    }
  } catch (e) {
    if (e instanceof PublishError) throw e;
    throw new PublishError(`image upload error: ${e instanceof Error ? e.message : e}`, "pre_send");
  }
  return imageUrn;
}

async function publishToLinkedIn(ctx: PublishContext): Promise<PublishResult> {
  const authorUrn = ctx.destination.id; // urn:li:person:… | urn:li:organization:…
  const text = (ctx.text ?? "").slice(0, 3000);

  const media: MediaSpec = ctx.media;
  const imageItem = media.kind === "image" ? media.items[0] : undefined;

  // Image (if any) uploaded BEFORE the post is created → upload failures are pre_send.
  let imageUrn: string | null = null;
  if (imageItem?.url) {
    imageUrn = await uploadLinkedInImage(ctx.accessToken, authorUrn, imageItem.url);
  }

  const postBody: Record<string, unknown> = {
    author: authorUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) {
    postBody.content = { media: { id: imageUrn, altText: imageItem?.id ? "image" : "image" } };
  }

  // ─── Create the post. Classify by phase: ───────────────────────────────────
  //   4xx → LinkedIn rejected it, nothing posted → pre_send (failed)
  //   5xx / network / 201-without-id → ambiguous → post_send (needs_review)
  let res: Response;
  try {
    res = await fetch(REST_POSTS, {
      method: "POST",
      headers: restHeaders(ctx.accessToken),
      body: JSON.stringify(postBody),
    });
  } catch (e) {
    throw new PublishError(`posts request failed (network): ${e instanceof Error ? e.message : e}`, "post_send");
  }

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const phase = res.status >= 500 ? "post_send" : "pre_send";
    throw new PublishError(`LinkedIn posts ${res.status}: ${t.slice(0, 250)}`, phase);
  }

  const postId = res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id");
  if (!postId) {
    // Created (2xx) but we can't read the id → ambiguous; don't claim success.
    throw new PublishError("LinkedIn posts succeeded but no x-restli-id header", "post_send");
  }
  return {
    externalPostId: postId,
    permalinkUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`,
  };
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
  publish: publishToLinkedIn,
};
