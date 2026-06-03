/**
 * Admin authorization helper (B1.R8).
 *
 * Restricts /api/debug/* + /admin/* + /api/admin/* routes to a hard
 * allowlist of Clerk emails. Single source of truth so we don't sprinkle
 * the env-var lookup across every route.
 *
 * Set `ADMIN_EMAILS` in Vercel as a comma-separated list:
 *   ADMIN_EMAILS=joseph@ottoflow.ai,ops@ottoflow.ai
 *
 * The check is fail-CLOSED — if the env var isn't set, NOBODY is admin.
 * This is the opposite of the budget service which fails OPEN; admin
 * access is too dangerous to default-allow.
 */
import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * Returns the Clerk userId iff the caller is signed in AND in the admin
 * allowlist. Returns null otherwise (caller should 401 / 404).
 *
 * Always 404 on negative — never reveal whether the user just lacks
 * permission vs whether the route exists at all.
 */
export async function requireAdmin(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return null; // fail-closed

  const user = await currentUser();
  const userEmails = (user?.emailAddresses ?? [])
    .map((e) => e.emailAddress?.toLowerCase?.())
    .filter(Boolean);

  for (const email of userEmails) {
    if (allowlist.includes(email!)) return userId;
  }
  return null;
}

/** Convenience: throw-style for routes that prefer try/catch. */
export class NotAdminError extends Error {
  constructor() {
    super("Admin access required");
    this.name = "NotAdminError";
  }
}
