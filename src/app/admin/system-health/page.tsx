/**
 * /admin/system-health — admin-only operations view.
 *
 * Surfaces real-time signal that doesn't fit on /analytics:
 *   - BullMQ queue depths (wait / active / failed) per queue
 *   - Recent failed render_jobs + merge_jobs counts (last 1h, 24h)
 *   - Scene generation success rate (last 100 scenes)
 *   - Merge success rate (last 100 merges)
 *   - Supabase Storage object count + total bytes
 *   - Cron-style "last heartbeat" timestamps from recovery sweeps
 *
 * Hard-gated by requireAdmin(). Negative path 404s — no info leak.
 */
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { getRedisClient, QUEUE_NAMES } from "@/lib/queue";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const revalidate = 15;

interface QueueDepth {
  queue: string;
  wait: number;
  active: number;
  failed: number;
  delayed: number;
  completed: number;
}

async function fetchQueueDepths(): Promise<QueueDepth[]> {
  const redis = getRedisClient();
  const out: QueueDepth[] = [];
  for (const queue of Object.values(QUEUE_NAMES)) {
    try {
      const [wait, active, failed, delayed, completed] = await Promise.all([
        redis.llen(`bull:${queue}:wait`),
        redis.llen(`bull:${queue}:active`),
        redis.zcard(`bull:${queue}:failed`),
        redis.zcard(`bull:${queue}:delayed`),
        redis.zcard(`bull:${queue}:completed`),
      ]);
      out.push({ queue, wait, active, failed, delayed, completed });
    } catch {
      out.push({ queue, wait: -1, active: -1, failed: -1, delayed: -1, completed: -1 });
    }
  }
  return out;
}

interface JobCounts {
  renderJobsFailed1h: number;
  renderJobsFailed24h: number;
  mergeFailed1h: number;
  mergeFailed24h: number;
  brandJobsFailed24h: number;
  contentJobsFailed24h: number;
}

async function fetchJobCounts(): Promise<JobCounts> {
  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [r1h, r24h, m1h, m24h, b24h, c24h] = await Promise.all([
    admin
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", oneHourAgo),
    admin
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", oneDayAgo),
    admin
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("merge_status", "failed")
      .gte("started_at", oneHourAgo),
    admin
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("merge_status", "failed")
      .gte("started_at", oneDayAgo),
    admin
      .from("brand_research_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", oneDayAgo),
    admin
      .from("content_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("completed_at", oneDayAgo),
  ]);

  return {
    renderJobsFailed1h: r1h.count ?? 0,
    renderJobsFailed24h: r24h.count ?? 0,
    mergeFailed1h: m1h.count ?? 0,
    mergeFailed24h: m24h.count ?? 0,
    brandJobsFailed24h: b24h.count ?? 0,
    contentJobsFailed24h: c24h.count ?? 0,
  };
}

async function fetchSceneStats(): Promise<{ success: number; total: number; ratePct: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("scene_generations")
    .select("clip_url")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Array<{ clip_url: string | null }>;
  const success = rows.filter((r) => r.clip_url).length;
  return {
    success,
    total: rows.length,
    ratePct: rows.length > 0 ? Math.round((success / rows.length) * 1000) / 10 : 0,
  };
}

async function fetchMergeStats(): Promise<{ success: number; total: number; ratePct: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("render_jobs")
    .select("merge_status, merged_video_url")
    .not("merge_status", "is", null)
    .order("started_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Array<{ merge_status: string | null; merged_video_url: string | null }>;
  const success = rows.filter((r) => r.merge_status === "done" && r.merged_video_url).length;
  return {
    success,
    total: rows.length,
    ratePct: rows.length > 0 ? Math.round((success / rows.length) * 1000) / 10 : 0,
  };
}

function statusBadgeForRate(pct: number) {
  if (pct >= 95) return "success" as const;
  if (pct >= 80) return "warning" as const;
  return "destructive" as const;
}

export default async function SystemHealthPage() {
  const adminId = await requireAdmin();
  if (!adminId) notFound();

  const [queues, jobs, sceneStats, mergeStats] = await Promise.all([
    fetchQueueDepths(),
    fetchJobCounts(),
    fetchSceneStats(),
    fetchMergeStats(),
  ]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">System Health</h1>
        <p className="text-white/40 text-sm">
          Real-time queue + worker signal. Refreshes every 15s.
        </p>
      </header>

      {/* Queue depths */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-white">BullMQ queues</h2>
        <div className="glass rounded-2xl p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40 border-b border-white/[0.06]">
                <th className="text-left font-semibold py-2 px-2">Queue</th>
                <th className="text-right font-semibold py-2 px-2">Wait</th>
                <th className="text-right font-semibold py-2 px-2">Active</th>
                <th className="text-right font-semibold py-2 px-2">Failed</th>
                <th className="text-right font-semibold py-2 px-2">Delayed</th>
                <th className="text-right font-semibold py-2 px-2">Completed</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.queue} className="border-b border-white/[0.03]">
                  <td className="py-2 px-2 text-white/80 font-mono">{q.queue}</td>
                  <td className="text-right py-2 px-2 text-white/80">{q.wait < 0 ? "—" : q.wait}</td>
                  <td className="text-right py-2 px-2 text-white/80">{q.active < 0 ? "—" : q.active}</td>
                  <td className="text-right py-2 px-2">
                    {q.failed < 0 ? (
                      "—"
                    ) : q.failed > 0 ? (
                      <Badge variant="destructive" className="text-3xs">
                        {q.failed}
                      </Badge>
                    ) : (
                      <span className="text-white/40">0</span>
                    )}
                  </td>
                  <td className="text-right py-2 px-2 text-white/60">{q.delayed < 0 ? "—" : q.delayed}</td>
                  <td className="text-right py-2 px-2 text-white/50">
                    {q.completed < 0 ? "—" : q.completed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Success rates */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-white">Pipeline success (last 100)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="glass rounded-2xl p-5">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-2">
              Scene generation
            </p>
            <div className="flex items-baseline gap-3">
              <p className="text-3xl font-bold text-white">{sceneStats.ratePct}%</p>
              <Badge variant={statusBadgeForRate(sceneStats.ratePct)} className="text-3xs">
                {sceneStats.success}/{sceneStats.total}
              </Badge>
            </div>
          </div>
          <div className="glass rounded-2xl p-5">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-2">
              Merge upload
            </p>
            <div className="flex items-baseline gap-3">
              <p className="text-3xl font-bold text-white">{mergeStats.ratePct}%</p>
              <Badge variant={statusBadgeForRate(mergeStats.ratePct)} className="text-3xs">
                {mergeStats.success}/{mergeStats.total}
              </Badge>
            </div>
          </div>
        </div>
      </section>

      {/* Failure counts */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-white">Recent failures</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <FailureTile label="Render fail · 1h" value={jobs.renderJobsFailed1h} />
          <FailureTile label="Render fail · 24h" value={jobs.renderJobsFailed24h} />
          <FailureTile label="Merge fail · 1h" value={jobs.mergeFailed1h} />
          <FailureTile label="Merge fail · 24h" value={jobs.mergeFailed24h} />
          <FailureTile label="Brand · 24h" value={jobs.brandJobsFailed24h} />
          <FailureTile label="Content · 24h" value={jobs.contentJobsFailed24h} />
        </div>
      </section>

      <p className="text-3xs text-white/30">
        Last fetched · {new Date().toISOString()}
      </p>
    </div>
  );
}

function FailureTile({ label, value }: { label: string; value: number }) {
  const color = value === 0 ? "text-emerald-400" : value > 5 ? "text-rose-400" : "text-amber-400";
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
