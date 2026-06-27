import { notFound } from "next/navigation";
import { Activity, Lock } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase";
import { getOpsMetrics, type OpsMetrics } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35">{label}</p>
      <p className="mt-1.5 text-xl font-bold text-white tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-2.5">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-white/30">No data.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/35 text-xs">
              {head.map((h, i) => (
                <th key={i} className={`font-medium pb-1.5 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/[0.04]">
                {r.map((c, j) => (
                  <td key={j} className={`py-1.5 tabular-nums ${j === 0 ? "text-left text-white/75 truncate max-w-[220px]" : "text-right text-white/60"}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Dashboard({ m }: { m: OpsMetrics }) {
  const monthly = m.by_day.reduce((s, d) => s + d.cost_usd, 0);
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 lg:px-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2.5">
          <Activity size={18} className="text-emerald-400" />
          <h1 className="text-xl font-bold text-white tracking-tight">AI Operations</h1>
          <span className="text-3xs uppercase tracking-wider text-white/30">last {m.window_days}d · measured</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/40">
          <Lock size={11} /> Internal · Admin
        </span>
      </div>

      {m.total_calls === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <p className="text-white/70 font-medium">No AI usage recorded yet.</p>
          <p className="text-sm text-white/40 mt-1.5 max-w-md mx-auto">
            Every Gemini / Imagen call records to the usage ledger as the pipeline runs. Metrics populate here
            from measured telemetry — generate a creative or campaign to see them.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Total AI calls" value={`${m.total_calls}`} />
            <Stat label="Provider cost" value={usd(m.total_provider_cost_usd)} hint={`customer ${usd(m.total_customer_cost_usd)}`} />
            <Stat label="Spend (window)" value={usd(monthly)} hint={`${m.by_day.length} active days`} />
            <Stat label="Avg latency" value={ms(m.avg_latency_ms)} />
            <Stat label="Failure rate" value={`${Math.round(m.failure_rate * 100)}%`} />
            <Stat label="Retry rate" value={`${Math.round(m.retry_rate * 100)}%`} />
            <Stat label="Cost / creative" value={m.cost_per_creative_usd == null ? "—" : usd(m.cost_per_creative_usd)} hint={`${m.distinct_creatives} creatives`} />
            <Stat label="Cost / campaign" value={m.cost_per_campaign_usd == null ? "—" : usd(m.cost_per_campaign_usd)} hint={`${m.distinct_campaigns} campaigns`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <Table
              title="By provider"
              head={["Provider", "Calls", "Cost", "Avg lat", "Fail%"]}
              rows={m.by_provider.map((p) => [p.provider, p.calls, usd(p.cost_usd), ms(p.avg_latency_ms), `${Math.round(p.failure_rate * 100)}%`])}
            />
            <Table
              title="By operation (cost by AI feature)"
              head={["Operation", "Calls", "Cost", "Avg lat"]}
              rows={m.by_operation.map((o) => [o.operation, o.calls, usd(o.cost_usd), ms(o.avg_latency_ms)])}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Table title="Spend per customer (billing)" head={["User", "Calls", "Cost"]} rows={m.by_user.slice(0, 12).map((u) => [u.user_id, u.calls, usd(u.cost_usd)])} />
            <Table title="Spend per campaign" head={["Campaign", "Calls", "Cost"]} rows={m.by_campaign.slice(0, 12).map((c) => [c.campaign_id.slice(0, 8), c.calls, usd(c.cost_usd)])} />
            <Table title="Spend per creative" head={["Creative", "Calls", "Cost"]} rows={m.by_creative.slice(0, 12).map((c) => [c.creative_id.slice(0, 8), c.calls, usd(c.cost_usd)])} />
          </div>
        </>
      )}
    </div>
  );
}

export default async function OpsPage() {
  const adminId = await requireAdmin();
  if (!adminId) notFound(); // hide existence from non-admins
  const metrics = await getOpsMetrics(createAdminClient(), 30);
  return <Dashboard m={metrics} />;
}
