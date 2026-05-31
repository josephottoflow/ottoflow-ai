/**
 * Multi-user RLS isolation test.
 *
 * Without a second real Clerk user, we prove the RLS policy works by
 * comparing what the ADMIN client sees against what the USER-AUTHED
 * client sees. If isolation works:
 *   - admin sees all brand rows across all (former) users
 *   - user-authed only sees rows where user_id = current Clerk userId
 *   - every row returned to user-authed has user_id === clerkUserId
 *
 * We have a natural test fixture from earlier sessions: orphan rows
 * created under since-deleted Clerk users. If those show up for the
 * current user, RLS is broken. They MUST NOT.
 *
 * Returns counts + (if isolation is broken) which row ids leaked.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1) Admin view — all brand rows (RLS bypass via service role)
  const admin = createAdminClient();
  const { data: allRows, error: adminErr } = await admin
    .from("brands")
    .select("id,user_id,name");

  // 2) User-authed view — should be RLS-scoped to current Clerk user
  const sb = await createServerSupabaseClient();
  const { data: userRows, error: userErr } = await sb
    .from("brands")
    .select("id,user_id,name");

  // 3) Analyze
  const adminTotal = allRows?.length ?? 0;
  const userTotal = userRows?.length ?? 0;
  const ownedByMe = (allRows ?? []).filter((r) => r.user_id === userId).length;
  const leakedToMe =
    (userRows ?? []).filter((r) => r.user_id !== userId);

  const rlsIsolationWorking =
    leakedToMe.length === 0 && userTotal === ownedByMe;

  return NextResponse.json({
    currentClerkUserId: userId,
    counts: {
      adminSeesTotal: adminTotal,
      userAuthedSees: userTotal,
      ownedByMeInAdmin: ownedByMe,
      otherUsersBrandsInAdmin: adminTotal - ownedByMe,
    },
    rlsIsolationWorking,
    leakedRowsToMe: leakedToMe, // empty array if isolation is intact
    verdict: rlsIsolationWorking
      ? `✅ RLS isolation verified — saw ${userTotal} of my own rows; ${adminTotal - ownedByMe} other-user rows correctly hidden.`
      : `❌ RLS LEAK — user-authed client returned ${leakedToMe.length} rows belonging to other users.`,
    errors: {
      adminQueryErr: adminErr?.message ?? null,
      userQueryErr: userErr?.message ?? null,
    },
  });
}
