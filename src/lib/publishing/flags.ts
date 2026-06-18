/**
 * Publishing feature flag (PUB-1). Server-only (read in API routes + worker;
 * not exposed to the client, not `NEXT_PUBLIC`). Lazy — not in env.ts — so
 * production with the flag unset behaves exactly as before (dark-launch).
 *
 * Gates: POST/GET/DELETE /api/publish, the publish worker registration, and
 * the scheduler-sweep registration.
 */
export function isPublishingEnabled(): boolean {
  return process.env.PUBLISHING_ENABLED === "true";
}
