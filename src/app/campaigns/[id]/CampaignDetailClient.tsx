"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { toAppMediaUrl } from "@/lib/media-url";

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
interface PackagePlanItem {
  role?: string;
  phase?: string;
  narrative_beat?: string;
  funnel_stage?: string;
  cta?: string;
}
interface StoryReview {
  momentum_score: number;
  purpose_score: number;
  cta_progression_score: number;
  objection_score: number;
  trust_score: number;
  overall_score: number;
  would_approve: boolean;
  issues: string[];
  suggestions: string[];
}
interface ValidationCheck {
  name: string;
  pass: boolean;
  detail: string;
}
interface Validation {
  checks: ValidationCheck[];
  score: number;
  blocking_issues: string[];
  complete: boolean;
}
interface Strategy {
  campaign_type?: string;
  primary_objective?: string;
  audience?: string;
  awareness_stage?: string;
  core_message?: string;
  primary_cta?: string;
  funnel_position?: string;
  // Campaign Brain (Sprint 25.1)
  narrative?: string;
  primary_story?: string;
  supporting_stories?: string[];
  emotional_journey?: string[];
  cta_progression?: string[];
  package?: PackagePlanItem[];
  story_review?: StoryReview;
  // Campaign Reasoning (Sprint 26)
  business_objective?: { why_exists?: string; expected_outcome?: string; success_metric?: string };
  audience_state?: { beliefs?: string; frustrations?: string; objections?: string; motivations?: string; awareness?: string; trust_level?: string };
  desired_transformation?: { believe?: string; feel?: string; understand?: string; want?: string; obvious_action?: string };
  trust_strategy?: { proof_required?: string[]; objections_to_answer?: string[]; credibility?: string[]; evidence?: string[]; never_claim?: string[] };
  acts?: Array<{ act?: string; intent?: string }>;
  learning_summary?: string;
  validation?: Validation;
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

      {/* CMO reasoning — people → strategy → transformation → trust (Sprint 26) */}
      {(s?.business_objective || s?.audience_state || s?.desired_transformation) && (
        <div className="glass rounded-2xl p-5 mb-6 space-y-3 text-sm">
          <p className="text-3xs font-semibold uppercase tracking-widest text-white/35">How the Brain reasoned</p>
          {s.business_objective?.why_exists && (
            <div>
              <p className="text-white/45 text-xs mb-0.5">Why this campaign exists</p>
              <p className="text-white/75">{s.business_objective.why_exists}</p>
              {s.business_objective.success_metric && (
                <p className="text-xs text-white/45 mt-0.5">Success metric: <span className="text-white/70">{s.business_objective.success_metric}</span></p>
              )}
            </div>
          )}
          {s.audience_state?.beliefs && (
            <div>
              <p className="text-white/45 text-xs mb-0.5">Audience right now</p>
              <p className="text-white/70">Believes: {s.audience_state.beliefs}</p>
              {s.audience_state.objections && <p className="text-white/70">Objects: {s.audience_state.objections}</p>}
              {s.audience_state.trust_level && <p className="text-xs text-white/45">Trust level: {s.audience_state.trust_level}</p>}
            </div>
          )}
          {s.desired_transformation?.obvious_action && (
            <div>
              <p className="text-white/45 text-xs mb-0.5">Desired transformation</p>
              {s.desired_transformation.believe && <p className="text-white/70">Should believe: {s.desired_transformation.believe}</p>}
              <p className="text-white/70">Obvious next action: {s.desired_transformation.obvious_action}</p>
            </div>
          )}
          {s.trust_strategy?.proof_required && s.trust_strategy.proof_required.length > 0 && (
            <div>
              <p className="text-white/45 text-xs mb-0.5">Trust strategy</p>
              <p className="text-white/70">Proof required: {s.trust_strategy.proof_required.join("; ")}</p>
              {s.trust_strategy.never_claim && s.trust_strategy.never_claim.length > 0 && (
                <p className="text-xs text-rose-300/80">Never claim: {s.trust_strategy.never_claim.join("; ")}</p>
              )}
            </div>
          )}
          {s.acts && s.acts.length > 0 && (
            <div>
              <p className="text-white/45 text-xs mb-1">Campaign acts</p>
              <div className="flex flex-wrap gap-1.5">
                {s.acts.map((a, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-white/70" title={a.intent}>
                    {a.act}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Blueprint validation — deterministic SOURCE OF TRUTH (Sprint 26) */}
      {s?.validation && s.validation.checks.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white/80">
              Blueprint validation
              <span className="ml-2 text-3xs font-normal uppercase tracking-wider text-white/30">source of truth</span>
            </p>
            <span className={`text-sm font-bold tabular-nums ${s.validation.complete ? "text-emerald-400" : "text-amber-400"}`}>
              {s.validation.score}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {s.validation.checks.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs" title={c.detail}>
                {c.pass ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />}
                <span className={c.pass ? "text-white/65" : "text-white/80"}>{c.name}</span>
              </div>
            ))}
          </div>
          {s.validation.blocking_issues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {s.validation.blocking_issues.map((iss, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-amber-300/90">
                  <span>•</span>
                  {iss}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Campaign Brain — narrative + messaging hierarchy (Sprint 25.1) */}
      {s?.narrative && (
        <div className="glass rounded-2xl p-5 mb-6 space-y-2">
          <p className="text-3xs font-semibold uppercase tracking-widest text-white/35">Campaign narrative</p>
          <p className="text-base font-semibold text-white/90">“{s.narrative}”</p>
          {s.primary_story && <p className="text-sm text-white/60">{s.primary_story}</p>}
          {s.supporting_stories && s.supporting_stories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {s.supporting_stories.map((st, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-violet-600/[0.1] border border-violet-500/20 text-violet-200">
                  {st}
                </span>
              ))}
            </div>
          )}
          {s.cta_progression && s.cta_progression.length > 0 && (
            <p className="text-xs text-white/50 pt-1">
              <span className="text-white/35">CTA progression:</span> {s.cta_progression.join("  →  ")}
            </p>
          )}
          {s.emotional_journey && s.emotional_journey.length > 0 && (
            <p className="text-xs text-white/50">
              <span className="text-white/35">Emotional arc:</span> {s.emotional_journey.join("  →  ")}
            </p>
          )}
        </div>
      )}

      {/* Campaign calendar — assets assigned to narrative beats */}
      {s?.package && s.package.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-6">
          <p className="text-3xs font-semibold uppercase tracking-widest text-white/35 mb-3">Campaign calendar</p>
          <ol className="space-y-2">
            {s.package.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="flex-shrink-0 mt-0.5 text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/[0.12] text-cyan-300 min-w-[68px] text-center">
                  {p.phase || "—"}
                </span>
                <div className="min-w-0">
                  <p className="text-white/80">
                    <span className="text-white/55">{p.role}</span>
                    {p.narrative_beat ? ` → ${p.narrative_beat}` : ""}
                  </p>
                  {(p.cta || p.funnel_stage) && (
                    <p className="text-3xs text-white/35">
                      {p.funnel_stage ? `${p.funnel_stage}` : ""}
                      {p.cta ? `${p.funnel_stage ? " · " : ""}CTA: ${p.cta}` : ""}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Campaign review — the marketer's verdict on the whole story */}
      {s?.story_review && (
        <div className="glass rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white/80">
              CMO review
              <span className="ml-2 text-3xs font-normal uppercase tracking-wider text-white/30">advisory</span>
              <span className={`ml-2 text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${s.story_review.would_approve ? "bg-emerald-500/[0.12] text-emerald-300" : "bg-amber-500/[0.12] text-amber-300"}`}>
                {s.story_review.would_approve ? "CMO would approve" : "Needs work"}
              </span>
            </p>
            <span className="text-lg font-bold text-white tabular-nums">{s.story_review.overall_score}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {([["Momentum", s.story_review.momentum_score], ["Purpose", s.story_review.purpose_score], ["CTA arc", s.story_review.cta_progression_score], ["Objections", s.story_review.objection_score], ["Trust", s.story_review.trust_score]] as const).map(
              ([label, val]) => (
                <div key={label} className="rounded-xl bg-white/[0.03] p-2.5">
                  <p className="text-3xs uppercase tracking-wider text-white/35">{label}</p>
                  <p className="text-base font-bold text-white/85 tabular-nums">{val}</p>
                </div>
              ),
            )}
          </div>
          {s.story_review.issues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {s.story_review.issues.map((iss, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-white/50">
                  <span className="text-amber-400">•</span>
                  {iss}
                </li>
              ))}
            </ul>
          )}
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
                  <img src={toAppMediaUrl(a.image_url) ?? undefined} alt={a.role} className="w-full h-full object-cover" />
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
