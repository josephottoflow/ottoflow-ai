/**
 * GET /api/integrations — list the current user's connected accounts.
 *
 * Token-free projection (listAccountsForUser selects no *_enc columns), served
 * via the service-role client with an explicit user_id filter. Read path for
 * the Integrations settings UI.
 */
import { auth } from "@clerk/nextjs/server";
import { listAccountsForUser } from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await listAccountsForUser(userId);
  return Response.json({ accounts });
}
