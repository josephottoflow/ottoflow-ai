"use client";

/**
 * Campaign Workspace (Campaign Workspace V1) — the operator's mission control for
 * a single campaign. Composition, not replacement: it wraps the existing
 * CampaignDetailClient (the execution/asset view) as the Content tab and adds the
 * header, live relationship metrics, lifecycle timeline, operator action bar, and
 * the Overview / Research / Library / Activity / Settings tabs.
 *
 * All metrics derive from relationships (served by GET /api/campaigns/[id]). No
 * data is duplicated; existing behaviour is untouched.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Star, Archive, Copy, Download, FlaskConical, Lightbulb, PenLine,
  CalendarClock, Send, Loader2, CheckCircle2, Circle,
} from "lucide-react";
import type { DbCampaign } from "@/lib/types";
import {
  campaignDisplayName, campaignTimeline, type CampaignMetrics, type CampaignLifecycleStage,
} from "@/lib/db-campaigns";
import { CampaignDetailClient } from "./CampaignDetailClient";

type Tab = "overview" | "research" | "content" | "library" | "activity" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "research", label: "Research" },
  { id: "content", label: "Content" },
  { id: "library", label: "Library" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

interface Asset {
  id: string; role: string; status: string; image_url: string | null;
  headline: string; cta: string; world: string; funnel_position: string;
}
interface DetailResponse {
  campaign: DbCampaign;
  assets: Asset[];
  metrics: CampaignMetrics | null;
}

const STAGE_LABEL: Record<CampaignLifecycleStage, string> = {
  planning: "Planning", research: "Research", in_progress: "In Progress",
  review: "Review", scheduled: "Scheduled", live: "Live", completed: "Completed",
};

function labelStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function CampaignWorkspace({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* keep last */
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const campaign = data?.campaign;
  const metrics = data?.metrics ?? null;
  const timeline = useMemo(
    () => (campaign && metrics ? campaignTimeline(campaign.status, metrics) : []),
    [campaign, metrics],
  );

  async function patch(body: Partial<DbCampaign>) {
    if (!campaign) return;
    setData((d) => (d ? { ...d, campaign: { ...d.campaign, ...body } } : d));
    try {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    } catch { /* best-effort */ }
  }

  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateOf: campaignId }),
      });
      if (res.ok) {
        const { campaign: c } = await res.json();
        router.push(`/campaigns/${c.id}`);
      }
    } finally { setBusy(false); }
  }

  function exportJson() {
    if (!campaign) return;
    const blob = new Blob([JSON.stringify({ campaign, metrics, assets: data?.assets }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${campaignId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!campaign) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 flex items-center gap-2 text-white/50 text-sm">
        <Loader2 size={16} className="animate-spin" /> Loading campaign…
      </div>
    );
  }

  const m = metrics;
  const metricTiles: { label: string; value: number | string }[] = [
    { label: "Research Ideas", value: m?.researchIdeas ?? 0 },
    { label: "Drafts", value: m?.drafts ?? 0 },
    { label: "Approved", value: m?.approved ?? 0 },
    { label: "Scheduled", value: m?.scheduled ?? 0 },
    { label: "Published", value: m?.published ?? 0 },
    { label: "Completion", value: `${m?.completionPct ?? 0}%` },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:px-8">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/80 mb-4">
        <ArrowLeft size={13} /> Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <span className="mt-1 w-3 h-3 rounded-full flex-shrink-0" style={{ background: campaign.color || "#F2A863" }} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-white tracking-tight truncate">{campaignDisplayName(campaign)}</h1>
          {campaign.objective && <p className="text-sm text-white/50 mt-0.5 line-clamp-2">{campaign.objective}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-3xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60">
              {labelStatus(campaign.status)}
            </span>
            {campaign.priority && campaign.priority !== "medium" && (
              <span className="text-3xs uppercase tracking-wider text-white/40">{campaign.priority} priority</span>
            )}
            {campaign.owner && <span className="text-3xs text-white/40">· {campaign.owner}</span>}
          </div>
        </div>
        <button onClick={() => patch({ is_favorite: !(campaign.is_favorite ?? false) })} title="Favorite" className="text-white/30 hover:text-[#F2A863]">
          <Star size={17} className={campaign.is_favorite ? "fill-[#F2A863] text-[#F2A863]" : ""} />
        </button>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {metricTiles.map((t) => (
          <div key={t.label} className="glass rounded-xl px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-white/90 leading-none">{t.value}</p>
            <p className="text-3xs uppercase tracking-wider text-white/35 mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Lifecycle timeline */}
      {timeline.length > 0 && (
        <div className="glass rounded-xl px-4 py-3 mb-4 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {timeline.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-1">
                <div className="flex items-center gap-1.5">
                  {s.done ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <Circle size={14} className={s.active ? "text-[#F2A863]" : "text-white/20"} />
                  )}
                  <span className={`text-xs ${s.active ? "text-white/90 font-medium" : s.done ? "text-white/55" : "text-white/30"}`}>
                    {STAGE_LABEL[s.stage]}
                  </span>
                </div>
                {i < timeline.length - 1 && <span className="w-5 h-px bg-white/10 mx-1" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operator action bar */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        <Link href="/brands" className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5"><FlaskConical size={13} /> Create Research</Link>
        <Link href="/brands" className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5"><Lightbulb size={13} /> Generate Ideas</Link>
        <Link href="/content" className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5"><PenLine size={13} /> New Content</Link>
        <button onClick={duplicate} disabled={busy} className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5 disabled:opacity-50"><Copy size={13} /> Duplicate</button>
        <button onClick={() => patch({ is_archived: !(campaign.is_archived ?? false) })} className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5"><Archive size={13} /> {campaign.is_archived ? "Unarchive" : "Archive"}</button>
        <button onClick={exportJson} className="glass card-hover rounded-lg px-3 py-1.5 text-xs text-white/70 flex items-center gap-1.5"><Download size={13} /> Export</button>
        <span className="rounded-lg px-3 py-1.5 text-xs text-white/25 flex items-center gap-1.5 cursor-not-allowed" title="Coming soon"><CalendarClock size={13} /> Schedule</span>
        <span className="rounded-lg px-3 py-1.5 text-xs text-white/25 flex items-center gap-1.5 cursor-not-allowed" title="Coming soon"><Send size={13} /> Publish</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/8 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-[#F2A863] text-white" : "border-transparent text-white/45 hover:text-white/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab campaign={campaign} metrics={m} />}
      {tab === "research" && (
        <TabEmpty
          count={m?.researchIdeas ?? 0} noun="research idea"
          cta={{ href: "/brands", label: "Open research" }}
          hint="Research ideas linked to this campaign. Mine opportunities in the brand's research surface, then link them here."
        />
      )}
      {tab === "content" && (
        <div>
          <p className="text-3xs uppercase tracking-wider text-white/30 mb-3">Content &amp; generated assets</p>
          <CampaignDetailClient campaignId={campaignId} />
        </div>
      )}
      {tab === "library" && <LibraryTab assets={data?.assets ?? []} />}
      {tab === "activity" && <ActivityTab assets={data?.assets ?? []} campaign={campaign} />}
      {tab === "settings" && <SettingsTab campaign={campaign} onSave={patch} />}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function OverviewTab({ campaign, metrics }: { campaign: DbCampaign; metrics: CampaignMetrics | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Objective" value={campaign.objective} />
      <Field label="Target Audience" value={campaign.target_audience} />
      <Field label="Primary CTA" value={campaign.primary_cta} />
      <Field label="Success Metrics" value={campaign.success_metrics} />
      <Field label="Channels" value={(campaign.channels ?? []).join(", ")} />
      <Field label="Tags" value={(campaign.tags ?? []).map((t) => `#${t}`).join(" ")} />
      <Field label="Dates" value={[campaign.start_date, campaign.end_date].filter(Boolean).join(" → ")} />
      <Field label="Content" value={`${metrics?.totalContent ?? 0} items · ${metrics?.creatives ?? 0} creatives`} />
      {campaign.notes && (
        <div className="glass rounded-xl p-3 sm:col-span-2">
          <p className="text-3xs uppercase tracking-wider text-white/30 mb-1">Notes</p>
          <p className="text-sm text-white/70 whitespace-pre-wrap">{campaign.notes}</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-3xs uppercase tracking-wider text-white/30 mb-1">{label}</p>
      <p className="text-sm text-white/75">{value || <span className="text-white/25">—</span>}</p>
    </div>
  );
}

function TabEmpty({ count, noun, cta, hint }: { count: number; noun: string; cta: { href: string; label: string }; hint: string }) {
  return (
    <div className="glass rounded-2xl p-6 text-center">
      <p className="text-2xl font-bold text-white/90">{count}</p>
      <p className="text-sm text-white/50 mt-0.5">{count === 1 ? noun : `${noun}s`} linked</p>
      <p className="text-xs text-white/35 mt-3 max-w-sm mx-auto">{hint}</p>
      <Link href={cta.href} className="inline-block mt-4 text-xs text-[#F2A863] hover:underline">{cta.label} →</Link>
    </div>
  );
}

function LibraryTab({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) return <p className="text-sm text-white/40">No assets yet.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {assets.map((a) => (
        <li key={a.id} className="glass rounded-xl p-3">
          <p className="text-sm text-white/80 truncate">{a.headline || a.role || "Asset"}</p>
          <p className="text-xs text-white/40 truncate mt-0.5">{a.role} · {labelStatus(a.status)}</p>
        </li>
      ))}
    </ul>
  );
}

function ActivityTab({ assets, campaign }: { assets: Asset[]; campaign: DbCampaign }) {
  const events = [
    { t: campaign.created_at, label: "Campaign created" },
    ...assets.map((a) => ({ t: campaign.updated_at, label: `Asset ${a.role || a.id.slice(0, 6)} · ${labelStatus(a.status)}` })),
  ];
  return (
    <ul className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="glass rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F2A863]/70" />
          <span className="text-sm text-white/70 flex-1 truncate">{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SettingsTab({ campaign, onSave }: { campaign: DbCampaign; onSave: (b: Partial<DbCampaign>) => void }) {
  const [form, setForm] = useState({
    name: campaign.name ?? campaign.title ?? "",
    objective: campaign.objective ?? "",
    owner: campaign.owner ?? "",
    priority: campaign.priority ?? "medium",
    status: campaign.status,
    target_audience: campaign.target_audience ?? "",
    primary_cta: campaign.primary_cta ?? "",
    success_metrics: campaign.success_metrics ?? "",
    channels: (campaign.channels ?? []).join(", "),
    tags: (campaign.tags ?? []).join(", "),
    color: campaign.color ?? "#F2A863",
    notes: campaign.notes ?? "",
  });
  const [saved, setSaved] = useState(false);

  function save() {
    onSave({
      name: form.name || null,
      objective: form.objective || null,
      owner: form.owner || null,
      priority: form.priority as DbCampaign["priority"],
      status: form.status,
      target_audience: form.target_audience || null,
      primary_cta: form.primary_cta || null,
      success_metrics: form.success_metrics || null,
      channels: form.channels.split(",").map((s) => s.trim()).filter(Boolean),
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      color: form.color || null,
      notes: form.notes || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = "w-full glass rounded-lg px-3 py-2 text-sm text-white/85 focus:outline-none focus:ring-1 focus:ring-[#F2A863]/40";
  const lbl = "text-3xs uppercase tracking-wider text-white/35 mb-1 block";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block"><span className={lbl}>Name</span><input className={input} value={form.name} onChange={set("name")} /></label>
      <label className="block"><span className={lbl}>Owner</span><input className={input} value={form.owner} onChange={set("owner")} /></label>
      <label className="block"><span className={lbl}>Status</span>
        <select className={input} value={form.status} onChange={set("status")}>
          {["planning", "research", "in_progress", "review", "scheduled", "live", "completed"].map((s) => (
            <option key={s} value={s} className="bg-neutral-900">{labelStatus(s)}</option>
          ))}
        </select>
      </label>
      <label className="block"><span className={lbl}>Priority</span>
        <select className={input} value={form.priority} onChange={set("priority")}>
          {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p} className="bg-neutral-900">{labelStatus(p)}</option>)}
        </select>
      </label>
      <label className="block sm:col-span-2"><span className={lbl}>Objective</span><input className={input} value={form.objective} onChange={set("objective")} /></label>
      <label className="block"><span className={lbl}>Target Audience</span><input className={input} value={form.target_audience} onChange={set("target_audience")} /></label>
      <label className="block"><span className={lbl}>Primary CTA</span><input className={input} value={form.primary_cta} onChange={set("primary_cta")} /></label>
      <label className="block"><span className={lbl}>Channels (comma-sep)</span><input className={input} value={form.channels} onChange={set("channels")} /></label>
      <label className="block"><span className={lbl}>Tags (comma-sep)</span><input className={input} value={form.tags} onChange={set("tags")} /></label>
      <label className="block"><span className={lbl}>Success Metrics</span><input className={input} value={form.success_metrics} onChange={set("success_metrics")} /></label>
      <label className="block"><span className={lbl}>Color</span><input className={input} value={form.color} onChange={set("color")} /></label>
      <label className="block sm:col-span-2"><span className={lbl}>Notes</span><textarea className={input} rows={3} value={form.notes} onChange={set("notes")} /></label>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button onClick={save} className="rounded-lg px-4 py-2 text-sm font-medium bg-[#F2A863] text-black hover:bg-[#f4b578]">Save changes</button>
        {saved && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Saved</span>}
      </div>
    </div>
  );
}
