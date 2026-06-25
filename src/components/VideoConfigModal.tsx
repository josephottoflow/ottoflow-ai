"use client";

/**
 * VideoConfigModal — OttoFlow AI Creative Studio (presentation layer).
 *
 * Transforms the Generate Video flow from a config form into a directed creative
 * experience: live platform preview, AI Director Notes, story timeline, storyboard
 * preview, confidence scores, and a premium checkout cluster. PRESENTATION ONLY —
 * no pipeline / API / pricing / rendering changes. Every section is fed by data the
 * FREE dryRun already returns; anything without a real signal is hidden or marked
 * "Coming soon". PLATFORM_PROFILES is the source of truth.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Clapperboard, X, Lock, CheckCircle2, AlertTriangle, AlertCircle, Check,
  ChevronDown, Film, Sparkles, Clock, BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_PROFILES, type Platform, type AspectRatio } from "@/lib/platform/profiles";
import { validatePlatformContent } from "@/lib/platform/content-validation";
import type { RenderCostEstimate } from "@/lib/video/cost";
import type { StrategySummary } from "@/components/CostApprovalModal";

type Resolution = "720p" | "1080p";
type Quality = "fast" | "balanced" | "best";
type DurationChoice = "auto" | "15" | "20" | "30" | "45" | "60";

/** Customer-facing video styles (map to the 2 real engines server-side). */
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "commercial_story", label: "Commercial Story" },
  { value: "product_demo", label: "Product Demo" },
  { value: "explainer", label: "Explainer" },
  { value: "ai_storytelling", label: "AI Storytelling" },
  { value: "founder_video", label: "Founder Video" },
  { value: "social_ad", label: "Social Ad" },
];
const MODE_DETAIL: Record<string, { engine: string; bestFor: string }> = {
  commercial_story: { engine: "Human-first Story", bestFor: "Brand storytelling" },
  product_demo: { engine: "Human-first Story", bestFor: "Product videos" },
  explainer: { engine: "Human-first Story", bestFor: "Explainers" },
  ai_storytelling: { engine: "AI Storytelling", bestFor: "Brand awareness" },
  founder_video: { engine: "Human-first Story", bestFor: "Founder & thought leadership" },
  social_ad: { engine: "Human-first Story", bestFor: "Short social ads" },
};

/** Visual Generation — Auto + AI reflect the live engine; Stock & Hybrid pending. */
const SOURCE_OPTIONS: { value: string; label: string; desc: string; enabled: boolean }[] = [
  { value: "auto", label: "Auto", desc: "OttoFlow picks the best approach by quality, speed & cost.", enabled: true },
  { value: "ai", label: "AI Generated", desc: "Original AI-generated cinematic scenes. Best for commercials & brand stories.", enabled: true },
  { value: "stock", label: "Premium Stock", desc: "Licensed cinematic footage with AI editing. Fastest, lowest cost.", enabled: false },
  { value: "hybrid", label: "Hybrid", desc: "AI hero scenes + premium footage. Highest production quality.", enabled: false },
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
const PLATFORM_SURFACE: Record<Platform, string> = {
  linkedin: "Desktop & Mobile Feed", tiktok: "Vertical Full Screen",
  instagram_reels: "Reels Full Screen", instagram_feed: "In-Feed",
  facebook_reels: "Reels Full Screen", facebook_feed: "In-Feed",
  youtube_shorts: "Shorts Full Screen", youtube_standard: "Player", x: "Timeline",
};
function orientation(a: AspectRatio): string {
  return a === "9:16" ? "Vertical" : a === "1:1" ? "Square" : "Landscape";
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const beatLabel = (role?: string) =>
  ({ hook: "Hook", problem: "Problem", visualized_pain: "Tension", reveal: "Reveal",
     outcome: "Outcome", proof: "Proof", solution: "Solution", tension: "Tension",
     cta: "Call to action" } as Record<string, string>)[role ?? ""] ?? cap((role ?? "Scene").replace(/_/g, " "));

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

/** Client-side Commercial Quality (0–100) from the real storyboard plan. Honest
 * heuristic on dryRun data — NOT a fabricated value. */
function commercialQuality(strategy: StrategySummary | null, hasPalette: boolean, fit: boolean): number {
  const sc = strategy?.scenes ?? [];
  if (!sc.length) return 0;
  let s = 0;
  s += Math.min(25, Math.round((sc.length / 6) * 25)); // story completeness
  const capOk = sc.filter((x) => { const w = (x.caption ?? "").trim().split(/\s+/).filter(Boolean).length; return w >= 2 && w <= 12; }).length;
  s += Math.round((capOk / sc.length) * 20); // captions
  const distinct = new Set(sc.map((x) => (x.caption ?? "").trim().toLowerCase()).filter(Boolean)).size;
  s += Math.round((distinct / sc.length) * 15); // variety
  s += sc[0]?.caption ? 10 : 0; // hook present
  s += fit ? 15 : 6; // platform pacing fit
  s += hasPalette ? 15 : 4; // brand applied
  return Math.max(0, Math.min(100, s));
}
function brandMatch(b: Branding | null): number {
  if (!b) return 0;
  let s = 0;
  if (b.palette?.primary) s += 40;
  if (b.palette?.secondary) s += 20;
  s += b.logoAssetId ? 20 : 10; // uploaded logo vs wordmark
  s += 20; // CTA always applied in commercial_story end card
  return Math.min(100, s);
}
function scoreColor(n: number): string {
  return n >= 85 ? "#34d399" : n >= 65 ? "#fbbf24" : "#f87171";
}

interface VideoConfigModalProps {
  open: boolean; brandId: string; contentItemId: string;
  contentTitle?: string; contentBody?: string | null; contentHashtags?: string[] | null;
  onClose: () => void;
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
  const [advanced, setAdvanced] = useState(false);

  const [estimate, setEstimate] = useState<RenderCostEstimate | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strategyRef = useRef<StrategySummary | null>(null);
  const reqId = useRef(0);

  function onPlatform(p: Platform) {
    setPlatform(p); setAspect(PLATFORM_PROFILES[p].video.aspect); setDuration("auto");
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
    setEstimating(true); setError(null);
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
        setStrategy(json.strategy ?? null);
        strategyRef.current = json.strategy ?? null;
        setBranding(json.compositionPlan?.branding ?? null);
      } catch (err) {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err.message : String(err)); setEstimate(null);
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
    setApproving(true); setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ approve: true, strategy: strategyRef.current ?? undefined })),
      });
      const json = (await res.json().catch(() => ({}))) as GenResponse;
      if (!res.ok || !json.renderJobId) throw new Error(json.error ?? `Request failed (${res.status})`);
      router.push(`/video/${json.renderJobId}`); return;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setApproving(false);
    }
  }

  if (!open) return null;

  const profile = PLATFORM_PROFILES[platform];
  const scenes = strategy?.scenes ?? [];
  const totalDur = scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0);
  const [plo, phi] = profile.video.targetDurationSec;
  const fit = totalDur >= plo * 0.8 && totalDur <= phi * 1.2;
  const hasPalette = !!(branding?.palette?.primary);
  const quality100 = commercialQuality(strategy, hasPalette, fit);
  const brand100 = brandMatch(branding);

  const labelCls = "text-3xs uppercase tracking-wider text-white/40 font-semibold";
  const selCls = "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;

  const durLabel = duration === "auto" ? `${plo}–${phi}s · Auto` : `${duration}s`;
  const sourceLabel = SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? "Auto";
  const modeLabel = MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
  const md = MODE_DETAIL[mode];

  const steps = [
    { n: 1, label: "Platform", done: true },
    { n: 2, label: "Direction", done: true },
    { n: 3, label: "Brand", done: !!branding },
    { n: 4, label: "Validation", done: validation.ok },
    { n: 5, label: "Review", done: !!estimate && validation.ok && !error },
  ];

  const readiness = error
    ? { tone: "red" as const, icon: AlertCircle, title: "Missing Required Information", lines: [error] }
    : !validation.ok
      ? { tone: "amber" as const, icon: AlertTriangle, title: "Needs Regeneration", lines: [`Post copy doesn't meet ${profile.label} limits — ${validation.checks.filter((c) => !c.ok).map((c) => `${c.field} ${c.actual} (needs ${c.rule})`).join("; ")}.`, "Regenerate content before rendering."] }
      : estimating || !estimate
        ? { tone: "neutral" as const, icon: Loader2, title: "Designing your video…", lines: ["Composing the story and validating content."] }
        : { tone: "green" as const, icon: CheckCircle2, title: "Ready to Generate", lines: ["Everything required has passed validation.", `Estimated render ${fmtTimeRange(estimate.estRenderTimeSec)}`, `Expected output ${resolution} MP4`] };
  const readyColors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "rgba(16,185,129,0.10)", fg: "#34d399" }, amber: { bg: "rgba(245,158,11,0.10)", fg: "#fbbf24" },
    red: { bg: "rgba(239,68,68,0.10)", fg: "#f87171" }, neutral: { bg: "rgba(255,255,255,0.04)", fg: "#cbd5e1" },
  };
  const rc = readyColors[readiness.tone];

  // AI Director Notes — the AI's own concept + why this platform (real data).
  const directorNotes: string[] = [];
  if (strategy?.video_concept) directorNotes.push(strategy.video_concept);
  directorNotes.push(`Optimised for ${profile.label}: ${cap(profile.story.conversionStyle)} tone, ${profile.story.pacing} pacing, hook by ${profile.story.hookBySec}s.`);

  const swatch = (c?: string | null) =>
    c ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/15 align-middle" style={{ background: c }} title={c} /> : <span className="text-white/30 text-3xs">—</span>;

  const ScoreChip = ({ label, value, soon }: { label: string; value?: number; soon?: boolean }) => (
    <div className="rounded-lg px-2.5 py-1.5 text-center" style={card}>
      <p className="text-3xs text-white/40">{label}</p>
      {soon ? <p className="text-3xs text-white/35"><Lock size={8} className="inline mr-0.5" />Soon</p>
        : <p className="text-sm font-bold" style={{ color: scoreColor(value ?? 0) }}>{estimating ? "—" : `${value ?? 0}`}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={approving ? undefined : onClose}>
      <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto" style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">AI Creative Studio</h2>
          </div>
          <button type="button" onClick={onClose} disabled={approving} className="text-white/40 hover:text-white disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        {/* Progress */}
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
          <label className={labelCls} title="Where the video will be published. Shapes format, length and tone.">Where are you publishing?</label>
          <select className={`${selCls} mt-1`} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
            {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>)}
          </select>
        </div>

        {/* Platform preview + intelligence */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg p-3 flex items-center gap-3" style={card}>
            <div className="flex items-center justify-center rounded border border-white/15 bg-white/[0.04]"
              style={{ width: aspect === "16:9" ? 50 : aspect === "1:1" ? 36 : 24, height: aspect === "9:16" ? 50 : aspect === "1:1" ? 36 : 28 }}>
              <span className="text-3xs text-white/40">{aspect}</span>
            </div>
            <div>
              <p className="text-2xs font-semibold text-white/80">{profile.label} preview</p>
              <p className="text-3xs text-white/50">{PLATFORM_SURFACE[platform]} · {orientation(aspect)}</p>
            </div>
          </div>
          <div className="rounded-lg p-3" style={card} title="Recommended settings for this platform.">
            <span className={labelCls}>Platform intelligence</span>
            <p className="text-3xs text-white/65 mt-1">{cap(profile.story.conversionStyle)} · {profile.story.pacing} pace · hook by {profile.story.hookBySec}s · {plo}–{phi}s</p>
          </div>
        </div>

        {/* Creative direction */}
        <span className={`${labelCls} block mb-1`}>Creative direction</span>
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div>
            <label className="text-3xs text-white/45">Format</label>
            <select className={`${selCls} mt-0.5`} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
              {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-3xs text-white/45">Length</label>
            <select className={`${selCls} mt-0.5`} value={duration} onChange={(e) => setDuration(e.target.value as DurationChoice)}>
              <option value="auto">Auto · {plo}–{phi}s</option>
              <option value="15">15s</option><option value="20">20s</option><option value="30">30s</option><option value="45">45s</option><option value="60">60s</option>
            </select>
          </div>
          <div>
            <label className="text-3xs text-white/45">Video style</label>
            <select className={`${selCls} mt-0.5`} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-3xs text-white/40 mb-3">Style engine: <span className="text-white/65">{md.engine}</span> · Best for {md.bestFor}</p>

        {/* How it's made */}
        <span className={`${labelCls} block mb-1`}>How your video is made</span>
        <div className="grid grid-cols-2 gap-2 mb-3">
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

        {/* Advanced (progressive disclosure) */}
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 text-3xs text-white/50 hover:text-white/80 mb-2">
          <ChevronDown size={12} className={`transition-transform ${advanced ? "rotate-180" : ""}`} /> Advanced options
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-3xs text-white/45">Resolution</label>
              <select className={`${selCls} mt-0.5`} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
                <option value="720p">720p · Standard</option>
                <option value="1080p" disabled>1080p · Coming soon</option>
              </select>
            </div>
            <div>
              <label className="text-3xs text-white/45">Quality</label>
              <select className={`${selCls} mt-0.5`} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                <option value="best">Best (Recommended)</option>
                <option value="balanced" disabled>Balanced · Coming soon</option>
                <option value="fast" disabled>Fast · Coming soon</option>
              </select>
            </div>
          </div>
        )}

        {/* AI Director Notes */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={`${labelCls} flex items-center gap-1`}><Sparkles size={11} className="text-cyan-400" /> AI Director Notes</span>
          {estimating && !strategy ? <p className="text-3xs text-white/40 mt-1">Composing the story…</p> : (
            <ul className="mt-1.5 space-y-1">
              {directorNotes.map((n, i) => <li key={i} className="text-3xs text-white/65 leading-snug">• {n}</li>)}
            </ul>
          )}
        </div>

        {/* Story Timeline + Storyboard */}
        {scenes.length > 0 && (
          <div className="mb-4 rounded-lg p-3" style={card}>
            <div className="flex items-center justify-between mb-1.5">
              <span className={`${labelCls} flex items-center gap-1`}><Film size={11} /> Story timeline</span>
              <span className="text-3xs text-white/40">{scenes.length} scenes · {totalDur}s</span>
            </div>
            <div className="flex gap-0.5 h-2 rounded overflow-hidden mb-2">
              {scenes.map((s, i) => (
                <div key={i} title={`${beatLabel(s.role)} · ${s.durationSec ?? 0}s`}
                  style={{ flex: Math.max(1, s.durationSec ?? 1), background: ["#5e6ad2", "#7170ff", "#22d3ee", "#34d399", "#fbbf24", "#a78bfa"][i % 6] }} />
              ))}
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {scenes.map((s, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-3xs">
                  <span className="text-white/45 w-16 shrink-0">{i + 1}. {beatLabel(s.role)}</span>
                  <span className="flex-1 text-white/70 line-clamp-1">{s.caption ? `“${s.caption}”` : (s.prompt ?? "").slice(0, 70)}</span>
                  <span className="text-white/35 shrink-0">{s.durationSec ?? 0}s</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content validation */}
        <div className="mb-4 rounded-lg p-3" style={card}>
          <span className={labelCls}>Content check · {profile.label}</span>
          <div className="space-y-0.5 mt-1.5">
            {validation.checks.map((c) => (
              <div key={c.field} className="flex items-center justify-between text-3xs">
                <span className="capitalize text-white/55">{c.field}</span>
                <span className={c.ok ? "text-white/60" : "text-red-400"}>{c.ok ? "✓" : "✗"} {c.actual} · needs {c.rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ───── Premium checkout cluster ───── */}
        {/* Production Readiness */}
        <div className="mb-3 rounded-xl p-3 flex items-start gap-2.5" style={{ background: rc.bg, border: `1px solid ${rc.fg}33` }}>
          <readiness.icon className={`h-4 w-4 mt-0.5 ${readiness.tone === "neutral" ? "animate-spin" : ""}`} style={{ color: rc.fg }} />
          <div>
            <p className="text-2xs font-bold" style={{ color: rc.fg }}>{readiness.title}</p>
            {readiness.lines.map((l, i) => <p key={i} className="text-3xs text-white/60 mt-0.5">{l}</p>)}
          </div>
        </div>

        {/* Expected deliverables */}
        <div className="mb-3 rounded-xl p-3" style={card}>
          <span className={`${labelCls} flex items-center gap-1`}><BadgeCheck size={11} className="text-emerald-400" /> You will receive</span>
          <p className="text-2xs text-white/80 mt-1">
            1 × <span className="font-semibold">{aspect} {resolution} MP4</span> · ~{duration === "auto" ? `${plo}–${phi}` : duration}s · {scenes.length || "—"} scenes · burned captions · brand bar &amp; CTA · ready to publish on {profile.label}.
          </p>
        </div>

        {/* Brand summary + match */}
        <div className="mb-3 rounded-xl p-3" style={card}>
          <div className="flex items-center justify-between">
            <span className={labelCls}>Brand</span>
            <span className="text-3xs" style={{ color: scoreColor(brand100) }}>Brand match {estimating ? "—" : `${brand100}%`}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-2xs text-white/75">
            <span className="flex items-center gap-1">{swatch(branding?.palette?.primary)}{swatch(branding?.palette?.secondary)}</span>
            <span className="text-white/40">·</span>
            <span>{branding?.brandName ?? "—"}</span>
            <span className="text-white/40">·</span>
            <span>{branding?.logoAssetId ? "Logo" : "Wordmark"} + CTA applied</span>
          </div>
        </div>

        {/* Cost + Time + Quality (checkout metrics) */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl p-3" style={card}>
            <p className={labelCls}>Estimated cost</p>
            <p className="text-xl font-bold text-cyan-200">{estimating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : money(estimate?.estimatedCostUsd)}</p>
            <p className="text-3xs text-white/35 mt-0.5">No charge until you approve.</p>
          </div>
          <div className="rounded-xl p-3" style={card}>
            <p className={`${labelCls} flex items-center gap-1`}><Clock size={10} /> Render time</p>
            <p className="text-sm font-semibold text-white/85 mt-0.5">{fmtTimeRange(estimate?.estRenderTimeSec)}</p>
            <p className="text-3xs text-white/35 mt-0.5">Varies with length &amp; demand.</p>
          </div>
          <div className="grid grid-rows-2 gap-2">
            <ScoreChip label="Quality" value={quality100} />
            <ScoreChip label="AI confidence" soon />
          </div>
        </div>

        {error && <p className="text-2xs text-red-400 mb-3">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
          <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5" onClick={onGenerate}
            disabled={approving || estimating || !estimate || !validation.ok}
            title={!validation.ok ? `Content does not meet ${profile.label} limits — regenerate first` : undefined}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {approving ? "Starting…" : `Generate Video${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
