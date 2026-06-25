"use client";

/**
 * VideoConfigModal — platform-aware Generate Video configurator (enterprise UX).
 *
 * Section order: Platform → Platform Summary → Aspect → Resolution → Duration →
 * Visual Generation → Rendering Mode → Quality → Branding → Content Validation →
 * Estimated Cost → Estimated Time → Production Readiness → Generate. Every control
 * re-runs the FREE dryRun (no spend) so cost/validation update live.
 *
 * Honesty rules: every visible option is either fully wired OR clearly disabled
 * ("Coming soon"). No fake functionality, no silent overrides. Presentation only —
 * NO pipeline/pricing/worker/API changes. PLATFORM_PROFILES is the source of truth;
 * fields not backed by real data render "Coming soon" rather than invented values.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clapperboard, X, Lock, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_PROFILES, type Platform, type AspectRatio } from "@/lib/platform/profiles";
import { validatePlatformContent, CONTENT_LIMITS } from "@/lib/platform/content-validation";
import type { RenderCostEstimate } from "@/lib/video/cost";
import type { StrategySummary } from "@/components/CostApprovalModal";

type Resolution = "720p" | "1080p";
type Quality = "fast" | "balanced" | "best";
type DurationChoice = "auto" | "15" | "20" | "30" | "45" | "60";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "commercial_story", label: "Commercial Story" },
  { value: "product_demo", label: "Product Demo" },
  { value: "explainer", label: "Explainer" },
  { value: "ai_storytelling", label: "AI Storytelling" },
  { value: "founder_video", label: "Founder Video" },
  { value: "social_ad", label: "Social Ad" },
];

/** Honest per-mode engine + use-case (mirrors route UI_MODE_TO_ENGINE; only 2
 * real engines exist — modes that share one say so). */
const MODE_DETAIL: Record<string, { engine: string; bestFor: string }> = {
  commercial_story: { engine: "Human-first Story Engine", bestFor: "Brand storytelling" },
  product_demo: { engine: "Human-first Story Engine", bestFor: "Product videos" },
  explainer: { engine: "Human-first Story Engine", bestFor: "Explainers" },
  ai_storytelling: { engine: "AI Storytelling Engine", bestFor: "Abstract brand awareness" },
  founder_video: { engine: "Human-first Story Engine", bestFor: "Founder & thought leadership" },
  social_ad: { engine: "Human-first Story Engine", bestFor: "Short social ads" },
};

/** Visual Generation — Auto + AI reflect the live AI-first pipeline; Stock &
 * Hybrid need pipeline wiring → "Coming soon". */
const SOURCE_OPTIONS: { value: string; label: string; desc: string; enabled: boolean }[] = [
  { value: "auto", label: "Auto", desc: "OttoFlow picks the best approach (Hybrid → AI → Stock) by quality, speed & cost.", enabled: true },
  { value: "ai", label: "AI Generated", desc: "Creates original AI-generated scenes. Best for commercials, product videos, brand storytelling.", enabled: true },
  { value: "stock", label: "Premium Stock Footage", desc: "Licensed cinematic stock + AI editing. Best for corporate, real estate, travel, lifestyle.", enabled: false },
  { value: "hybrid", label: "Hybrid", desc: "AI hero scenes + premium stock. Highest production quality.", enabled: false },
];

const SOURCE_TABLE: { src: string; cost: string; speed: string; quality: string }[] = [
  { src: "Auto", cost: "⭐⭐⭐", speed: "⭐⭐⭐", quality: "⭐⭐⭐" },
  { src: "AI Generated", cost: "$$$$", speed: "Slow", quality: "★★★★★" },
  { src: "Premium Stock", cost: "$", speed: "Fast", quality: "★★★★☆" },
  { src: "Hybrid", cost: "$$", speed: "Medium", quality: "★★★★★" },
];

const PLATFORM_ORDER: Platform[] = [
  "linkedin", "tiktok", "instagram_reels", "instagram_feed",
  "facebook_reels", "facebook_feed", "youtube_shorts", "youtube_standard", "x",
];

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "1:1", label: "1:1 · Square" },
  { value: "16:9", label: "16:9 · Landscape" },
];

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface VideoConfigModalProps {
  open: boolean;
  brandId: string;
  contentItemId: string;
  contentTitle?: string;
  contentBody?: string | null;
  contentHashtags?: string[] | null;
  onClose: () => void;
}

interface Palette { primary?: string | null; secondary?: string | null; accent?: string | null; }
interface Branding { palette?: Palette | null; brandName?: string | null; logoAssetId?: string | null; }
interface GenResponse {
  strategy?: StrategySummary;
  estimate?: RenderCostEstimate;
  renderJobId?: string;
  error?: string;
  compositionPlan?: { branding?: Branding | null } | null;
}

function money(n: number | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}
function fmtTimeRange(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const lo = Math.max(1, Math.round((sec * 0.8) / 60));
  const hi = Math.max(lo + 1, Math.round((sec * 1.2) / 60));
  return `${lo}–${hi} minutes`;
}

export function VideoConfigModal({
  open, brandId, contentItemId, contentTitle, contentBody, contentHashtags, onClose,
}: VideoConfigModalProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [aspect, setAspect] = useState<AspectRatio>(PLATFORM_PROFILES.linkedin.video.aspect);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [duration, setDuration] = useState<DurationChoice>("auto");
  const [source, setSource] = useState<string>("auto");
  const [mode, setMode] = useState<string>("commercial_story");
  const [quality, setQuality] = useState<Quality>("best");

  const [estimate, setEstimate] = useState<RenderCostEstimate | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strategyRef = useRef<StrategySummary | null>(null);
  const reqId = useRef(0);

  function onPlatform(p: Platform) {
    setPlatform(p);
    setAspect(PLATFORM_PROFILES[p].video.aspect);
    setDuration("auto");
  }

  const body = useCallback(
    (extra: Record<string, unknown>) => ({
      brandId, contentItemId, platform, aspect, resolution, quality, mode,
      ...(duration !== "auto" ? { durationSec: Number(duration) } : {}),
      ...extra,
    }),
    [brandId, contentItemId, platform, aspect, resolution, quality, mode, duration],
  );

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setEstimating(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/video/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body({ dryRun: true })),
        });
        const json = (await res.json().catch(() => ({}))) as GenResponse;
        if (id !== reqId.current) return;
        if (!res.ok || !json.estimate) throw new Error(json.error ?? `Estimate failed (${res.status})`);
        setEstimate(json.estimate);
        strategyRef.current = json.strategy ?? null;
        setBranding(json.compositionPlan?.branding ?? null);
      } catch (err) {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setEstimate(null);
      } finally {
        if (id === reqId.current) setEstimating(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, body]);

  const validation = validatePlatformContent(platform, {
    caption: contentBody ?? null, hashtags: contentHashtags ?? null,
    title: contentTitle ?? null, description: contentBody ?? null,
  });

  async function onGenerate() {
    if (approving || !validation.ok) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ approve: true, strategy: strategyRef.current ?? undefined })),
      });
      const json = (await res.json().catch(() => ({}))) as GenResponse;
      if (!res.ok || !json.renderJobId) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.push(`/video/${json.renderJobId}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  }

  if (!open) return null;

  const profile = PLATFORM_PROFILES[platform];
  const limits = CONTENT_LIMITS[platform];
  const bd = estimate?.breakdown;
  const labelCls = "text-3xs uppercase tracking-wider text-white/40 font-semibold";
  const selCls =
    "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 " +
    "focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

  // CHANGE 3 — single readiness state (replaces scattered messages).
  const readiness = error
    ? { tone: "red" as const, icon: AlertCircle, title: "Action needed", detail: error }
    : !validation.ok
      ? { tone: "amber" as const, icon: AlertTriangle, title: "Needs regeneration", detail: `Post copy doesn't meet ${profile.label} limits — ${validation.checks.filter((c) => !c.ok).map((c) => `${c.field} ${c.actual} (needs ${c.rule})`).join("; ")}.` }
      : estimating || !estimate
        ? { tone: "neutral" as const, icon: Loader2, title: "Preparing estimate…", detail: "Calculating cost and validating content." }
        : { tone: "green" as const, icon: CheckCircle2, title: "Ready", detail: "Everything required has passed validation. You can generate." };

  const readyColors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "rgba(16,185,129,0.10)", fg: "#34d399" },
    amber: { bg: "rgba(245,158,11,0.10)", fg: "#fbbf24" },
    red: { bg: "rgba(239,68,68,0.10)", fg: "#f87171" },
    neutral: { bg: "rgba(255,255,255,0.04)", fg: "#cbd5e1" },
  };
  const rc = readyColors[readiness.tone];

  // Platform Summary rows — profile/limits backed; unbacked → "Coming soon".
  const summary: { k: string; v: string; soon?: boolean }[] = [
    { k: "Aspect Ratio", v: profile.video.aspect },
    { k: "Recommended Duration", v: `${profile.video.targetDurationSec[0]}–${profile.video.targetDurationSec[1]} sec` },
    { k: "Caption", v: limits.caption.min > 0 ? `${limits.caption.min}–${limits.caption.max} chars` : `≤ ${limits.caption.max} chars` },
    { k: "Hashtags", v: `${limits.hashtags.min}–${limits.hashtags.max}` },
    { k: "Tone / Approach", v: cap(profile.story.conversionStyle) },
    { k: "Visual Style", v: `${cap(profile.story.sceneComplexity)} · ${cap(profile.story.pacing)}` },
    { k: "Recommended CTA", v: "Coming soon", soon: true },
  ];

  const md = MODE_DETAIL[mode];
  const swatch = (c?: string | null) =>
    c ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/15 align-middle" style={{ background: c }} title={c} /> : <span className="text-white/30">—</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={approving ? undefined : onClose}>
      <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto" style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Generate Video</h2>
          </div>
          <button type="button" onClick={onClose} disabled={approving} className="text-white/40 hover:text-white disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-3xs text-white/40 mb-4 line-clamp-1">{contentTitle ?? contentItemId}</p>

        {/* Platform */}
        <div className="mb-3">
          <label className={labelCls} title="Where the video will be published. Drives aspect, duration and content limits.">Platform</label>
          <p className="text-3xs text-white/35 mb-1">Choose where this video will be published.</p>
          <select className={selCls} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
            {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>)}
          </select>
        </div>

        {/* Platform Summary */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>{profile.label} · Recommended settings</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5">
            {summary.map((r) => (
              <div key={r.k} className="flex items-center justify-between text-3xs">
                <span className="text-white/45">{r.k}</span>
                <span className={r.soon ? "text-white/35" : "text-white/80"}>{r.soon && <Lock size={8} className="inline mr-0.5" />}{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Aspect / Resolution / Duration */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className={labelCls} title="Frame shape. Defaults from the platform; override if needed.">Aspect Ratio</label>
            <select className={`${selCls} mt-1`} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
              {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}{a.value === profile.video.aspect ? " · default" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} title="Output resolution. 1080p is coming soon.">Resolution</label>
            <select className={`${selCls} mt-1`} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
              <option value="720p">720p · Standard</option>
              <option value="1080p" disabled>1080p · Coming soon</option>
            </select>
          </div>
          <div>
            <label className={labelCls} title="Total length. Auto uses the platform's recommended window.">Duration</label>
            <select className={`${selCls} mt-1`} value={duration} onChange={(e) => setDuration(e.target.value as DurationChoice)}>
              <option value="auto">Auto · {profile.video.targetDurationSec[0]}–{profile.video.targetDurationSec[1]}s</option>
              <option value="15">15s</option><option value="20">20s</option><option value="30">30s</option><option value="45">45s</option><option value="60">60s</option>
            </select>
          </div>
        </div>

        {/* Visual Generation (was Video Source) */}
        <div className="mb-4">
          <span className={labelCls} title="How OttoFlow creates your visuals.">Visual Generation</span>
          <p className="text-3xs text-white/35 mb-1.5">Choose how OttoFlow creates your visuals.</p>
          <div className="grid grid-cols-2 gap-2">
            {SOURCE_OPTIONS.map((o) => {
              const active = source === o.value;
              return (
                <button key={o.value} type="button" disabled={!o.enabled} onClick={() => o.enabled && setSource(o.value)}
                  className="text-left rounded-lg p-2.5 transition disabled:cursor-not-allowed"
                  style={{ background: active ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}`, opacity: o.enabled ? 1 : 0.5 }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-2xs font-semibold text-white/85">{o.label}</span>
                    {o.value === "auto" && <span className="text-3xs text-cyan-300">Recommended</span>}
                    {!o.enabled && <span className="text-3xs text-white/40 flex items-center gap-0.5"><Lock size={9} /> Coming soon</span>}
                  </div>
                  <p className="text-3xs text-white/50 leading-snug">{o.desc}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-2 rounded-lg overflow-hidden" style={card}>
            <table className="w-full text-3xs">
              <thead><tr className="text-white/40"><th className="text-left font-semibold px-2.5 py-1.5">Source</th><th className="font-semibold px-2 py-1.5">Est. Cost</th><th className="font-semibold px-2 py-1.5">Est. Speed</th><th className="font-semibold px-2 py-1.5">Visual Quality</th></tr></thead>
              <tbody>{SOURCE_TABLE.map((r) => <tr key={r.src} className="text-white/70 border-t border-white/5"><td className="text-left px-2.5 py-1.5">{r.src}</td><td className="text-center px-2 py-1.5">{r.cost}</td><td className="text-center px-2 py-1.5">{r.speed}</td><td className="text-center px-2 py-1.5">{r.quality}</td></tr>)}</tbody>
            </table>
          </div>
        </div>

        {/* Rendering Mode + Quality */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelCls} title="The narrative engine used to build the video.">Rendering Mode</label>
            <select className={`${selCls} mt-1`} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div className="mt-1.5 rounded-lg p-2" style={card}>
              <p className="text-3xs text-white/45">Engine <span className="text-white/75">{md.engine}</span></p>
              <p className="text-3xs text-white/45">Best for <span className="text-white/75">{md.bestFor}</span></p>
            </div>
          </div>
          <div>
            <label className={labelCls} title="Generation quality tier. Best is the current production tier.">Quality</label>
            <select className={`${selCls} mt-1`} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="best">Best (Recommended)</option>
              <option value="balanced" disabled>Balanced · Coming soon</option>
              <option value="fast" disabled>Fast · Coming soon</option>
            </select>
          </div>
        </div>

        {/* Branding */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>Branding</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-3xs">
            <div className="flex items-center justify-between"><span className="text-white/45">Brand Name</span><span className="text-white/80">{branding?.brandName ?? "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Logo</span><span className="text-white/80">{branding?.logoAssetId ? "Uploaded" : "Wordmark"}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Primary Color</span><span>{swatch(branding?.palette?.primary)}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Secondary Color</span><span>{swatch(branding?.palette?.secondary)}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Voice</span><span className="text-white/35"><Lock size={8} className="inline mr-0.5" />Coming soon</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Industry</span><span className="text-white/35"><Lock size={8} className="inline mr-0.5" />Coming soon</span></div>
          </div>
          <p className="text-3xs text-white/30 mt-1">Read-only — edit in Brand settings.</p>
        </div>

        {/* Content Validation */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>Content Validation · {profile.label}</span>
          <div className="space-y-0.5 mt-1.5">
            {validation.checks.map((c) => (
              <div key={c.field} className="flex items-center justify-between text-3xs">
                <span className="capitalize text-white/55">{c.field}</span>
                <span className={c.ok ? "text-white/60" : "text-red-400"}>{c.ok ? "✓" : "✗"} {c.actual} · needs {c.rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Estimated Cost — TOTAL emphasized */}
        <div className="mb-4 rounded-xl p-4" style={card}>
          <div className="flex items-center justify-between mb-2">
            <span className={labelCls}>Estimated Cost</span>
            <span className="text-2xs text-white/45">{estimate?.sceneCount ?? "—"} scenes · {aspect} · {resolution}</span>
          </div>
          <div className="space-y-1">
            {[["Story", bd?.storyUsd], ["Scene Generation", bd?.sceneGenerationUsd], ["Composition", bd?.compositionUsd], ["Storage", bd?.renderingUsd]].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between text-2xs"><span className="text-white/50">{k as string}</span><span className="text-white/70">{v == null ? "—" : `$${(v as number).toFixed(2)}`}</span></div>
            ))}
            <div className="border-t border-white/10 my-1.5" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/80">TOTAL</span>
              <span className="text-2xl font-bold text-cyan-200">{estimating ? <Loader2 className="h-5 w-5 animate-spin inline" /> : money(estimate?.estimatedCostUsd)}</span>
            </div>
          </div>
        </div>

        {/* Estimated Time + factors */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <div className="flex items-center justify-between">
            <span className={labelCls}>Estimated Time</span>
            <span className="text-sm font-semibold text-white/85">{fmtTimeRange(estimate?.estRenderTimeSec)}</span>
          </div>
          <p className="text-3xs text-white/35 mt-1">Factors: scene count · platform · rendering mode · visual generation.</p>
        </div>

        {/* Production Readiness */}
        <div className="mb-4 rounded-xl p-3 flex items-start gap-2.5" style={{ background: rc.bg, border: `1px solid ${rc.fg}33` }}>
          <readiness.icon className={`h-4 w-4 mt-0.5 ${readiness.tone === "neutral" ? "animate-spin" : ""}`} style={{ color: rc.fg }} />
          <div>
            <p className="text-2xs font-bold" style={{ color: rc.fg }}>{readiness.title}</p>
            <p className="text-3xs text-white/60 mt-0.5">{readiness.detail}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
          <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5" onClick={onGenerate}
            disabled={approving || estimating || !estimate || !validation.ok}
            title={!validation.ok ? `Content does not meet ${profile.label} limits — regenerate first` : undefined}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Queuing…" : `Generate${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
