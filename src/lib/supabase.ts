/**
 * Supabase admin client. Used by:
 *   - The BullMQ worker (acts on behalf of users without their session token)
 *   - Server route handlers that need to bypass RLS for a tightly-scoped
 *     operation (e.g. POST /api/brands setting `bull_job_id` after the
 *     user-scoped insert)
 *
 * Reads `process.env` directly so it can be imported from both contexts
 * (Next.js + worker) without dragging in cross-context env validation.
 * Presence is guaranteed before this module is reached by whichever
 * validator runs first at process boot:
 *   - Next.js: src/lib/env.ts (imported at the top of app/layout.tsx)
 *   - Worker:  src/lib/worker-env.ts (imported at the top of worker/index.ts)
 *
 * Browser-side note: this module is server-only by convention but is NOT
 * marked `import "server-only"` because the worker (a non-Next server)
 * imports it. Don't import this from a "use client" file — at runtime the
 * service-role key is undefined in the browser and the function would
 * throw on call. The anonymous browser Supabase client lives in
 * src/components/SupabaseProvider.tsx, NOT here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[supabase] ${name} is not set. ` +
        `This should have been caught by env.ts / worker-env.ts at boot. ` +
        `Make sure the validator runs before importing @/lib/supabase.`
    );
  }
  return v;
}

/**
 * Service-role client. Bypasses RLS — use only when the calling code has
 * already established trust (Clerk-authenticated route handler, or the
 * worker which writes on behalf of the queue-job's owner).
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
