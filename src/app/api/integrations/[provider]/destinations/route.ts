/**
 * GET /api/integrations/[provider]/destinations — list a connected account's
 * targetable destinations (framework only, P3.1b).
 *
 * The dynamic segment value here is the connected-account id (see the sibling
 * DELETE route note on the single-slug-name constraint). Resolves the account,
 * then delegates to the provider's optional `enumerateDestinations` hook. No
 * provider implements it yet, so this returns an empty list (Drive has no
 * sub-destinations). When a future provider implements the hook, the result is
 * cached to metadata.destinations.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAccountForUser,
  getValidAccessToken,
  patchAccountMetadata,
} from "@/lib/integrations/accounts";
import { getProvider } from "@/lib/integrations/providers/registry";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // `provider` carries the connected-account id for this account-scoped route.
  const { provider: id } = await params;
  const account = await getAccountForUser(id, userId);
  if (!account) return Response.json({ error: "Not found" }, { status: 404 });

  const def = getProvider(account.provider);
  // Default: providers without sub-destinations (e.g. Drive) → empty list.
  if (!def?.enumerateDestinations) {
    return Response.json({ destinations: [], supported: false });
  }

  try {
    const token = await getValidAccessToken(account);
    const destinations = await def.enumerateDestinations(token);
    await patchAccountMetadata(account.id, { destinations });
    return Response.json({ destinations, supported: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Destination lookup failed" },
      { status: 502 },
    );
  }
}
