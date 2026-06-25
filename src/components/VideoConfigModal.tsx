"use client";

/**
 * VideoConfigModal — platform-aware Generate Video configurator (enterprise UX v1.0).
 *
 * Flow: Progress → Platform → Platform Intelligence → Platform Preview → Aspect/
 * Resolution/Duration → Visual Generation → Rendering Mode → Quality → Branding →
 * Content Validation → [checkout cluster: Production Readiness → Configuration
 * Summary → Estimated Cost → Estimated Time → Generate]. Every control re-runs the
 * FREE dryRun (no spend) so cost/validation update live.
 *
 * Honesty rules: every visible option is fully wired OR clearly "Coming soon".
 * Presentation only — NO pipeline/pricing/worker/API/schema changes. PLATFORM_
 * PROFILES is the source of truth; unbacked fields render "Coming soon", never
 * invented values.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clapperboard, X, Lock, CheckCircle2, AlertTriangle, AlertCircle, Check } from "lucide-react";
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
const MODE_DETAIL: Record<string, { engine: string; bestFor: string }> = {
  commercial_story: { engine: "Human-first Story Engine", bestFor: "Brand storytelling" },
  product_demo: { engine: "Human-first Story Engine", bestFor: "Product videos" },
  explainer: { engine: "Human-first Story Engine", bestFor: "Explainers" },
  ai_storytelling: { engine: "AI Storytelling Engine", bestFor: "Abstract brand awareness" },
  founder_video: { engine: "Human-first Story Engine", bestFor: "Founder & thought leadership" },
  social_ad: { engine: "Human-first Story Engine", bestFor: "Short social ads" },
};

const SOURCE_OPTIONS: { value: string; label: string; desc: string; enabled: boolean }[] = [
  { value: "auto", label: "Auto", desc: "OttoFlow picks the best approach (Hybrid → AI → Stock) by quality, speed & cost.", enabled: true },
  { value: "ai", label: "AI Generated", desc: "Creates original AI-generated scenes. Best for commercials, product videos, brand storytelling.", enabled: true },
  { value: "stock", label: "Premium Stock Footage", desc: "Licensed cinematic stock + AI editing. Best for corporate, real estate, travel, lifestyle.", enabled: false },
  { value: "hybrid", label: "Hybrid", desc: "AI hero scenes + premium stock. Highest production quality.", enabled: false },
];
const SOURCE_TABLE = [
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
/** Real surface descriptor per platform (informational). */
const PLATFORM_SURFACE: Record<Platform, string> = {
  linkedin: "Desktop & Mobile Feed",
  tiktok: "Vertical Full Screen",
  instagram_reels: "Reels Full Screen",
  instagram_feed: "In-Feed",
  facebook_reels: "Reels Full Screen",
  facebook_feed: "In-Feed",
  youtube_shorts: "Shorts Full Screen",
  youtube_standard: "Player",
  x: "Timeline",
};
function orientation(a: AspectRatio): string {
  return a === "9:16" ? "Vertical" : a === "1:1" ? "Square" : "Landscape";
}
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
  strategy?: StrategySummary; estimate?: RenderCostEstimate; renderJobId?: string; error?: string;
  compositionPlan?: { branding?: Branding | null } | null;
}

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
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
  const selCls = "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

  const durLabel = duration === "auto" ? `${profile.video.targetDurationSec[0]}–${profile.video.targetDurationSec[1]}s · Auto` : `${duration}s`;
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? "Auto";
  const modeLabel = MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
  const md = MODE_DETAIL[mode];

  // Progress steps (derived).
  const steps = [
    { n: 1, label: "Platform", done: true },
    { n: 2, label: "Visuals", done: true },
    { n: 3, label: "Branding", done: !!branding },
    { n: 4, label: "Validation", done: validation.ok },
    { n: 5, label: "Review", done: !!estimate && validation.ok && !error },
  ];

  // Readiness state.
  const readiness = error
    ? { tone: "red" as const, icon: AlertCircle, title: "Missing Required Information", lines: [error] }
    : !validation.ok
      ? { tone: "amber" as const, icon: AlertTriangle, title: "Needs Regeneration", lines: [`Post copy doesn't meet ${profile.label} limits — ${validation.checks.filter((c) => !c.ok).map((c) => `${c.field} ${c.actual} (needs ${c.rule})`).join("; ")}.`, "Regenerate content before rendering."] }
      : estimating || !estimate
        ? { tone: "neutral" as const, icon: Loader2, title: "Preparing estimate…", lines: ["Calculating cost and validating content."] }
        : { tone: "green" as const, icon: CheckCircle2, title: "Ready to Generate", lines: ["Everything required has passed validation.", `Estimated render ${fmtTimeRange(estimate.estRenderTimeSec)}`, `Expected output ${resolution} MP4`] };
  const readyColors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "rgba(16,185,129,0.10)", fg: "#34d399" },
    amber: { bg: "rgba(245,158,11,0.10)", fg: "#fbbf24" },
    red: { bg: "rgba(239,68,68,0.10)", fg: "#f87171" },
    neutral: { bg: "rgba(255,255,255,0.04)", fg: "#cbd5e1" },
  };
  const rc = readyColors[readiness.tone];

  // Platform Intelligence (real PLATFORM_PROFILES data; unbacked → Coming soon).
  const intel: { k: string; v: string; tip: string; soon?: boolean }[] = [
    { k: "Best Posting Orientation", v: `${orientation(profile.video.aspect)} (${profile.video.aspect})`, tip: "Derived from the platform's native aspect ratio." },
    { k: "Recommended Length", v: `${profile.video.targetDurationSec[0]}–${profile.video.targetDurationSec[1]} sec`, tip: "Platform target duration window." },
    { k: "Safe Caption Length", v: limits.caption.min > 0 ? `${limits.caption.min}–${limits.caption.max} chars` : `≤ ${limits.caption.max} chars`, tip: "Validated before generation." },
    { k: "Recommended Hashtags", v: `${limits.hashtags.min}–${limits.hashtags.max}`, tip: "Validated before generation." },
    { k: "Audience Style", v: cap(profile.story.conversionStyle), tip: "Conversion style for this platform." },
    { k: "Visual Pace", v: cap(profile.story.pacing), tip: "How fast scenes move." },
    { k: "Hook Style", v: `${cap(profile.story.hookIntensity)} · by ${profile.story.hookBySec}s`, tip: "Opening-hook intensity and timing." },
    { k: "CTA Style", v: "Coming soon", tip: "Platform-specific CTA styling is on the roadmap.", soon: true },
  ];

  const swatch = (c?: string | null) =>
    c ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/15 align-middle" style={{ background: c }} title={c} /> : <span className="text-white/30 text-3xs">—</span>;

  const summaryRows: [string, string][] = [
    ["Publishing To", profile.label],
    ["Visual Style", `${modeLabel} · ${md.engine}`],
    ["Video Format", aspect],
    ["Resolution", resolution],
    ["Duration", durLabel],
    ["Visual Generation", sourceLabel],
    ["Rendering Quality", "Best"],
    ["Brand", branding?.brandName ?? "—"],
    ["Estimated Cost", money(estimate?.estimatedCostUsd)],
    ["Estimated Time", fmtTimeRange(estimate?.estRenderTimeSec)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={approving ? undefined : onClose}>
      <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto" style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Generate Video</h2>
          </div>
          <button type="button" onClick={onClose} disabled={approving} className="text-white/40 hover:text-white disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        {/* 1. Progress indicator */}
        <div className="flex items-center justify-between mb-4">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center justify-center h-5 w-5 rounded-full text-3xs font-bold"
                  style={{ background: s.done ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.06)", color: s.done ? "#34d399" : "rgba(255,255,255,0.45)", border: `1px solid ${s.done ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.1)"}` }}>
                  {s.done ? <Check size={11} /> : s.n}
                </span>
                <span className={`text-3xs ${s.done ? "text-white/75" : "text-white/40"}`}>{s.label}</span>
              </div>
              {i < steps.length - 1 && <div className="flex-1 h-px mx-2" style={{ background: s.done ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.08)" }} />}
            </div>
          ))}
        </div>

        <p className="text-3xs text-white/40 mb-3 line-clamp-1">{contentTitle ?? contentItemId}</p>

        {/* Platform */}
        <div className="mb-3">
          <label className={labelCls} title="Where the video will be published. Drives aspect, duration and content limits.">Platform</label>
          <p className="text-3xs text-white/35 mb-1">Choose where this video will be published.</p>
          <select className={selCls} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
            {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>)}
          </select>
        </div>

        {/* 6. Platform Intelligence */}
        <div className="mb-3 rounded-lg p-3" style={card}>
          <span className={labelCls}>{profile.label} · Platform Intelligence</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5">
            {intel.map((r) => (
              <div key={r.k} className="flex items-center justify-between text-3xs" title={r.tip}>
                <span className="text-white/45">{r.k}</span>
                <span className={r.soon ? "text-white/35" : "text-white/80"}>{r.soon && <Lock size={8} className="inline mr-0.5" />}{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Platform Preview */}
        <div className="mb-4 rounded-lg p-3 flex items-center gap-3" style={card}>
          <div className="flex items-center justify-center rounded border border-white/15 bg-white/[0.04]"
            style={{ width: aspect === "16:9" ? 56 : aspect === "1:1" ? 38 : 26, height: aspect === "9:16" ? 56 : aspect === "1:1" ? 38 : 32 }}>
            <span className="text-3xs text-white/40">{aspect}</span>
          </div>
          <div>
            <p className="text-2xs font-semibold text-white/80">{profile.label} Preview</p>
            <p className="text-3xs text-white/50">{PLATFORM_SURFACE[platform]} · {aspect} {orientation(aspect)} · <span className="text-emerald-400/80">Recommended</span></p>
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

        {/* Visual Generation */}
        <div className="mb-4">
          <span className={labelCls} title="How OttoFlow creates your scenes.">Visual Generation</span>
          <p className="text-3xs text-white/35 mb-1.5">Choose how OttoFlow creates your visuals.</p>
          <div className="grid grid-cols-2 gap-2">
            {SOURCE_OPTIONS.map((o) => {
              const active = source === o.value;
              return (
                <button key={o.value} type="button" disabled={!o.enabled} onClick={() => o.enabled && setSource(o.value)} title={o.desc}
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
            <label className={labelCls} title="Controls story structure.">Rendering Mode</label>
            <select className={`${selCls} mt-1`} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div className="mt-1.5 rounded-lg p-2" style={card}>
              <p className="text-3xs text-white/45">Engine <span className="text-white/75">{md.engine}</span></p>
              <p className="text-3xs text-white/45">Best for <span className="text-white/75">{md.bestFor}</span></p>
            </div>
          </div>
          <div>
            <label className={labelCls} title="Higher quality may increase render time.">Quality</label>
            <select className={`${selCls} mt-1`} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="best">Best (Recommended)</option>
              <option value="balanced" disabled>Balanced · Coming soon</option>
              <option value="fast" disabled>Fast · Coming soon</option>
            </select>
          </div>
        </div>

        {/* 7. Branding */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>Branding</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-3xs">
            <div className="flex items-center justify-between"><span className="text-white/45">Brand Name</span><span className="text-white/80">{branding?.brandName ?? "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Logo</span><span className="text-white/80">{branding?.logoAssetId ? "Uploaded" : "Wordmark"}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Primary Color</span><span>{swatch(branding?.palette?.primary)}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Secondary Color</span><span>{swatch(branding?.palette?.secondary)}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Brand Voice</span><span className="text-white/35"><Lock size={8} className="inline mr-0.5" />Coming soon</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Industry</span><span className="text-white/35"><Lock size={8} className="inline mr-0.5" />Coming soon</span></div>
            <div className="flex items-center justify-between"><span className="text-white/45">Company Website</span><span className="text-white/35"><Lock size={8} className="inline mr-0.5" />Coming soon</span></div>
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

        {/* ───── Checkout cluster ───── */}
        {/* 4. Production Readiness */}
        <div className="mb-3 rounded-xl p-3 flex items-start gap-2.5" style={{ background: rc.bg, border: `1px solid ${rc.fg}33` }}>
          <readiness.icon className={`h-4 w-4 mt-0.5 ${readiness.tone === "neutral" ? "animate-spin" : ""}`} style={{ color: rc.fg }} />
          <div>
            <p className="text-2xs font-bold" style={{ color: rc.fg }}>{readiness.title}</p>
            {readiness.lines.map((l, i) => <p key={i} className="text-3xs text-white/60 mt-0.5">{l}</p>)}
          </div>
        </div>

        {/* 2. Configuration Summary */}
        <div className="mb-3 rounded-xl p-4" style={card}>
          <span className={labelCls}>Configuration Summary</span>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1 mt-2">
            {summaryRows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-2xs">
                <span className="text-white/45">{k}</span>
                <span className={k === "Estimated Cost" ? "text-cyan-200 font-semibold" : "text-white/80"}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 8. Estimated Cost + confidence */}
        <div className="mb-3 rounded-xl p-4" style={card}>
          <div className="flex items-center justify-between" title="Based on the current rendering pipeline.">
            <span className={labelCls}>Estimated Cost</span>
            <span className="text-2xl font-bold text-cyan-200">{estimating ? <Loader2 className="h-5 w-5 animate-spin inline" /> : money(estimate?.estimatedCostUsd)}</span>
          </div>
          <p className="text-3xs text-white/40 mt-1.5">This estimate is calculated before rendering. No credits are consumed until you approve.</p>
        </div>

        {/* 9. Estimated Time + confidence */}
        <div className="mb-4 rounded-xl p-4" style={card}>
          <div className="flex items-center justify-between" title="Actual time depends on queue and provider.">
            <span className={labelCls}>Estimated Time</span>
            <span className="text-sm font-semibold text-white/85">{fmtTimeRange(estimate?.estRenderTimeSec)}</span>
          </div>
          <p className="text-3xs text-white/35 mt-1.5">Factors: queue load · scene count · rendering mode · visual generation · AI provider response time.</p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
          <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5" onClick={onGenerate}
            disabled={approving || estimating || !estimate || !validation.ok}
            title={!validation.ok ? `Content does not meet ${profile.label} limits — regenerate first` : undefined}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Queuing…" : `Generate Video${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
