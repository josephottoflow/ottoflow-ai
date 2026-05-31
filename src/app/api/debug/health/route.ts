/**
 * Comprehensive connection health check. Exercises every external dependency
 * the Next.js app talks to so we can verify the full graph in one shot:
 *
 *   1. Clerk          — auth() returns userId + JWT
 *   2. Supabase REST  — admin client (service role) can query
 *   3. Supabase RLS   — user-authed client (Clerk JWT) can query
 *   4. Redis (BullMQ) — PING + check queue meta exists
 *   5. Gemini         — small generation call (proves API key works)
 *   6. Worker         — Redis sentinel check (recent worker activity)
 *
 * Each check is independent: if Gemini is rate-limited we still report the
 * other 5 correctly. Total runtime ~3-5s on healthy state.
 *
 * Auth-gated. Remove pre-public-beta along with the other debug routes.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getRedisClient, brandResearchQueue } from "@/lib/queue";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Check = {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  err?: string;
};

async function timed<T>(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>
): Promise<Check> {
  const start = performance.now();
  try {
    const r = await fn();
    return { name, ok: r.ok, ms: Math.round(performance.now() - start), detail: r.detail };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - start),
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

export async function GET() {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: Check[] = [];

  // 1. Clerk — userId from auth(), token from getToken()
  checks.push(
    await timed("clerk_auth", async () => {
      const token = await getToken();
      const isJwt = !!token && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
      return {
        ok: !!userId && isJwt,
        detail: `userId=${userId}, jwt=${isJwt ? "valid" : "missing/invalid"}`,
      };
    })
  );

  // 2. Supabase REST via admin (service role — proves env + URL + service key)
  checks.push(
    await timed("supabase_admin", async () => {
      const admin = createAdminClient();
      const { count, error } = await admin
        .from("brands")
        .select("id", { count: "exact", head: true });
      if (error) return { ok: false, detail: error.message };
      return { ok: true, detail: `admin sees ${count} brand rows` };
    })
  );

  // 3. Supabase via user-authed (Clerk JWT + Third-Party Auth + RLS)
  checks.push(
    await timed("supabase_user_authed", async () => {
      const sb = await createServerSupabaseClient();
      const { count, error } = await sb
        .from("brands")
        .select("id", { count: "exact", head: true });
      if (error) return { ok: false, detail: error.message };
      return { ok: true, detail: `user sees ${count} brand rows (RLS-scoped)` };
    })
  );

  // 4. Supabase RPC — current_clerk_user_id() (proves JWT decode + claims plumbing)
  checks.push(
    await timed("supabase_rpc", async () => {
      const sb = await createServerSupabaseClient();
      const { data, error } = await sb.rpc("current_clerk_user_id");
      if (error) return { ok: false, detail: error.message };
      const matches = data === userId;
      return {
        ok: matches,
        detail: `rpc returned "${data}" — ${matches ? "matches clerk userId ✓" : "MISMATCH"}`,
      };
    })
  );

  // 5. Redis PING (BullMQ + idempotency + rate-limit)
  checks.push(
    await timed("redis_ping", async () => {
      const r = getRedisClient();
      const reply = await r.ping();
      return { ok: reply === "PONG", detail: `PING -> ${reply}` };
    })
  );

  // 6. BullMQ queue accessible — read meta + counts
  checks.push(
    await timed("bullmq_queue", async () => {
      const q = brandResearchQueue();
      const counts = await q.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );
      return {
        ok: true,
        detail:
          `waiting=${counts.waiting} active=${counts.active} ` +
          `completed=${counts.completed} failed=${counts.failed} delayed=${counts.delayed}`,
      };
    })
  );

  // 7. Worker liveness — last meta update via Redis (looks at bull:brand-research:meta)
  checks.push(
    await timed("worker_meta", async () => {
      const r = getRedisClient();
      const meta = await r.hgetall("bull:brand-research:meta");
      const hasOpts = !!meta?.opts;
      return {
        ok: hasOpts,
        detail: hasOpts
          ? `meta present (${Object.keys(meta).length} fields)`
          : "no meta — worker may not have connected yet",
      };
    })
  );

  // 8. Gemini — small generation, no tools (proves key + reachability)
  checks.push(
    await timed("gemini_api", async () => {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) return { ok: false, detail: "GOOGLE_API_KEY missing" };
      const ai = new GoogleGenAI({ apiKey });
      const r = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        contents: 'Reply with the single word "pong" — nothing else.',
        config: { temperature: 0, maxOutputTokens: 5 },
      });
      const text = (r.text ?? "").trim().toLowerCase();
      return {
        ok: text.includes("pong"),
        detail: `model returned: "${text}"`,
      };
    })
  );

  const allOk = checks.every((c) => c.ok);
  const totalMs = checks.reduce((acc, c) => acc + c.ms, 0);

  return NextResponse.json({
    healthy: allOk,
    summary: `${checks.filter((c) => c.ok).length}/${checks.length} checks passed in ${totalMs}ms`,
    checks,
  });
}
