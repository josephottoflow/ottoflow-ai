"use client";

/**
 * VideoConfigModal — Sprint 4 platform-aware Generate Video configurator.
 *
 * Enterprise layout: Content → Platform → Aspect → Resolution → Duration →
 * Rendering Mode → Quality → Brand → Estimated Cost (breakdown) → Estimated
 * Time → Generate. Every control re-runs the FREE dryRun (no spend, nothing
 * enqueued) so cost + storyboard update dynamically before approval.
 *
 * PLATFORM_PROFILES is the single source of truth: selecting a platform sets the
 * default aspect + duration (both still overridable). Nothing here forks the
 * render pipeline — the 6 rendering-mode presets map to the 2 real engines
 * server-side (UI_MODE_TO_ENGINE). Approve re-POSTs with the previewed strategy
 * so the render matches the estimate exactly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clapperboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_PROFILES, type Platform, type AspectRatio } from "@/lib/platform/profiles";
import type { RenderCostEstimate } from "@/lib/video/cost";
import type { StrategySummary } from "@/components/CostApprovalModal";

type Resolution = "720p" | "1080p";
type Quality = "fast" | "balanced" | "best";
type DurationChoice = "auto" | "15" | "20" | "30" | "45" | "60";

/** UI rendering-mode presets → server `mode` value (resolved to an engine there). */
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "commercial_story", label: "Commercial Story" },
  { value: "product_demo", label: "Product Demo" },
  { value: "explainer", label: "Explainer" },
  { value: "ai_storytelling", label: "AI Storytelling" },
  { value: "founder_video", label: "Founder Video" },
  { value: "social_ad", label: "Social Ad" },
];

const PLATFORM_ORDER: Platform[] = [
  "tiktok",
  "instagram_reels",
  "instagram_feed",
  "facebook_reels",
  "facebook_feed",
  "linkedin",
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
  onClose: () => void;
}

interface GenResponse {
  strategy?: StrategySummary;
  estimate?: RenderCostEstimate;
  renderJobId?: string;
  error?: string;
}

function money(n: number | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}
function fmtTime(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `~${m}m ${s}s` : `~${s}s`;
}

export function VideoConfigModal({
  open,
  brandId,
  contentItemId,
  contentTitle,
  onClose,
}: VideoConfigModalProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [aspect, setAspect] = useState<AspectRatio>(PLATFORM_PROFILES.linkedin.video.aspect);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [duration, setDuration] = useState<DurationChoice>("auto");
  const [mode, setMode] = useState<string>("commercial_story");
  const [quality, setQuality] = useState<Quality>("balanced");

  const [estimate, setEstimate] = useState<RenderCostEstimate | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqId = useRef(0);

  // Selecting a platform resets aspect + duration to that platform's defaults
  // (still overridable afterwards) — PLATFORM_PROFILES is the source of truth.
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

  // Dynamic estimate: re-dryRun on any config change (debounced; race-guarded).
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
        if (id !== reqId.current) return; // a newer request superseded this one
        if (!res.ok || !json.estimate) throw new Error(json.error ?? `Estimate failed (${res.status})`);
        setEstimate(json.estimate);
        setStrategy(json.strategy ?? null);
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

  async function onGenerate() {
    if (approving) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ approve: true, strategy: strategy ?? undefined })),
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
          <button
            type="button"
            onClick={onClose}
            disabled={approving}
            className="text-white/40 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="mb-4">
          <span className={labelCls}>Content</span>
          <p className="text-xs text-white/80 line-clamp-1">{contentTitle ?? contentItemId}</p>
        </div>

        {/* Config grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className={labelCls}>Platform</label>
            <select className={selCls} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
              {PLATFORM_ORDER.map((p) => (
                <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Aspect Ratio</label>
            <select className={selCls} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
              {ASPECTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}{a.value === profile.video.aspect ? " · default" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Resolution</label>
            <select className={selCls} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
              <option value="720p">720p · Standard</option>
              <option value="1080p">1080p · High (≈1.5× cost)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Duration</label>
            <select className={selCls} value={duration} onChange={(e) => setDuration(e.target.value as DurationChoice)}>
              <option value="auto">
                Auto · {profile.video.targetDurationSec[0]}–{profile.video.targetDurationSec[1]}s
              </option>
              <option value="15">15s</option>
              <option value="20">20s</option>
              <option value="30">30s</option>
              <option value="45">45s</option>
              <option value="60">60s</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Rendering Mode</label>
            <select className={selCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Quality</label>
            <select className={selCls} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="best">Best Quality (1080p)</option>
            </select>
          </div>
        </div>

        {/* Brand summary (from the creative brief / Visual World) */}
        <div className="mb-4 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className={labelCls}>Brand</span>
          <p className="text-2xs text-white/60">
            Brand colors, logo and CTA are applied from this content&rsquo;s creative brief.
            Edit them in Brand settings.
          </p>
        </div>

        {/* Estimated cost + breakdown */}
        <div className="mb-4 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className={labelCls}>Estimated AI Cost</p>
              <p className="text-2xl font-bold text-white">
                {estimating ? <Loader2 className="h-5 w-5 animate-spin inline" /> : money(estimate?.estimatedCostUsd)}
              </p>
            </div>
            <div className="text-right text-2xs text-white/55 space-y-0.5">
              <p><span className="text-white/40">Scenes</span> {estimate?.sceneCount ?? "—"}</p>
              <p><span className="text-white/40">Output</span> {aspect} · {resolution}</p>
              <p><span className="text-white/40">Est. time</span> {fmtTime(estimate?.estRenderTimeSec)}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center mt-2">
            {[
              ["Story", bd?.storyUsd],
              ["Scene Gen", bd?.sceneGenerationUsd],
              ["Compose", bd?.compositionUsd],
              ["Render", bd?.renderingUsd],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg py-1.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                <p className="text-3xs text-white/40">{k as string}</p>
                <p className="text-2xs text-white/80">{v == null ? "—" : `$${(v as number).toFixed(2)}`}</p>
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
            disabled={approving || estimating || !estimate}
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Queuing…" : `Generate${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
