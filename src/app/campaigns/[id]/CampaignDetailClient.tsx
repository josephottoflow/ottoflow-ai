"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Image as ImageIcon } from "lucide-react";

interface Asset {
  id: string;
  role: string;
  status: string;
  image_url: string | null;
  headline: string;
  cta: string;
  world: string;
  funnel_position: string;
}
interface Progress {
  total: number;
  ready: number;
  generating: number;
  failed: number;
  percent: number;
  label: string;
  done: boolean;
}
interface QA {
  coverage_score: number;
  consistency_score: number;
  diversity_score: number;
  readiness_score: number;
  overall_score: number;
  issues: string[];
}
interface Strategy {
  campaign_type?: string;
  primary_objective?: string;
  audience?: string;
  awareness_stage?: string;
  core_message?: string;
  primary_cta?: string;
  funnel_position?: string;
}
interface CampaignResp {
  campaign: { id: string; title: string | null; prompt: string; platform: string; status: string; strategy: Strategy | null };
  assets: Asset[];
  progress: Progress;
  qa: QA;
}

const fmt = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function StatusIcon({ status }: { status: string }) {
  if (status === "ready") return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (status === "failed") return <AlertTriangle size={13} className="text-rose-400" />;
  return <Loader2 size={13} className="text-amber-400 animate-spin" />;
}

export function CampaignDetailClient({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to load campaign");
        return;
      }
      setData(json);
    } catch {
      setError("Network error");
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the campaign is still planning/generating.
  const polling = !data || data.campaign.status === "planning" || data.campaign.status === "generating" || !data.progress.done;
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [polling, load]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6 lg:px-8">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
          <ArrowLeft size={13} /> Campaigns
        </Link>
        <div className="glass rounded-2xl p-6 text-sm text-rose-300">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 text-center text-white/40">
        <Loader2 size={20} className="animate-spin mx-auto" />
      </div>
    );
  }

  const { campaign, assets, progress, qa } = data;
  const s = campaign.strategy;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:px-8">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={13} /> Campaigns
      </Link>

      <h1 className="text-xl font-bold text-white tracking-tight">{campaign.title || campaign.prompt}</h1>
      <p className="text-sm text-white/45 mt-0.5 capitalize">
        {campaign.platform}
        {s?.campaign_type ? ` · ${fmt(s.campaign_type)}` : ""} · {campaign.status}
      </p>

      {/* Progress */}
      <div className="glass rounded-2xl p-5 my-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-white/80">
            {progress.done ? "Campaign complete" : "Generating campaign…"}
          </p>
          <p className="text-xs text-white/45 tabular-nums">{progress.label}</p>
        </div>
        <div className="h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${Math.max(progress.percent, progress.total ? 4 : 0)}%` }}
          />
        </div>
        {progress.failed > 0 && (
          <p className="text-xs text-rose-400 mt-2">{progress.failed} asset(s) failed to generate.</p>
        )}
      </div>

      {/* Strategy */}
      {s && (
        <div className="glass rounded-2xl p-5 mb-6 space-y-1.5 text-sm">
          <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-1">Strategy</p>
          {s.primary_objective && <p className="text-white/70"><span className="text-white/40">Objective:</span> {s.primary_objective}</p>}
          {s.audience && <p className="text-white/70"><span className="text-white/40">Audience:</span> {s.audience}{s.awareness_stage ? ` · ${fmt(s.awareness_stage)}` : ""}</p>}
          {s.core_message && <p className="text-white/70"><span className="text-white/40">Message:</span> {s.core_message}</p>}
          {s.primary_cta && <p className="text-white/70"><span className="text-white/40">CTA:</span> {s.primary_cta}{s.funnel_position ? ` · ${s.funnel_position}` : ""}</p>}
        </div>
      )}

      {/* Campaign QA */}
      {progress.total > 0 && (
        <div className="glass rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white/80">Campaign QA</p>
            <span className="text-lg font-bold text-white tabular-nums">{qa.overall_score}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {([["Coverage", qa.coverage_score], ["Consistency", qa.consistency_score], ["Diversity", qa.diversity_score], ["Readiness", qa.readiness_score]] as const).map(
              ([label, val]) => (
                <div key={label} className="rounded-xl bg-white/[0.03] p-2.5">
                  <p className="text-3xs uppercase tracking-wider text-white/35">{label}</p>
                  <p className="text-base font-bold text-white/85 tabular-nums">{val}</p>
                </div>
              ),
            )}
          </div>
          {qa.issues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {qa.issues.map((iss, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-white/50">
                  <span className="text-amber-400">•</span>
                  {iss}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Assets */}
      <p className="text-sm font-semibold text-white/80 mb-3">Assets ({assets.length})</p>
      {assets.length === 0 ? (
        <p className="text-sm text-white/40">Planning the package…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {assets.map((a) => (
            <div key={a.id} className="glass rounded-2xl overflow-hidden">
              <div className="aspect-[1200/627] bg-white/[0.03] flex items-center justify-center">
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image_url} alt={a.role} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-white/25 flex flex-col items-center gap-1.5">
                    {a.status === "failed" ? <AlertTriangle size={18} /> : a.status === "ready" ? <ImageIcon size={18} /> : <Loader2 size={18} className="animate-spin" />}
                    <span className="text-3xs uppercase tracking-wider">{a.status}</span>
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <StatusIcon status={a.status} />
                  <span className="text-3xs font-semibold uppercase tracking-wider text-violet-300">{a.role || "asset"}</span>
                  {a.funnel_position && <span className="ml-auto text-3xs text-white/30">{a.funnel_position}</span>}
                </div>
                <p className="text-sm text-white/80 truncate">{a.headline || "—"}</p>
                {a.cta && <p className="text-xs text-white/40 truncate">CTA: {a.cta}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
