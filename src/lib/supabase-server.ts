import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { serverEnv } from "./env";

/**
 * Per-request Supabase client authenticated with the current Clerk session.
 * RLS policies see `auth.jwt() ->> 'sub'` = the Clerk user id.
 *
 * Uses Supabase's native Third-Party Auth integration with Clerk (Path A in
 * AUTH_FLOW.md). The Clerk session token is passed directly — Supabase
 * verifies it via Clerk's JWKS endpoint configured under Supabase
 * Authentication → Third-Party Auth. No Clerk JWT template needed.
 *
 * Usage from server components / route handlers / server actions:
 *   const sb = await createServerSupabaseClient();
 *   const { data } = await sb.from("brands").select("*");
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();

  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
