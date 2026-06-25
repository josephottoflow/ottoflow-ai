"use client";

/**
 * VideoConfigModal — platform-aware Generate Video configurator.
 *
 * Enterprise layout: Content → Platform → Aspect → Resolution → Duration →
 * Video Source → Rendering Mode → Quality → Branding → Content Validation →
 * Estimated Cost (breakdown) → Estimated Time → Generate. Every control re-runs
 * the FREE dryRun (no spend) so cost + storyboard update live before approval.
 *
 * Honesty rules: every visible option is either fully wired OR clearly disabled
 * ("Coming soon"). Nothing fake. PLATFORM_PROFILES is the single source of truth
 * for defaults; the 6 rendering-mode presets map to the 2 real engines server-
 * side (no fork). Content validation is PRE-render and never trims — invalid copy
 * disables Generate so the operator can regenerate.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clapperboard, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_PROFILES, type Platform, type AspectRatio } from "@/lib/platform/profiles";
import { validatePlatformContent } from "@/lib/platform/content-validation";
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

/** Honest per-mode engine note (mirrors route UI_MODE_TO_ENGINE). */
const MODE_ENGINE_NOTE: Record<string, string> = {
  commercial_story: "Engine: Human-first Story Engine · 6 beats",
  product_demo: "Engine: Human-first Story Engine · 6 beats (shared today)",
  explainer: "Engine: Human-first Story Engine · 6 beats (shared today)",
  founder_video: "Engine: Human-first Story Engine · 6 beats (shared today)",
  social_ad: "Engine: Human-first Story Engine · 6 beats (shared today)",
  ai_storytelling: "Engine: AI Storytelling Engine · abstract 4-beat (certified)",
};

/** Video Source — only Auto reflects the live pipeline (AI-first with stock
 * fallback). The explicit forcing modes need pipeline wiring → "Coming soon". */
const SOURCE_OPTIONS: { value: string; label: string; desc: string; enabled: boolean }[] = [
  { value: "auto", label: "Auto", desc: "OttoFlow picks the best source by quality, cost & speed.", enabled: true },
  { value: "ai", label: "AI Generated", desc: "AI video models (Seedance, Imagen). Best for commercials & brand stories.", enabled: false },
  { value: "stock", label: "Premium Stock", desc: "Licensed stock + AI editing. Fastest, lowest cost.", enabled: false },
  { value: "hybrid", label: "Hybrid", desc: "AI hero scenes + premium stock. Highest quality.", enabled: false },
];

const SOURCE_TABLE: { src: string; cost: string; speed: string; quality: string }[] = [
  { src: "Auto", cost: "⭐⭐⭐", speed: "⭐⭐⭐", quality: "⭐⭐⭐" },
  { src: "AI", cost: "$$$$", speed: "Slow", quality: "★★★★★" },
  { src: "Premium Stock", cost: "$", speed: "Fast", quality: "★★★★☆" },
  { src: "Hybrid", cost: "$$", speed: "Medium", quality: "★★★★★" },
];

const PLATFORM_ORDER: Platform[] = [
  "linkedin",
  "tiktok",
  "instagram_reels",
  "instagram_feed",
  "facebook_reels",
  "facebook_feed",
  "youtube_shorts",
  "youtube_standard",
  "x",
];

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "1:1", label: "1:1 · Square" },
  { value: "16:9", label: "16:9 · Landscape" },
];

interface VideoConfigModalProps {
  open: boolean;
  brandId: string;
  contentItemId: string;
  contentTitle?: string;
  /** Post body + hashtags for pre-render platform validation (never trimmed). */
  contentBody?: string | null;
  contentHashtags?: string[] | null;
  onClose: () => void;
}

interface Palette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}
interface GenResponse {
  strategy?: StrategySummary;
  estimate?: RenderCostEstimate;
  renderJobId?: string;
  error?: string;
  compositionPlan?: { branding?: { palette?: Palette | null; brandName?: string | null } | null } | null;
}

function money(n: number | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}
function fmtTimeRange(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const lo = Math.max(1, Math.round((sec * 0.8) / 60));
  const hi = Math.max(lo + 1, Math.round((sec * 1.2) / 60));
  return `${lo}–${hi} min`;
}

export function VideoConfigModal({
  open,
  brandId,
  contentItemId,
  contentTitle,
  contentBody,
  contentHashtags,
  onClose,
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
  const [palette, setPalette] = useState<Palette | null>(null);
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
      brandId,
      contentItemId,
      platform,
      aspect,
      resolution,
      quality,
      mode,
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
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body({ dryRun: true })),
        });
        const json = (await res.json().catch(() => ({}))) as GenResponse;
        if (id !== reqId.current) return;
        if (!res.ok || !json.estimate) throw new Error(json.error ?? `Estimate failed (${res.status})`);
        setEstimate(json.estimate);
        strategyRef.current = json.strategy ?? null;
        setPalette(json.compositionPlan?.branding?.palette ?? null);
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

  // Pre-render content validation (never trims; gates Generate).
  const validation = validatePlatformContent(platform, {
    caption: contentBody ?? null,
    hashtags: contentHashtags ?? null,
    title: contentTitle ?? null,
    description: contentBody ?? null,
  });

  async function onGenerate() {
    if (approving || !validation.ok) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  const bd = estimate?.breakdown;
  const labelCls = "text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1 block";
  const selCls =
    "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 " +
    "focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={approving ? undefined : onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto"
        style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Generate Video</h2>
          </div>
          <button type="button" onClick={onClose} disabled={approving} className="text-white/40 hover:text-white disabled:opacity-40" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="mb-4">
          <span className={labelCls}>Content</span>
          <p className="text-xs text-white/80 line-clamp-1">{contentTitle ?? contentItemId}</p>
        </div>

        {/* Platform / Aspect / Resolution / Duration */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelCls} title="Where the video will be published. Drives aspect, duration and content limits.">Platform</label>
            <select className={selCls} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
              {PLATFORM_ORDER.map((p) => (
                <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} title="Frame shape. Defaults from the platform; override if needed.">Aspect Ratio</label>
            <select className={selCls} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
              {ASPECTS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}{a.value === profile.video.aspect ? " · default" : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} title="Output resolution. 1080p is coming soon.">Resolution</label>
            <select className={selCls} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
              <option value="720p">720p · Standard</option>
              <option value="1080p" disabled>1080p · Coming soon</option>
            </select>
          </div>
          <div>
            <label className={labelCls} title="Total length. Auto uses the platform's recommended window.">Duration</label>
            <select className={selCls} value={duration} onChange={(e) => setDuration(e.target.value as DurationChoice)}>
              <option value="auto">Auto · {profile.video.targetDurationSec[0]}–{profile.video.targetDurationSec[1]}s (recommended)</option>
              <option value="15">15s</option>
              <option value="20">20s</option>
              <option value="30">30s</option>
              <option value="45">45s</option>
              <option value="60">60s</option>
            </select>
          </div>
        </div>

        {/* Video Source */}
        <div className="mb-4">
          <span className={labelCls} title="How OttoFlow creates your video.">Video Source</span>
          <div className="grid grid-cols-2 gap-2">
            {SOURCE_OPTIONS.map((o) => {
              const active = source === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={!o.enabled}
                  onClick={() => o.enabled && setSource(o.value)}
                  className="text-left rounded-lg p-2.5 transition disabled:cursor-not-allowed"
                  style={{
                    background: active ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}`,
                    opacity: o.enabled ? 1 : 0.5,
                  }}
                >
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
          {/* Comparison table */}
          <div className="mt-2 rounded-lg overflow-hidden" style={card}>
            <table className="w-full text-3xs">
              <thead>
                <tr className="text-white/40">
                  <th className="text-left font-semibold px-2.5 py-1.5">Source</th>
                  <th className="font-semibold px-2 py-1.5">Cost</th>
                  <th className="font-semibold px-2 py-1.5">Speed</th>
                  <th className="font-semibold px-2 py-1.5">Visual Quality</th>
                </tr>
              </thead>
              <tbody>
                {SOURCE_TABLE.map((r) => (
                  <tr key={r.src} className="text-white/70 border-t border-white/5">
                    <td className="text-left px-2.5 py-1.5">{r.src}</td>
                    <td className="text-center px-2 py-1.5">{r.cost}</td>
                    <td className="text-center px-2 py-1.5">{r.speed}</td>
                    <td className="text-center px-2 py-1.5">{r.quality}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rendering Mode / Quality */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelCls} title="The narrative engine used to build the video.">Rendering Mode</label>
            <select className={selCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="text-3xs text-white/40 mt-1">{MODE_ENGINE_NOTE[mode]}</p>
          </div>
          <div>
            <label className={labelCls} title="Generation quality tier. Best is the current production tier.">Quality</label>
            <select className={selCls} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="best">Best (Recommended)</option>
              <option value="balanced" disabled>Balanced · Coming soon</option>
              <option value="fast" disabled>Fast · Coming soon</option>
            </select>
          </div>
        </div>

        {/* Branding (read-only) */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>Branding</span>
          <div className="flex items-center gap-4 text-2xs text-white/70">
            <div className="flex items-center gap-1.5">
              {palette ? (
                [palette.primary, palette.secondary, palette.accent].filter(Boolean).map((c, i) => (
                  <span key={i} className="inline-block h-4 w-4 rounded-full border border-white/15" style={{ background: c as string }} title={c as string} />
                ))
              ) : (
                <span className="text-white/40">Brand colors from creative brief</span>
              )}
            </div>
            <span className="text-white/40">·</span>
            <span>Logo & wordmark applied</span>
            <span className="text-white/40">·</span>
            <span>Brand voice applied</span>
          </div>
          <p className="text-3xs text-white/35 mt-1">Read-only — edit in Brand settings.</p>
        </div>

        {/* Content validation (pre-render; never trims) */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`${labelCls} mb-0`}>Content Validation · {profile.label}</span>
            <span className={`text-2xs font-semibold ${validation.ok ? "text-emerald-400" : "text-red-400"}`}>
              {validation.ok ? "Ready to publish" : "Needs regeneration"}
            </span>
          </div>
          <div className="space-y-0.5">
            {validation.checks.map((c) => (
              <div key={c.field} className="flex items-center justify-between text-3xs">
                <span className="capitalize text-white/55">{c.field}</span>
                <span className={c.ok ? "text-white/60" : "text-red-400"}>
                  {c.ok ? "✓" : "✗"} {c.actual} · needs {c.rule}
                </span>
              </div>
            ))}
          </div>
          {!validation.ok && (
            <p className="text-3xs text-red-400/80 mt-1.5">Regenerate this post for {profile.label} to meet its limits — content is never silently trimmed.</p>
          )}
        </div>

        {/* Estimated cost + breakdown + time */}
        <div className="mb-4 rounded-xl p-4" style={card}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className={labelCls}>Estimated AI Cost</p>
              <p className="text-2xl font-bold text-white">{estimating ? <Loader2 className="h-5 w-5 animate-spin inline" /> : money(estimate?.estimatedCostUsd)}</p>
            </div>
            <div className="text-right text-2xs text-white/55 space-y-0.5">
              <p><span className="text-white/40">Scenes</span> {estimate?.sceneCount ?? "—"}</p>
              <p><span className="text-white/40">Output</span> {aspect} · {resolution}</p>
              <p><span className="text-white/40">Est. time</span> {fmtTimeRange(estimate?.estRenderTimeSec)}</p>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-center mt-2">
            {[
              ["Story", bd?.storyUsd],
              ["Scene Gen", bd?.sceneGenerationUsd],
              ["Composition", bd?.compositionUsd],
              ["Storage", bd?.renderingUsd],
              ["Total", estimate?.estimatedCostUsd],
            ].map(([k, v]) => (
              <div key={k as string} className={`rounded-lg py-1.5 ${k === "Total" ? "bg-cyan-400/10" : ""}`} style={k === "Total" ? undefined : { background: "rgba(255,255,255,0.03)" }}>
                <p className="text-3xs text-white/40">{k as string}</p>
                <p className={`text-2xs ${k === "Total" ? "text-cyan-200 font-semibold" : "text-white/80"}`}>{v == null ? "—" : `$${(v as number).toFixed(2)}`}</p>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-2xs text-red-400 mb-3">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
          <Button
            type="button"
            variant="gradient-cyan"
            size="sm"
            className="gap-1.5"
            onClick={onGenerate}
            disabled={approving || estimating || !estimate || !validation.ok}
            title={!validation.ok ? `Content does not meet ${profile.label} limits — regenerate first` : undefined}
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Queuing…" : `Generate${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
