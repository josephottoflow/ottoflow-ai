"use client";

/**
 * VideoConfigModal — OttoFlow AI Creative Studio (presentation layer).
 *
 * Feels like a premium AI Creative Director: it explains, previews, and justifies
 * every creative decision — a Creative Brief, premium Scene Cards, a Moodboard,
 * AI Director reasoning, a performance explanation, and an honest deliverables
 * list. PRESENTATION ONLY — no pipeline / API / pricing / rendering changes. The
 * render payload (`body()`), the dryRun fetch, and the checkout/Generate logic are
 * byte-identical to before. Everything shown is fed by data the FREE dryRun already
 * returns (strategy + estimate + branding) or the platform profile; anything
 * without a real signal is clearly labelled "Coming soon".
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Clapperboard, X, Lock, CheckCircle2, AlertTriangle, AlertCircle, Check,
  ChevronDown, ChevronRight, Film, Sparkles, Clock, BadgeCheck, Palette as PaletteIcon,
  Camera, Sun, Type as TypeIcon, Wand2, Gauge, Target, Users, Heart, MessageSquareQuote,
  FileVideo, Layers,
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
// Visual sources (Sprint 15). `available:true` = selectable today. AI Generated is
// live. Royalty-Free Library (Pexels) backend is shipped but kept Beta-locked
// (not selectable) until verified end-to-end. Premium Stock & Hybrid stay Coming soon.
type SourceId = "ai" | "pexels" | "premium_stock" | "hybrid" | "brand_footage" | "customer_uploads" | "motion_templates";
interface VisualSource {
  id: SourceId; name: string; available: boolean; recommended?: boolean; beta?: boolean;
  desc: string; bestFor?: string; pros?: string[]; cons?: string[]; note?: string;
  example: "abstract" | "photo" | "mix"; pricing?: string;
}
const VISUAL_SOURCES: VisualSource[] = [
  { id: "ai", name: "AI Generated", available: true, recommended: true, example: "abstract",
    desc: "Original AI-created scenes.",
    bestFor: "SaaS · Technology · Corporate · Product launches · Abstract concepts",
    pros: ["Unique", "Brand-aligned", "Unlimited creativity"],
    cons: ["Highest render cost", "Slightly longer to generate"] },
  { id: "pexels", name: "Royalty-Free Library", available: true, beta: true, example: "photo",
    desc: "Professional licensed footage from a royalty-free library.",
    bestFor: "Travel · Lifestyle · Food · Real people · Construction",
    pros: ["Authentic", "Fast", "No AI generation cost"], cons: ["Limited to library footage"],
    pricing: "No AI generation cost" },
  { id: "premium_stock", name: "Premium Stock", available: false, example: "photo",
    desc: "Curated premium stock footage & photography.",
    bestFor: "Real people · Lifestyle · Travel · Food · Fashion",
    pros: ["Very realistic", "Fast"], cons: ["Limited to available footage"] },
  { id: "hybrid", name: "Hybrid", available: false, example: "mix",
    desc: "AI-generated hero scenes combined with stock footage.",
    bestFor: "Highest production quality",
    pros: ["Best of both"], cons: ["Highest cost"] },
];
// Future-proof slots — render naturally as Coming-soon chips (P6).
const FUTURE_SOURCES: { id: SourceId; name: string }[] = [
  { id: "brand_footage", name: "Brand Footage" },
  { id: "customer_uploads", name: "Customer Uploads" },
  { id: "motion_templates", name: "Motion Templates" },
];
// Intelligent recommendation (Sprint 15 P6) — multi-factor: industry + platform +
// content objective (mode). Returns the ideal source + an AI-Creative-Director reason.
function recommendSource(industry: string | null | undefined, platformLabel: string, mode: string): { id: SourceId; why: string } {
  const i = (industry ?? "").toLowerCase();
  const realWorld = /travel|tourism|food|restaurant|hospitality|hotel|fashion|retail|lifestyle|fitness|beauty|construction|event|wellness/.test(i);
  const productLed = mode === "product_demo" || mode === "founder_video";
  // Luxury & product-led stories favour AI's controlled, premium look even in
  // otherwise real-world industries (e.g. luxury real estate, product launches).
  if (realWorld && !productLed && !/luxury/.test(i)) {
    const what = (i.match(/travel|tourism|food|restaurant|hospitality|fashion|lifestyle|fitness|beauty|construction/) ?? ["real-world"])[0];
    return { id: "pexels", why: `authentic footage typically performs better for ${what} & lifestyle content on ${platformLabel}` };
  }
  return { id: "ai", why: `original AI scenes give a controlled, premium, on-brand look — ideal for software, corporate${productLed ? " and product-led" : ""} stories` };
}
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
// Who this platform reaches — a truthful, platform-derived characterisation.
const PLATFORM_AUDIENCE: Record<Platform, string> = {
  linkedin: "Professionals & decision-makers",
  tiktok: "Gen-Z & trend-driven viewers",
  instagram_reels: "Lifestyle & discovery audiences",
  instagram_feed: "Engaged followers in-feed",
  facebook_reels: "Broad social viewers",
  facebook_feed: "Community & in-feed audiences",
  youtube_shorts: "Short-form browsers",
  youtube_standard: "Intent-driven searchers",
  x: "Fast-scroll timeline readers",
};
const orientation = (a: AspectRatio) => (a === "9:16" ? "Vertical" : a === "1:1" ? "Square" : "Landscape");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const beatLabel = (role?: string) =>
  ({ hook: "Hook", problem: "Problem", visualized_pain: "Conflict", reveal: "Solution", outcome: "Outcome",
     proof: "Proof", solution: "Solution", tension: "Conflict", cta: "Call to action" } as Record<string, string>)[role ?? ""]
  ?? cap((role ?? "Scene").replace(/_/g, " "));
const beatObjective = (role?: string) =>
  ({ hook: "Stop the scroll", problem: "Establish the pain", visualized_pain: "Heighten the tension",
     tension: "Heighten the tension", reveal: "Reveal the solution", solution: "Reveal the solution",
     outcome: "Show the transformation", proof: "Prove it works", cta: "Drive the action" } as Record<string, string>)[role ?? ""] ?? "Advance the story";
// Emotional beat the viewer feels — derived from the real scene role.
const beatEmotion = (role?: string) =>
  ({ hook: "Curiosity", problem: "Tension", visualized_pain: "Frustration", tension: "Frustration",
     reveal: "Relief", solution: "Relief", outcome: "Aspiration", proof: "Trust", cta: "Action" } as Record<string, string>)[role ?? ""] ?? "Engagement";

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

/** A small "brief" row: label + value (or a Coming-soon lock). */
function BriefRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-cyan-300/70 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">{label}</p>
        <div className="text-2xs text-white/80 leading-snug mt-0.5">{children}</div>
      </div>
    </div>
  );
}
const Soon = () => (
  <span className="text-3xs text-white/40 inline-flex items-center gap-0.5"><Lock size={9} /> Coming soon</span>
);

/** A small representative "example style" swatch for a visual source (P4).
 * Decorative only — clearly an example, never the user's actual asset. */
function ExampleChip({ kind }: { kind: "abstract" | "photo" | "mix" }) {
  const bg = kind === "abstract"
    ? "radial-gradient(circle at 30% 25%, rgba(34,211,238,0.7), transparent 60%), linear-gradient(135deg, rgba(129,140,248,0.55), rgba(34,211,238,0.3))"
    : kind === "photo"
      ? "linear-gradient(135deg, #3a4a5a, #6b7a88)"
      : "linear-gradient(135deg, rgba(34,211,238,0.5) 0 50%, #5a6a78 50% 100%)";
  return (
    <span className="w-11 h-11 rounded-lg shrink-0 relative overflow-hidden" style={{ background: bg, border: "1px solid rgba(255,255,255,0.1)" }}
      title="Example style — not your asset" aria-label="Example style">
      <span className="absolute bottom-0 inset-x-0 text-center text-white/75 leading-none py-0.5" style={{ fontSize: 7, background: "rgba(0,0,0,0.35)" }}>example</span>
    </span>
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
  /** Presentation only — seeds the initial publishing platform (the guided wizard
   * picks it in Step 3). Does not change the generate payload behaviour; the user
   * can still change it inside the Studio. */
  initialPlatform?: Platform;
  /** Presentation only — the brand's industry (from the wizard) used to recommend a
   * visual source (P3). Optional: entry from a content item won't pass it. */
  brandIndustry?: string | null;
  onClose: () => void;
}

export function VideoConfigModal({
  open, brandId, contentItemId, contentTitle, contentBody, contentHashtags, initialPlatform, brandIndustry, onClose,
}: VideoConfigModalProps) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>(initialPlatform ?? "linkedin");
  const [aspect, setAspect] = useState<AspectRatio>(PLATFORM_PROFILES[initialPlatform ?? "linkedin"].video.aspect);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [duration, setDuration] = useState<DurationChoice>("auto");
  const [source, setSource] = useState<SourceId>("ai");
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
      // Sprint 31.1 — send the chosen visual source so "pexels" routes to the
      // stock-first pipeline (no AI/Seedance cost). Only ai/pexels are selectable.
      source: source === "pexels" ? "pexels" : "ai",
      ...(duration !== "auto" ? { durationSec: Number(duration) } : {}), ...extra,
    }),
    [brandId, contentItemId, platform, aspect, resolution, quality, mode, duration, source],
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
    // Sprint 31.1 — post-copy validation is a PUBLISH concern, not a render one.
    // The video's on-screen captions are scene narration (burned in), independent
    // of the social post copy — so a too-long caption must NOT block generation.
    // It stays visible as advisory; the caption is fixed before publishing.
    if (approving) return;
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

  // ── Derived creative copy — all from real signals (strategy / profile / branding) ──
  const st = profile.story;
  const styleWord = st.conversionStyle === "authority" ? "professional" : st.conversionStyle === "direct" ? "punchy" : "lifestyle";
  const toneWord = st.conversionStyle === "authority" ? "Credible & expert-led" : st.conversionStyle === "direct" ? "Clear & action-oriented" : "Warm & relatable";
  const transitionWord = st.pacing === "fast" ? "Quick cuts" : st.pacing === "slow" ? "Gentle dissolves" : "Smooth cuts";
  const cameraStyles = Array.from(new Set(scenes.map((s) => s.camera).filter(Boolean))) as string[];
  const journeyRaw = scenes.map((s) => beatEmotion(s.role));
  const journey = journeyRaw.filter((w, i) => i === 0 || w !== journeyRaw[i - 1]);
  const primaryMessage = (strategy?.video_concept ?? "").trim() || (scenes[0]?.caption ?? "").trim() || (contentTitle ?? "").trim();
  const theme = (strategy?.visual_metaphor ?? "").trim() || (strategy?.visual_tension ?? "").trim() || `${cap(mode.replace(/_/g, " "))} for ${branding?.brandName ?? "your brand"}`;
  const visualStyleStr = `${cap(st.sceneComplexity)} · ${MODE_OPTIONS.find((m) => m.value === mode)?.label ?? cap(mode)}`;
  const expectedReaction = st.conversionStyle === "authority"
    ? "Builds trust and positions the brand as the credible choice."
    : st.conversionStyle === "direct"
      ? "Drives an immediate, decisive response to the call-to-action."
      : "Leaves viewers feeling the brand understands them — and wanting more.";

  if (!open) return null;

  const labelCls = "text-3xs uppercase tracking-wider text-white/45 font-semibold";
  const selCls = "w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 px-3 py-2 focus:outline-none focus:border-cyan-400/50 disabled:opacity-40";
  const card = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" } as const;
  const md = MODE_DETAIL[mode];

  // Post-copy validity is advisory only — it no longer gates render (Sprint 31.1).
  const ready = !error && !!estimate && !estimating;
  const readiness = error
    ? { tone: "red" as const, icon: AlertCircle, title: "Missing Required Information", lines: [error] }
    : !ready
      ? { tone: "neutral" as const, icon: Loader2, title: "Designing your video…", lines: ["Composing the story and validating content."] }
      : !validation.ok
        ? { tone: "amber" as const, icon: AlertTriangle, title: "Heads up: post copy needs trimming", lines: [`The ${profile.label} caption is ${validation.checks.filter((c) => !c.ok).map((c) => `${c.field} ${c.actual} (needs ${c.rule})`).join("; ")} — trim it before publishing. The video will still render now.`] }
        : { tone: "green" as const, icon: CheckCircle2, title: "Ready to Create ✨", lines: ["✨ Your commercial is ready to generate.", `Renders in ~${fmtTimeRange(estimate.estRenderTimeSec)} · ${resolution} MP4`] };
  const readyColors: Record<string, { bg: string; fg: string }> = {
    green: { bg: "rgba(16,185,129,0.10)", fg: "#34d399" }, amber: { bg: "rgba(245,158,11,0.10)", fg: "#fbbf24" },
    red: { bg: "rgba(239,68,68,0.10)", fg: "#f87171" }, neutral: { bg: "rgba(255,255,255,0.04)", fg: "#cbd5e1" },
  };
  const rc = readyColors[readiness.tone];

  // ── Why this will perform (P4) — every factor tied to a real signal ──
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  const [smin, smax] = profile.video.sceneCount;
  const complete = scenes.length >= smin && scenes.length <= smax;
  const ctaOk = !!(last && (last.role === "cta" || (last.caption ?? "").trim()));
  const perfFactors: { k: string; ok: boolean; detail: string }[] = scenes.length ? [
    { k: "Platform optimized", ok: fit, detail: fit ? `Length lands in ${profile.label}'s sweet spot (${plo}–${phi}s)` : `Length is outside ${profile.label}'s ideal ${plo}–${phi}s` },
    { k: "Hook timing", ok: !!first, detail: first ? `Opens on a hook in the first ${first.durationSec ?? "—"}s (target ≤${st.hookBySec}s)` : "No opening hook detected" },
    { k: "Brand visibility", ok: hasPalette, detail: hasPalette ? `${branding?.brandName ?? "Brand"} colors${branding?.logoAssetId ? " + logo" : ""} carried throughout` : "Add brand colors for stronger recall" },
    { k: "Story completeness", ok: complete, detail: complete ? `${scenes.length}-beat arc, within the ${smin}–${smax} recommended` : `${scenes.length} beats (recommended ${smin}–${smax})` },
    { k: "Clear call-to-action", ok: ctaOk, detail: ctaOk ? "Closes on a clear call-to-action" : "No closing call-to-action detected" },
  ] : [];

  // ── AI Director reasoning (P6) — plain language from real profile values ──
  const reasoning: { k: string; v: string }[] = [
    { k: "Pacing", v: `${cap(st.pacing)} — ${profile.label} viewers respond to ${st.pacing === "fast" ? "quick, high-energy cuts" : st.pacing === "slow" ? "a deliberate, considered rhythm" : "a balanced rhythm"}.` },
    { k: "Hook", v: `Leads within ${st.hookBySec}s at ${st.hookIntensity} intensity — to stop the scroll before viewers drop.` },
    { k: "Tone", v: `${toneWord} — matched to how this audience prefers to be spoken to.` },
    { k: "Structure", v: scenes.length ? `A ${scenes.length}-beat arc (${journey.join(" → ")}) — a complete story from hook to action.` : `A complete arc from hook to call-to-action.` },
  ];

  // ── Phase 1: AI Art Direction — chosen from real signals (platform tone + style).
  //    Industry isn't in the dryRun payload, so the direction keys off the platform's
  //    conversion style + the selected video style (both real). Presentation only. ──
  const ART = {
    authority: { name: "Editorial Corporate", lighting: "Soft directional key with deep, controlled falloff", camera: "Composed and locked-off, with generous negative space", texture: "Matte, fine-grain — premium and understated", imagery: "Real people in considered, credible product moments", emotion: "Assured and trustworthy", feeling: "a brand you can rely on" },
    direct: { name: "Bold Modern", lighting: "High-contrast with punchy, confident highlights", camera: "Close and kinetic, around a single large focal subject", texture: "Crisp and saturated with a clean, glossy finish", imagery: "Hero product, decisive gestures, strong silhouettes", emotion: "Energetic and confident", feeling: "made for right now" },
    soft: { name: "Lifestyle Editorial", lighting: "Warm natural light with a gentle, flattering bloom", camera: "Handheld warmth and shallow depth of field", texture: "Soft and tactile — organic and human", imagery: "Candid, in-the-moment, human-first", emotion: "Warm and relatable", feeling: "a brand that gets you" },
  } as const;
  const art = ART[st.conversionStyle as keyof typeof ART] ?? ART.authority;
  const otherArts = (Object.keys(ART) as (keyof typeof ART)[]).filter((k) => k !== (st.conversionStyle as keyof typeof ART)).map((k) => ART[k]);
  const directions = [
    { tag: "A", name: art.name, note: "Recommended · renders today", live: true },
    { tag: "B", name: otherArts[0]?.name ?? "Modern Tech", note: "Preview only", live: false },
    { tag: "C", name: otherArts[1]?.name ?? "Bold Editorial", note: "Preview only", live: false },
  ];
  const platformRationale = `Tuned for ${profile.label}: ${aspect} · ${cap(st.pacing)} pace · hook by ${st.hookBySec}s · ${profile.video.captionDensity}-density captions.`;
  const recommendation = `${art.name} suits ${branding?.brandName ?? "your brand"} on ${profile.label} — ${art.feeling}, delivered with ${art.emotion.toLowerCase()} energy.`;
  // Visual-source recommendation (Sprint 15 P6) — multi-factor (industry + platform + objective).
  const rec = recommendSource(brandIndustry, profile.label, mode);
  const recSource = VISUAL_SOURCES.find((s) => s.id === rec.id);

  // Brand palette → atmosphere (colour becomes light & gradient, never a flat block).
  const pal = [branding?.palette?.primary, branding?.palette?.secondary, branding?.palette?.accent].filter(Boolean) as string[];
  const atmosphere = pal.length
    ? `radial-gradient(120% 120% at 18% 0%, ${pal[0]}66, transparent 58%), radial-gradient(130% 120% at 100% 100%, ${(pal[1] ?? pal[0])}4d, transparent 55%), linear-gradient(125deg, ${pal[0]}26, ${(pal[2] ?? pal[1] ?? pal[0])}1a)`
    : "radial-gradient(120% 120% at 18% 0%, rgba(34,211,238,0.28), transparent 58%), linear-gradient(125deg, rgba(34,211,238,0.12), rgba(129,140,248,0.10))";

  // ── Phase 2: Creative moodboard (agency board, not info boxes) — derived from the
  //    chosen art direction + real scene camera + pacing. ──
  const board: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <Film size={11} />, label: "Imagery", value: art.imagery },
    { icon: <Sun size={11} />, label: "Lighting", value: art.lighting },
    { icon: <Camera size={11} />, label: "Camera", value: cameraStyles.length ? cameraStyles.slice(0, 2).join(", ") : art.camera },
    { icon: <Layers size={11} />, label: "Texture", value: art.texture },
    { icon: <Gauge size={11} />, label: "Motion", value: `${cap(st.pacing)} pacing — ${transitionWord.toLowerCase()}` },
    { icon: <Heart size={11} />, label: "Emotional tone", value: art.emotion },
    { icon: <TypeIcon size={11} />, label: "Composition", value: `${profile.video.aspect} · ${st.sceneComplexity} framing, generous focal space` },
  ];

  // ── Deliverables (P5) ──
  const deliverables: { label: string; value: ReactNode; on: boolean }[] = [
    { label: "Video file", value: "MP4", on: true },
    { label: "Resolution", value: resolution, on: true },
    { label: "Aspect ratio", value: aspect, on: true },
    { label: "Captions", value: "Burned-in", on: true },
    { label: "Brand outro", value: "Logo + CTA", on: true },
    { label: "Caption & hashtags", value: "Included", on: true },
    { label: "Transcript", value: <Soon />, on: false },
    { label: "Thumbnail", value: <Soon />, on: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={approving ? undefined : onClose}>
      <style>{`@keyframes csFadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.cs-fade{animation:csFadeUp .35s ease both}.cs-press{transition:transform .12s ease}.cs-press:active{transform:scale(.98)}`}</style>
      <div className="w-full max-w-xl rounded-2xl p-6 max-h-[92vh] overflow-y-auto cs-fade" style={{ background: "rgba(18,20,28,0.97)", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white leading-none">AI Creative Studio</h2>
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

            {/* ── P8: Original Content → AI Interpretation → Final Video ── */}
            <div className="mb-3 rounded-xl p-3 cs-fade" style={card}>
              <span className={`${labelCls} flex items-center gap-1 mb-2`}><Wand2 size={11} className="text-cyan-400" /> How your content becomes a video</span>
              <div className="flex items-stretch gap-1.5">
                <div className="flex-1 rounded-lg p-2" style={card}>
                  <p className="text-3xs text-white/40 font-semibold mb-0.5">Your content</p>
                  <p className="text-3xs text-white/75 line-clamp-3 leading-snug">{contentTitle ?? "—"}</p>
                </div>
                <div className="flex items-center"><ChevronRight size={14} className="text-cyan-400/60" /></div>
                <div className="flex-1 rounded-lg p-2" style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}>
                  <p className="text-3xs text-cyan-300/70 font-semibold mb-0.5">AI interpretation</p>
                  <p className="text-3xs text-white/75 line-clamp-3 leading-snug">{estimating ? "Designing…" : (primaryMessage || "Crafting a story…")}</p>
                </div>
                <div className="flex items-center"><ChevronRight size={14} className="text-cyan-400/60" /></div>
                <div className="flex-1 rounded-lg p-2" style={card}>
                  <p className="text-3xs text-white/40 font-semibold mb-0.5">Final video</p>
                  <p className="text-3xs text-white/75 leading-snug">{aspect} {resolution} MP4 · {scenes.length || "—"} scenes · captions + brand</p>
                </div>
              </div>
            </div>

            {/* ── P1: Creative Brief (always open — the headline creative summary) ── */}
            <div className="mb-3 rounded-xl p-3.5 cs-fade" style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.16)" }}>
              <span className={`${labelCls} flex items-center gap-1 mb-2.5`} style={{ color: "rgba(165,243,252,0.7)" }}><Sparkles size={11} className="text-cyan-400" /> Creative Brief</span>
              {estimating ? (
                <p className="text-2xs text-white/50 italic">Composing your creative brief…</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <BriefRow icon={<Wand2 size={11} />} label="Theme"><span className="line-clamp-2">{theme}</span></BriefRow>
                  <BriefRow icon={<Users size={11} />} label="Audience">{PLATFORM_AUDIENCE[platform]}</BriefRow>
                  <BriefRow icon={<Heart size={11} />} label="Emotional journey">{journey.length ? journey.join(" → ") : <Soon />}</BriefRow>
                  <BriefRow icon={<MessageSquareQuote size={11} />} label="Primary message"><span className="line-clamp-2">{primaryMessage || <Soon />}</span></BriefRow>
                  <BriefRow icon={<Film size={11} />} label="Visual style">{visualStyleStr}</BriefRow>
                  <BriefRow icon={<Target size={11} />} label="Expected reaction"><span className="line-clamp-2">{expectedReaction}</span></BriefRow>
                </div>
              )}
            </div>

            {/* ── P2: Premium Scene Cards (always open) ── */}
            <Section open={openSec["story"] ?? true} onToggle={() => toggle("story")} title="Scene-by-scene" icon={<Film size={11} />} hint={scenes.length ? `${scenes.length} scenes · ${totalDur}s` : "designing…"}>
              {scenes.length ? (
                <div className="space-y-1">
                  {scenes.map((s, i) => (
                    <div key={i}>
                      <div className="rounded-lg p-2.5 cs-fade" style={card}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-3xs font-bold text-cyan-300/90 rounded bg-cyan-400/10 px-1.5 py-0.5">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-2xs font-semibold text-white/90">{beatLabel(s.role)}</span>
                          <span className="text-3xs text-white/35">· {beatObjective(s.role)}</span>
                          <span className="ml-auto text-3xs text-white/40 inline-flex items-center gap-0.5"><Clock size={9} />{s.durationSec ?? 0}s</span>
                        </div>
                        {s.caption && <p className="text-3xs text-white/65 italic leading-snug">&ldquo;{s.caption}&rdquo;</p>}
                        <p className="text-3xs text-emerald-300/50 mt-1 inline-flex items-center gap-1"><Heart size={8} /> {beatEmotion(s.role)}</p>
                      </div>
                      {i < scenes.length - 1 && (
                        <div className="flex items-center justify-center gap-1 py-0.5">
                          <span className="h-2 w-px bg-white/15" />
                          <span className="text-3xs text-white/30">{transitionWord}</span>
                          <span className="h-2 w-px bg-white/15" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-2xs text-white/45 italic">Your scenes appear here once the story is composed.</p>}
            </Section>

            {/* ── Phase 1: AI Art Direction (open by default — the creative headline) ── */}
            <div className="mb-3 rounded-xl overflow-hidden cs-fade" style={{ border: "1px solid rgba(34,211,238,0.16)" }}>
              <div className="px-3.5 pt-3.5 pb-3" style={{ background: atmosphere }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles size={11} className="text-white" />
                  <span className="text-3xs uppercase tracking-wider font-semibold text-white/90">Art direction</span>
                  <span className="ml-auto text-3xs text-white/80">Confidence {estimating ? "…" : quality100}</span>
                </div>
                <p className="text-base font-bold text-white leading-none drop-shadow">{art.name}</p>
                <p className="text-2xs text-white/85 mt-1 max-w-xl leading-snug drop-shadow">{recommendation}</p>
              </div>
              <div className="px-3.5 py-2.5" style={card}>
                <p className="text-3xs text-white/55 mb-2">{platformRationale}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {directions.map((d) => (
                    <div key={d.tag} className="rounded-lg p-2"
                      style={d.live ? { background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.35)" } : { ...card, opacity: 0.7 }}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-3xs font-bold" style={{ color: d.live ? "#67e8f9" : "rgba(255,255,255,0.5)" }}>Direction {d.tag}</span>
                        {!d.live && <Lock size={8} className="text-white/35 ml-auto" />}
                      </div>
                      <p className="text-2xs font-medium text-white/85 leading-snug">{d.name}</p>
                      <p className="text-3xs mt-0.5" style={{ color: d.live ? "#5eead4" : "rgba(255,255,255,0.4)" }}>{d.live ? d.note : "Preview only · soon"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Phase 2: Creative moodboard — agency board (atmosphere + direction, not boxes) ── */}
            <Section open={!!openSec["mood"]} onToggle={() => toggle("mood")} title="Creative moodboard" icon={<PaletteIcon size={11} />} hint="the look & feel">
              {/* Atmosphere band — brand colour as light, not a swatch */}
              <div className="rounded-xl h-16 mb-2.5 relative overflow-hidden" style={{ background: atmosphere, border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="absolute inset-0 flex items-end justify-between px-3 pb-2">
                  <span className="text-3xs text-white/85 drop-shadow">Atmosphere · your palette as light</span>
                  <span className="flex items-center gap-1">
                    {pal.slice(0, 3).map((c, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ background: c, boxShadow: "0 0 0 1px rgba(255,255,255,0.25)" }} />)}
                  </span>
                </div>
              </div>
              {/* Direction lines — clean rows, no boxed cards */}
              <div className="divide-y divide-white/[0.04]">
                {board.map((b) => (
                  <div key={b.label} className="flex items-start gap-2.5 py-1.5">
                    <span className="text-cyan-300/60 mt-0.5 shrink-0">{b.icon}</span>
                    <span className="text-3xs uppercase tracking-wider text-white/40 font-semibold w-24 shrink-0 pt-0.5">{b.label}</span>
                    <span className="text-2xs text-white/75 leading-snug">{b.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-3xs text-white/30 mt-2">Brand colours guide the lighting, gradients &amp; accents — the final look is set during production.</p>
            </Section>

            {/* ── P6: AI Director Reasoning ── */}
            <Section open={!!openSec["reason"]} onToggle={() => toggle("reason")} title="Why the AI directed it this way" icon={<Sparkles size={11} className="text-cyan-400" />} hint="director's notes">
              <div className="space-y-2">
                {reasoning.map((r) => (
                  <div key={r.k} className="flex gap-2">
                    <span className="text-3xs font-bold text-cyan-300/80 uppercase tracking-wider w-16 shrink-0 pt-0.5">{r.k}</span>
                    <p className="text-2xs text-white/70 leading-snug">{r.v}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── P4: Why this will perform (replaces the bare quality number) ── */}
            <Section open={openSec["perform"] ?? true} onToggle={() => toggle("perform")} title="Why this will perform" icon={<Gauge size={11} />}
              hint={estimating ? "scoring…" : `Commercial Score ${quality100}`}>
              {scenes.length ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg font-bold tabular-nums" style={{ color: scoreColor(quality100) }}>{quality100}</span>
                    <span className="text-3xs text-white/40">Commercial Score · computed from your story, brand &amp; platform fit</span>
                  </div>
                  <div className="space-y-1">
                    {perfFactors.map((f) => (
                      <div key={f.k} className="flex items-start gap-1.5">
                        {f.ok ? <Check size={12} className="text-emerald-400 mt-0.5 shrink-0" /> : <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />}
                        <p className="text-2xs text-white/75"><span className="font-semibold text-white/85">{f.k}</span> <span className="text-white/50">— {f.detail}</span></p>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="text-2xs text-white/45 italic">Performance breakdown appears once the story is composed.</p>}
            </Section>

            {/* ── P5: Deliverables ── */}
            <Section open={!!openSec["deliver"]} onToggle={() => toggle("deliver")} title="What you'll receive" icon={<FileVideo size={11} />} hint={`${aspect} ${resolution} MP4`}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {deliverables.map((d) => (
                  <div key={d.label} className="flex items-center justify-between text-2xs">
                    <span className="text-white/55 flex items-center gap-1.5">{d.on ? <Check size={11} className="text-emerald-400" /> : <Lock size={9} className="text-white/30" />}{d.label}</span>
                    <span className="text-white/80">{d.value}</span>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Visual source (Sprint 14) — explicit, future-proof, honest ── */}
            <Section open={!!openSec["visual"]} onToggle={() => toggle("visual")} title="How should AI create your visuals?" icon={<Wand2 size={11} className="text-cyan-400" />} hint={VISUAL_SOURCES.find((s) => s.id === source)?.name ?? "AI Generated"}>
              {/* Recommendation (P3) */}
              <div className="rounded-lg px-2.5 py-2 mb-2.5 flex items-start gap-2" style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}>
                <Sparkles size={11} className="text-cyan-300 mt-0.5 shrink-0" />
                <p className="text-3xs text-white/70 leading-snug">
                  {rec.id === "ai" || recSource?.available
                    ? <>Recommended{brandIndustry ? <> for <span className="text-white/85">{brandIndustry}</span></> : null}: <span className="text-white/85">{recSource?.name ?? "AI Generated"}</span> — {rec.why}.</>
                    : <>For{brandIndustry ? <> <span className="text-white/85">{brandIndustry}</span></> : null}, <span className="text-white/85">{recSource?.name}</span> would be ideal — {rec.why} — but it&rsquo;s coming soon. For now, <span className="text-white/85">AI Generated</span> creates original, on-brand visuals.</>}
                </p>
              </div>

              {/* Source options (P1 explicit choice · P2 cost · P4 example styles) */}
              <div className="space-y-2">
                {VISUAL_SOURCES.map((s) => {
                  const active = source === s.id;
                  return (
                    <button key={s.id} type="button" disabled={!s.available} onClick={() => s.available && setSource(s.id)}
                      className="w-full text-left rounded-xl p-2.5 transition disabled:cursor-not-allowed"
                      style={{ background: active ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}`, opacity: s.available ? 1 : 0.6 }}>
                      <div className="flex items-start gap-2.5">
                        <ExampleChip kind={s.example} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-2xs font-semibold text-white/90">{s.id === "ai" ? "⭐ " : s.id === "pexels" ? "🎥 " : ""}{s.name}</span>
                            {s.recommended && <span className="text-3xs px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300">Recommended</span>}
                            {s.available
                              ? <span className="text-3xs text-cyan-300 ml-auto">{estimating ? "…" : money(estimate?.estimatedCostUsd)}</span>
                              : s.beta
                                ? <span className="text-3xs text-cyan-300/80 flex items-center gap-0.5 ml-auto"><Lock size={9} /> Beta · coming soon</span>
                                : <span className="text-3xs text-white/40 flex items-center gap-0.5 ml-auto"><Lock size={9} /> Coming soon</span>}
                          </div>
                          <p className="text-3xs text-white/55 leading-snug mt-0.5">{s.desc}</p>
                          {s.bestFor && <p className="text-3xs text-white/40 mt-1">Best for: {s.bestFor}</p>}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            {s.pros?.map((p) => <span key={p} className="text-3xs text-emerald-300/70">✓ {p}</span>)}
                            {s.cons?.map((c) => <span key={c} className="text-3xs text-white/35">• {c}</span>)}
                          </div>
                          {!s.available && <p className="text-3xs text-white/30 mt-1">{s.pricing ?? "Estimated pricing coming soon."}{s.note ? ` ${s.note}` : ""}</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Future-proof slots (P6) + example-asset disclaimer (P4) */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="text-3xs text-white/30">On the roadmap:</span>
                {FUTURE_SOURCES.map((f) => (
                  <span key={f.id} className="text-3xs px-2 py-0.5 rounded-full flex items-center gap-1" style={card}><Lock size={8} className="text-white/35" />{f.name}</span>
                ))}
              </div>
              <p className="text-3xs text-white/25 mt-1.5">Previews show example styles — not your generated assets.</p>
            </Section>

            <Section open={!!openSec["brand"]} onToggle={() => toggle("brand")} title="Brand" hint={`match ${estimating ? "…" : `${brand100}%`}`}>
              {/* Phase 3 — palette expressed as atmosphere, not swatches */}
              <div className="rounded-lg h-10 relative overflow-hidden mb-2" style={{ background: atmosphere, border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-2xs font-medium text-white/90 drop-shadow">{branding?.brandName ?? "Your brand"}</span>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {pal.slice(0, 3).map((c, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ background: c, boxShadow: "0 0 0 1px rgba(255,255,255,0.25)" }} />)}
                </span>
              </div>
              <p className="text-3xs text-white/45">{branding?.logoAssetId ? "Logo" : "Wordmark"} + CTA applied · colours guide lighting &amp; accents, not flat blocks.</p>
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
              <div className="rounded-xl p-3 cs-fade" style={card}>
                <p className={labelCls}>Commercial Score</p>
                <p className="text-xl font-bold tabular-nums" style={{ color: estimating ? "#64748b" : scoreColor(quality100) }}>{estimating ? "—" : quality100}</p>
                <p className="text-3xs text-white/35 mt-0.5">Story · brand · platform fit.</p>
              </div>
            </div>

            {error && <p className="text-2xs text-red-400 mb-3">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={approving}>Cancel</Button>
              <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5 cs-press hover:scale-[1.02] transition-transform" onClick={onGenerate}
                disabled={approving || estimating || !estimate}>
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