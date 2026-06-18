/**
 * Meta provider (Phase 3.1c) — single connection surfacing both Facebook Pages
 * and Instagram Business destinations (Option A). One OAuth consent, one
 * connected_accounts row, one token lifecycle, one disconnect.
 *
 * Auth/token core lives in meta-oauth.ts; IG resolution in instagram.ts.
 * capabilities: ["publish"] — connection + destination discovery only in
 * P3.1c (NO publish hook; no publishing in this phase).
 */
import type { Destination, ProviderDefinition } from "./types";
import {
  META_PROVIDER,
  metaOAuthConfig,
  metaIdentity,
  metaExchangeToken,
  metaRefresh,
  metaRevoke,
  graphBase,
} from "./meta-oauth";
import { resolveInstagramDestinations, type MetaPageLite } from "./instagram";

async function listPages(userAccessToken: string): Promise<MetaPageLite[]> {
  const url = new URL(`${graphBase()}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userAccessToken);
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Meta /me/accounts ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { data?: MetaPageLite[] };
  return j.data ?? [];
}

/** Facebook Pages + IG Business accounts linked to those Pages. Page tokens are
 * used transiently for IG resolution and NOT stored (no publishing this phase). */
async function enumerateMetaDestinations(userAccessToken: string): Promise<Destination[]> {
  const destinations: Destination[] = [];
  let pages: MetaPageLite[] = [];
  try {
    pages = await listPages(userAccessToken);
  } catch {
    pages = [];
  }
  for (const p of pages) {
    destinations.push({ id: p.id, name: p.name, type: "facebook_page" });
  }
  try {
    destinations.push(...(await resolveInstagramDestinations(pages)));
  } catch {
    // Pages-only is a valid result.
  }
  return destinations;
}

export const metaProvider: ProviderDefinition = {
  id: META_PROVIDER,
  label: "Meta (Facebook & Instagram)",
  kind: "oauth",
  capabilities: ["publish"],
  oauth: metaOAuthConfig,
  identity: metaIdentity,
  exchangeToken: metaExchangeToken,
  refresh: metaRefresh,
  revoke: metaRevoke,
  enumerateDestinations: enumerateMetaDestinations,
};
