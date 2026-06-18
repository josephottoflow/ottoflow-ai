/**
 * Instagram Business destination resolver (Phase 3.1c).
 *
 * NOT a separate OAuth provider — IG Business/Creator accounts are reached
 * through the Meta connection + a linked Facebook Page. Given the Pages (with
 * their page tokens, used transiently and never stored in this phase), resolve
 * each Page's linked IG Business account into a generic `ig_business`
 * Destination. Defensive: a Page with no linked IG (or an API error) is simply
 * skipped — Pages-only is a valid result.
 */
import type { Destination } from "./types";
import { graphBase } from "./meta-oauth";

export interface MetaPageLite {
  id: string;
  name: string;
  access_token: string;
}

export async function resolveInstagramDestinations(
  pages: MetaPageLite[],
): Promise<Destination[]> {
  const out: Destination[] = [];
  for (const page of pages) {
    try {
      const url = new URL(`${graphBase()}/${page.id}`);
      url.searchParams.set("fields", "instagram_business_account{id,username,name}");
      url.searchParams.set("access_token", page.access_token);
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = (await res.json()) as {
        instagram_business_account?: { id: string; username?: string; name?: string };
      };
      const iga = j.instagram_business_account;
      if (iga?.id) {
        out.push({
          id: iga.id,
          name: iga.username ? `@${iga.username}` : iga.name ?? iga.id,
          type: "ig_business",
          metadata: { pageId: page.id, pageName: page.name },
        });
      }
    } catch {
      // skip this page — never break the whole enumeration
    }
  }
  return out;
}
