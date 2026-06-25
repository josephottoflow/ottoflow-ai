"use client";

/**
 * VideoConfigModal — OttoFlow AI Creative Director (presentation layer).
 *
 * Feels like a creative director designing the customer's commercial: an AI
 * "thinking" reveal, a conversational direction panel, a visual storyboard, and
 * progressive disclosure so the screen is never dense. PRESENTATION ONLY — no
 * pipeline / API / pricing / rendering changes. Everything is fed by data the FREE
 * dryRun already returns; anything without a real signal is hidden or "Soon".
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

const MODE_OPTIONS = [
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
const SOURCE_OPTIONS = [
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
  { value: "9:16", label: "9:16 · Vertical" }, { value: "1:1", label: "1:1 · Square" }, { value: "16:9", label: "16:9 · Landscape" },
];
const PLATFORM_SURFACE: Record<Platform, string> = {
  linkedin: "Desktop & Mobile Feed", tiktok: "Vertical Full Screen", instagram_reels: "Reels Full Screen",
  instagram_feed: "In-Feed", facebook_reels: "Reels Full Screen", facebook_feed: "In-Feed",
  youtube_shorts: "Shorts Full Screen", youtube_standard: "Player", x: "Timeline",
};
const orientation = (a: AspectRatio) => (a === "9:16" ? "Vertical" : a === "1:1" ? "Square" : "Landscape");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const beatLabel = (role?: string) =>
  ({ hook: "Hook", problem: "Problem", visualized_pain: "Conflict", reveal: "Solution", outcome: "Transformation",
     proof: "Proof", solution: "Solution", tension: "Conflict", cta: "Call to action" } as Record<string, string>)[role ?? ""]
  ?? cap((role ?? "Scene").replace(/_/g, " "));
const beatObjective = (role?: string) =>
  ({ hook: "Stop the scroll", problem: "Establish the pain", visualized_pain: "Heighten the tension",
     tension: "Heighten the tension", reveal: "Reveal the solution", solution: "Reveal the solution",
     outcome: "Show the transformation", proof: "Prove it works", cta: "Drive the action" } as Record<string, string>)[role ?? ""] ?? "Advance the story";

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
  return `${lo}–${hi} min`;
}
function commercialQuality(strategy: StrategySummary | null, hasPalette: boolean, fit: boolean): number {
  const sc = strategy?.scenes ?? [];
  if (!sc.length) return 0;
  let s = Math.min(25, Math.round((sc.length / 6) * 25));
  const capOk = sc.filter((x) => { const w = (x.caption ?? "").trim().split(/\s+/).filter(Boolean).length; return w >= 2 && w <= 12; }).length;
  s += Math.round((capOk / sc.length) * 20);
  const distinct = new Set(sc.map((x) => (x.caption ?? "").trim().toLowerCase()).filter(Boolean)).size;
  s += Math.round((distinct / sc.length) * 15);
  s += sc[0]?.caption ? 10 : 0; s += fit ? 15 : 6; s += hasPalette ? 15 : 4;
  return Math.max(0, Math.min(100, s));
}
function brandMatch(b: Branding | null): number {
  if (!b) return 0;
  let s = 0; if (b.palette?.primary) s += 40; if (b.palette?.secondary) s += 20; s += b.logoAssetId ? 20 : 10; s += 20;
  return Math.min(100, s);
}
const scoreColor = (n: number) => (n >= 85 ? "#34d399" : n >= 65 ? "#fbbf24" : "#f87171");

const SECTION_CARD = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;
const SECTION_LABEL = "text-3xs uppercase tracking-wider text-white/45 font-semibold";

/** Module-level collapsible (stable identity → no remount / animation replay).
 * Open state lives in the parent so it survives dryRun re-renders. */
function Section({ open, onToggle, title, hint, icon, children }: {
  open: boolean; onToggle: () => void; title: string; hint?: string; icon?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg" style={SECTION_CARD}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2">
        <span className={`${SECTION_LABEL} flex items-center gap-1.5`}>{icon}{title}</span>
        <span className="flex items-center gap-2">{hint && <span className="text-3xs text-white/35">{hint}</span>}
          <ChevronDown size={12} className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`} /></span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Smoothly count a number toward `target` (premium cost micro-interaction). */
function useCountUp(target: number, active: boolean): number {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (!active || target === prev.current) { setV(target); prev.current = target; return; }
    const from = prev.current, to = target, start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 450);
      setV(from + (to - from) * t);
      if (t < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return v;
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
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpenSec((o) => ({ ...o, [k]: !o[k] }));

  const [estimate, setEstimate] = useState<RenderCostEstimate | null>(null);
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strategyRef = useRef<StrategySummary | null>(null);
  const reqId = useRef(0);

  function onPlatform(p: Platform) { setPlatform(p); setAspect(PLATFORM_PROFILES[p].video.aspect); setDuration("auto"); }

  const body = useCallback(
    (extra: Record<string, unknown>) => ({
      brandId, contentItemId, platform, aspect, resolution, quality, mode,
      ...(duration !== "auto" ? { durationSec: Number(duration) } : {}), ...extra,
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
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body({ dryRun: true })),
        });
        const json = (await res.json().catch(() => ({}))) as GenResponse;
        if (id !== reqId.current) return;
        if (!res.ok || !json.estimate) throw new Error(json.error ?? `Estimate failed (${res.status})`);
        setEstimate(json.estimate); setStrategy(json.strategy ?? null); strategyRef.current = json.strategy ?? null;
        setBranding(json.compositionPlan?.branding ?? null);
      } catch (err) {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err.message : String(err)); setEstimate(null);
      } finally { if (id === reqId.current) setEstimating(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [open, body]);

  const validation = validatePlatformContent(platform, {
    caption: contentBody ?? null, hashtags: contentHashtags ?? null, title: contentTitle ?? null, description: contentBody ?? null,
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
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setApproving(false); }
  }

  const profile = PLATFORM_PROFILES[platform];
  // AI "thinking" reveal (initial estimate only).
  const thinking = [
    "Understanding your brand…", "Planning your story…", `Optimizing for ${profile.label}…`, "Calculating cost…", "Preparing storyboard…",
  ];
  const [thinkStep, setThinkStep] = useState(0);
  const firstLoad = estimating && !estimate && !error;
  useEffect(() => {
    if (!firstLoad) return;
    setThinkStep(0);
    const i = setInterval(() => setThinkStep((s) => Math.min(thinking.length - 1, s + 1)), 600);
    return () => clearInterval(i);
  }, [firstLoad, thinking.length]);

  const scenes = strategy?.scenes ?? [];
  const totalDur = scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0);
  const [plo, phi] = profile.video.targetDurationSec;
  const fit = totalDur >= plo * 0.8 && totalDur <= phi * 1.2;
  const hasPalette = !!(branding?.palette?.primary);
  const quality100 = commercialQuality(strategy, hasPalette, fit);
  const brand100 = brandMatch(branding);
  const costAnim = useCountUp(estimate?.estimatedCostUsd ?? 0, !estimating && !!estimate);

  if (!open) return null;

  const labelCls = "text-3xs uppercase tracking-wider text-white/45 font-semibold";
  const selCls = "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;
  const md = MODE_DETAIL[mode];

  const ready = !error && validation.ok && !!estimate && !estimating;
  const readiness = error
    ? { tone: "red" as const, icon: AlertCircle, title: "Missing Required Information", lines: [error] }
    : !validation.ok
      ? { tone: "amber" as const, icon: AlertTriangle, title: "Needs a quick fix", lines: [`Post copy doesn't meet ${profile.label} limits — ${validation.checks.filter((c) => !c.ok).map((c) => `${c.field} ${c.actual} (needs ${c.rule})`).join("; ")}.`, "Regenerate the post for this platform first."] }
      : !ready
        ? { tone: "neutral" as const, icon: Loader2, title: "Designing your video…", lines: ["Composing the story and validating content."] }
        : { tone: "green" as const, icon: CheckCircle2, title: "Ready to Create ✨", lines: ["✨ Your commercial is ready to generate.", `Renders in ~${fmtTimeRange(estimate.estRenderTimeSec)} · ${resolution} MP4`] };
  const readyColors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "rgba(16,185,129,0.10)", fg: "#34d399" }, amber: { bg: "rgba(245,158,11,0.10)", fg: "#fbbf24" },
    red: { bg: "rgba(239,68,68,0.10)", fg: "#f87171" }, neutral: { bg: "rgba(255,255,255,0.04)", fg: "#cbd5e1" },
  };
  const rc = readyColors[readiness.tone];

  // Conversational AI direction (from real dryRun data).
  const styleWord = profile.story.conversionStyle === "authority" ? "professional" : profile.story.conversionStyle === "direct" ? "punchy" : "lifestyle";
  const direction = [
    `I'm directing a ${profile.story.pacing}-paced commercial — ${profile.label} audiences retain ${styleWord} storytelling better than rapid edits.`,
    `It opens on a real pain point, then reveals ${branding?.brandName ?? "your product"} as the resolution.`,
    `We finish on a clear, on-brand call to action.`,
  ];

  const swatch = (c?: string | null) => c
    ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/15 align-middle" style={{ background: c }} title={c} />
    : <span className="text-white/30 text-3xs">—</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={approving ? undefined : onClose}>
      <style>{`@keyframes csFadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.cs-fade{animation:csFadeUp .35s ease both}.cs-press{transition:transform .12s ease}.cs-press:active{transform:scale(.98)}`}</style>
      <div className="w-full max-w-xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto cs-fade" style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white leading-none">AI Creative Director</h2>
              <p className="text-3xs text-cyan-300/80 mt-0.5">Optimized for {profile.label}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={approving} className="text-white/40 hover:text-white disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-3xs text-white/40 mb-3 line-clamp-1">{contentTitle ?? contentItemId}</p>

        {firstLoad ? (
          /* AI thinking reveal */
          <div className="py-6 px-2 space-y-2">
            {thinking.map((t, i) => (
              <div key={i} className={`flex items-center gap-2 text-xs transition-opacity ${i <= thinkStep ? "opacity-100" : "opacity-25"}`}>
                {i < thinkStep ? <Check size={14} className="text-emerald-400" /> : i === thinkStep ? <Loader2 size={14} className="animate-spin text-cyan-400" /> : <span className="w-3.5" />}
                <span className={i <= thinkStep ? "text-white/80" : "text-white/40"}>{t}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Platform (always open) */}
            <div className="mb-3">
              <label className={labelCls}>Where are you publishing?</label>
              <select className={`${selCls} mt-1`} value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
                {PLATFORM_ORDER.map((p) => <option key={p} value={p}>{PLATFORM_PROFILES[p].label}</option>)}
              </select>
            </div>

            {/* Preview (always open — answers "what am I making") */}
            <div className="mb-3 rounded-lg p-3 flex items-center gap-3 cs-fade" style={card}>
              <div className="flex items-center justify-center rounded border border-white/15 bg-white/[0.04]"
                style={{ width: aspect === "16:9" ? 50 : aspect === "1:1" ? 36 : 24, height: aspect === "9:16" ? 50 : aspect === "1:1" ? 36 : 28 }}>
                <span className="text-3xs text-white/40">{aspect}</span>
              </div>
              <div>
                <p className="text-2xs font-semibold text-white/80">{profile.label} preview</p>
                <p className="text-3xs text-white/50">{PLATFORM_SURFACE[platform]} · {orientation(aspect)} · {duration === "auto" ? `${plo}–${phi}s` : `${duration}s`}</p>
              </div>
            </div>

            {/* Creative Direction (always open) */}
            <span className={`${labelCls} block mb-1`}>Creative Direction</span>
            <div className="grid grid-cols-3 gap-3 mb-1.5">
              <div><label className="text-3xs text-white/45">Format</label>
                <select className={`${selCls} mt-0.5`} value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
                  {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
              <div><label className="text-3xs text-white/45">Length</label>
                <select className={`${selCls} mt-0.5`} value={duration} onChange={(e) => setDuration(e.target.value as DurationChoice)}>
                  <option value="auto">Auto · {plo}–{phi}s</option><option value="15">15s</option><option value="20">20s</option><option value="30">30s</option><option value="45">45s</option><option value="60">60s</option></select></div>
              <div><label className="text-3xs text-white/45">Video style</label>
                <select className={`${selCls} mt-0.5`} value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
            </div>
            <p className="text-3xs text-white/40 mb-3">Style engine: <span className="text-white/65">{md.engine}</span> · Best for {md.bestFor}</p>

            {/* ── Collapsibles (reduce density) ── */}
            <Section open={!!openSec["today"]} onToggle={() => toggle("today")} title="Today's Direction" icon={<Sparkles size={11} className="text-cyan-400" />} hint="from your AI Director">
              <ul className="space-y-1.5">{direction.map((d, i) => <li key={i} className="text-2xs text-white/70 italic leading-snug">&ldquo;{d}&rdquo;</li>)}</ul>
            </Section>

            <Section open={!!openSec["story"]} onToggle={() => toggle("story")} title="Story Preview" icon={<Film size={11} />} hint={`${scenes.length} scenes · ${totalDur}s`}>
              <div className="space-y-1.5">
                {scenes.map((s, i) => (
                  <div key={i}>
                    <div className="rounded-lg p-2 flex items-start gap-2" style={card}>
                      <span className="text-3xs font-bold text-cyan-300/80 w-4 shrink-0">{i + 1}</span>
                      <div className="flex-1">
                        <p className="text-2xs font-semibold text-white/85">{i === 0 ? "🎬 " : ""}{beatLabel(s.role)} <span className="text-white/30 font-normal">· {beatObjective(s.role)}</span></p>
                        {s.caption && <p className="text-3xs text-white/60 italic mt-0.5">&ldquo;{s.caption}&rdquo;</p>}
                      </div>
                      <span className="text-3xs text-white/35 shrink-0">{s.durationSec ?? 0}s</span>
                    </div>
                    {i < scenes.length - 1 && <div className="flex justify-center py-0.5"><ChevronDown size={12} className="text-white/25" /></div>}
                  </div>
                ))}
              </div>
            </Section>

            <Section open={!!openSec["intel"]} onToggle={() => toggle("intel")} title="Platform Intelligence" hint={`why ${profile.label}`}>
              <p className="text-2xs text-white/65">{cap(profile.story.conversionStyle)} tone · {profile.story.pacing} pacing · hook by {profile.story.hookBySec}s · {plo}–{phi}s recommended.</p>
            </Section>

            <Section open={!!openSec["visual"]} onToggle={() => toggle("visual")} title="Visual Style" hint="how it's made">
              <div className="grid grid-cols-2 gap-2">
                {SOURCE_OPTIONS.map((o) => {
                  const active = source === o.value;
                  return (
                    <button key={o.value} type="button" disabled={!o.enabled} onClick={() => o.enabled && setSource(o.value)} title={o.desc}
                      className="text-left rounded-lg p-2.5 transition disabled:cursor-not-allowed"
                      style={{ background: active ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}`, opacity: o.enabled ? 1 : 0.5 }}>
                      <div className="flex items-center gap-1.5 mb-0.5"><span className="text-2xs font-semibold text-white/85">{o.label}</span>
                        {o.value === "auto" && <span className="text-3xs text-cyan-300">Recommended</span>}
                        {!o.enabled && <span className="text-3xs text-white/40 flex items-center gap-0.5"><Lock size={9} /> Soon</span>}</div>
                      <p className="text-3xs text-white/50 leading-snug">{o.desc}</p>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section open={!!openSec["brand"]} onToggle={() => toggle("brand")} title="Brand" hint={`match ${estimating ? "…" : `${brand100}%`}`}>
              <div className="flex items-center gap-3 text-2xs text-white/75">
                <span className="flex items-center gap-1">{swatch(branding?.palette?.primary)}{swatch(branding?.palette?.secondary)}</span>
                <span className="text-white/40">·</span><span>{branding?.brandName ?? "—"}</span>
                <span className="text-white/40">·</span><span>{branding?.logoAssetId ? "Logo" : "Wordmark"} + CTA applied</span>
              </div>
            </Section>

            <Section open={!!openSec["check"]} onToggle={() => toggle("check")} title={`Content check · ${profile.label}`} hint={validation.ok ? "all good" : "needs fix"}>
              <div className="space-y-0.5">{validation.checks.map((c) => (
                <div key={c.field} className="flex items-center justify-between text-3xs"><span className="capitalize text-white/55">{c.field}</span>
                  <span className={c.ok ? "text-white/60" : "text-red-400"}>{c.ok ? "✓" : "✗"} {c.actual} · needs {c.rule}</span></div>))}</div>
            </Section>

            <Section open={!!openSec["advanced"]} onToggle={() => toggle("advanced")} title="Advanced Settings" hint="resolution · quality">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-3xs text-white/45">Resolution</label>
                  <select className={`${selCls} mt-0.5`} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
                    <option value="720p">720p · Standard</option><option value="1080p" disabled>1080p · Soon</option></select></div>
                <div><label className="text-3xs text-white/45">Quality</label>
                  <select className={`${selCls} mt-0.5`} value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                    <option value="best">Best (Recommended)</option><option value="balanced" disabled>Balanced · Soon</option><option value="fast" disabled>Fast · Soon</option></select></div>
              </div>
            </Section>

            {/* ── Premium checkout (always open) ── */}
            <div className="mt-3 mb-3 rounded-xl p-3 flex items-start gap-2.5 cs-fade" style={{ background: rc.bg, border: `1px solid ${rc.fg}33` }}>
              <readiness.icon className={`h-4 w-4 mt-0.5 ${readiness.tone === "neutral" ? "animate-spin" : ""}`} style={{ color: rc.fg }} />
              <div><p className="text-2xs font-bold" style={{ color: rc.fg }}>{readiness.title}</p>
                {readiness.lines.map((l, i) => <p key={i} className="text-3xs text-white/60 mt-0.5">{l}</p>)}</div>
            </div>

            <div className="mb-3 rounded-xl p-3 cs-fade" style={card}>
              <span className={`${labelCls} flex items-center gap-1`}><BadgeCheck size={11} className="text-emerald-400" /> What you&rsquo;re making</span>
              <p className="text-2xs text-white/80 mt-1">1 × <span className="font-semibold">{aspect} {resolution} MP4</span> · ~{duration === "auto" ? `${plo}–${phi}` : duration}s · {scenes.length || "—"} scenes · captions · brand bar &amp; CTA · ready to publish on {profile.label}.</p>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl p-3 cs-fade" style={card}>
                <p className={labelCls}>Cost</p>
                <p className="text-xl font-bold text-cyan-200 tabular-nums">{estimating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : `$${costAnim.toFixed(2)}`}</p>
                <p className="text-3xs text-white/35 mt-0.5">No charge until approved.</p>
              </div>
              <div className="rounded-xl p-3 cs-fade" style={card}>
                <p className={`${labelCls} flex items-center gap-1`}><Clock size={10} /> Time</p>
                <p className="text-sm font-semibold text-white/85 mt-0.5">{fmtTimeRange(estimate?.estRenderTimeSec)}</p>
                <p className="text-3xs text-white/35 mt-0.5">Varies with demand.</p>
              </div>
              <div className="grid grid-rows-2 gap-2">
                <div className="rounded-lg px-2.5 py-1.5 text-center cs-fade" style={card}>
                  <p className="text-3xs text-white/40">Creative quality</p>
                  <p className="text-sm font-bold" style={{ color: scoreColor(quality100) }}>{estimating ? "—" : quality100}</p></div>
                <div className="rounded-lg px-2.5 py-1.5 text-center" style={card}>
                  <p className="text-3xs text-white/40">AI confidence</p>
                  <p className="text-3xs text-white/35"><Lock size={8} className="inline mr-0.5" />Soon</p></div>
              </div>
            </div>

            {error && <p className="text-2xs text-red-400 mb-3">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
              <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5 cs-press hover:scale-[1.02] transition-transform" onClick={onGenerate}
                disabled={approving || estimating || !estimate || !validation.ok}
                title={!validation.ok ? `Regenerate the post for ${profile.label} first` : undefined}>
                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                {approving ? "Starting…" : `Generate Video${estimate ? ` (${money(estimate.estimatedCostUsd)})` : ""}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
