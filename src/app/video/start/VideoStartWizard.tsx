"use client";

/**
 * VideoStartWizard — guided AI Creative Director entry (Sprint 12, presentation/flow only).
 *
 * Replaces the silent /video/start redirect with an explicit, guided journey:
 *   Step 1 Choose company → Step 2 Choose content → Step 3 Choose platform → AI Creative Studio.
 *
 * Everything is fed by data already loaded server-side (brands + content items +
 * which items are video-eligible). No new API, no schema change, no backend touched.
 * The Studio (VideoConfigModal) and the generate payload are unchanged; the wizard
 * only seeds brand / content / initial platform and opens it.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2, Sparkles, Search, ArrowRight, ArrowLeft, Check, Film,
  Clapperboard, Layers, Megaphone, Plus, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoConfigModal } from "@/components/VideoConfigModal";
import { PLATFORM_PROFILES, type Platform } from "@/lib/platform/profiles";

export interface WizardBrand {
  id: string; name: string; industry: string | null; logoUrl: string | null;
  colors: string[]; contentCount: number;
}
export interface WizardContent {
  id: string; brandId: string | null; platform: string; title: string;
  status: string; body: string | null; hashtags: string[]; eligible: boolean;
}

interface Props {
  brands: WizardBrand[];
  content: WizardContent[];
  preselectContentId?: string | null;
}

// The publishing platforms the wizard offers (each drives aspect/duration/safe-zones/
// CTA/scene-count/pacing/hook via PLATFORM_PROFILES — the source of truth).
const PLATFORM_CHOICES: Platform[] = [
  "linkedin", "tiktok", "instagram_reels", "instagram_feed", "facebook_reels", "youtube_shorts",
];
const aspectLabel = (a: string) => (a === "9:16" ? "Vertical" : a === "1:1" ? "Square" : "Landscape");

const card = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" } as const;
const cardActive = { background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.45)" } as const;

export function VideoStartWizard({ brands, content, preselectContentId }: Props) {
  // Preselect path: entered from a content item → jump to platform.
  const pre = preselectContentId ? content.find((c) => c.id === preselectContentId) : undefined;
  const soloBrand = brands.length === 1 ? brands[0] : undefined;

  const [brandId, setBrandId] = useState<string | null>(pre?.brandId ?? soloBrand?.id ?? null);
  const [contentId, setContentId] = useState<string | null>(pre?.id ?? null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);

  // Derived step (never lets the user wonder what's next).
  const step: 1 | 2 | 3 = !brandId ? 1 : !contentId ? 2 : 3;

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const selectedContent = content.find((c) => c.id === contentId) ?? null;

  const brandContent = useMemo(
    () => content.filter((c) => c.brandId === brandId),
    [content, brandId],
  );
  const contentPlatforms = useMemo(
    () => Array.from(new Set(brandContent.map((c) => c.platform))).sort(),
    [brandContent],
  );
  const filteredContent = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brandContent.filter((c) => {
      if (platformFilter && c.platform !== platformFilter) return false;
      if (q && !c.title.toLowerCase().includes(q) && !(c.body ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [brandContent, search, platformFilter]);

  function pickBrand(id: string) { setBrandId(id); setContentId(null); setPlatform(null); }
  function pickContent(id: string) { setContentId(id); setPlatform(null); }

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header + stepper */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          <h1 className="text-xl font-bold">Create a video</h1>
          <span className="ml-auto text-2xs text-white/40">AI Creative Director</span>
        </div>

        <Stepper step={step} />

        {/* ── STEP 1 — Choose company ── */}
        {step === 1 && (
          <section className="space-y-4">
            <StepIntro
              n={1} title="Choose the company you're creating for"
              hint="We'll load its brand, logo, colors, voice, and content so every video is on-brand." />
            {brands.length === 0 ? (
              <EmptyState
                icon={<Building2 size={26} className="text-cyan-300" />}
                title="No companies yet"
                body="A company holds your brand — its voice, logo, colors, and the content you turn into videos. Add one to get started."
                ctaHref="/brands" ctaLabel="Add a company" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {brands.map((b) => (
                  <button key={b.id} type="button" onClick={() => pickBrand(b.id)}
                    className="text-left rounded-2xl p-4 transition-colors hover:border-white/15"
                    style={brandId === b.id ? cardActive : card}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {b.logoUrl ? <img src={b.logoUrl} alt="" className="w-full h-full object-cover" />
                          : <Building2 size={18} className="text-white/40" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{b.name}</p>
                        <p className="text-2xs text-white/45 truncate">{b.industry ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {b.colors.slice(0, 4).map((c, i) => (
                          <span key={i} className="w-4 h-4 rounded-full border border-white/15" style={{ background: c }} />
                        ))}
                        {b.colors.length === 0 && <span className="text-3xs text-white/30">no colors yet</span>}
                      </div>
                      <span className="text-2xs text-white/45">{b.contentCount} item{b.contentCount === 1 ? "" : "s"}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── STEP 2 — Choose content ── */}
        {step === 2 && brand && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <StepIntro
                n={2} title={`Select the content to transform for ${brand.name}`}
                hint="Pick the post or story you'd like turned into a video. Our AI builds the storyboard from it." />
              {brands.length > 1 && (
                <button type="button" onClick={() => setBrandId(null)}
                  className="text-2xs text-white/50 hover:text-white flex items-center gap-1">
                  <ArrowLeft size={12} /> Change company
                </button>
              )}
            </div>

            {brandContent.length === 0 ? (
              <EmptyState
                icon={<Layers size={26} className="text-cyan-300" />}
                title="No content for this company yet"
                body="Videos are built from your existing posts. Generate a post first, then come back to turn it into a video."
                ctaHref="/content/generate" ctaLabel="Generate content" />
            ) : (
              <>
                {/* Search + platform filter */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search content…"
                      className="w-full rounded-lg bg-white/[0.03] border border-white/10 text-xs text-white/90 pl-8 pr-3 py-2 focus:outline-none focus:border-cyan-400/50" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <FilterChip active={platformFilter === null} onClick={() => setPlatformFilter(null)}>All</FilterChip>
                    {contentPlatforms.map((p) => (
                      <FilterChip key={p} active={platformFilter === p} onClick={() => setPlatformFilter(p)}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </FilterChip>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {filteredContent.map((c) => {
                    const active = contentId === c.id;
                    return (
                      <button key={c.id} type="button" disabled={!c.eligible} onClick={() => c.eligible && pickContent(c.id)}
                        title={c.eligible ? undefined : "This post needs an approved creative brief before it can become a video."}
                        className="text-left rounded-xl p-3 transition-colors disabled:cursor-not-allowed"
                        style={{ ...(active ? cardActive : card), opacity: c.eligible ? 1 : 0.5 }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-3xs uppercase tracking-wider text-white/40">{c.platform}</span>
                          <span className="text-3xs text-white/30">· {c.status}</span>
                          {active && <Check size={13} className="text-cyan-300 ml-auto" />}
                          {!c.eligible && <span className="ml-auto text-3xs text-white/40 flex items-center gap-0.5"><Lock size={9} /> needs brief</span>}
                        </div>
                        <p className="text-sm font-medium text-white/90 line-clamp-2 leading-snug">{c.title}</p>
                      </button>
                    );
                  })}
                  {filteredContent.length === 0 && (
                    <p className="text-2xs text-white/40 col-span-full py-6 text-center">No content matches your search.</p>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── STEP 3 — Choose platform ── */}
        {step === 3 && brand && selectedContent && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <StepIntro
                n={3} title="Where will you publish this?"
                hint="The platform sets the format — aspect ratio, length, pacing, captions, and call-to-action are tuned automatically." />
              <button type="button" onClick={() => setContentId(null)}
                className="text-2xs text-white/50 hover:text-white flex items-center gap-1">
                <ArrowLeft size={12} /> Change content
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PLATFORM_CHOICES.map((p) => {
                const prof = PLATFORM_PROFILES[p];
                const [lo, hi] = prof.video.targetDurationSec;
                const [smin, smax] = prof.video.sceneCount;
                const active = platform === p;
                return (
                  <button key={p} type="button" onClick={() => setPlatform(p)}
                    className="text-left rounded-2xl p-4 transition-colors hover:border-white/15"
                    style={active ? cardActive : card}>
                    <div className="flex items-center gap-2 mb-2">
                      <Megaphone size={14} className="text-cyan-300/80" />
                      <p className="text-sm font-semibold text-white">{prof.label}</p>
                      {active && <Check size={14} className="text-cyan-300 ml-auto" />}
                    </div>
                    <div className="space-y-0.5 text-2xs text-white/55">
                      <p>{prof.video.aspect} · {aspectLabel(prof.video.aspect)}</p>
                      <p>{lo}–{hi}s · {smin}–{smax} scenes</p>
                      <p className="capitalize">{prof.story.pacing} pace · hook by {prof.story.hookBySec}s</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl p-3 flex items-center gap-2.5" style={card}>
              <Clapperboard size={15} className="text-cyan-300 shrink-0" />
              <p className="text-2xs text-white/60">
                Next: our AI builds the storyboard for <span className="text-white/80">{selectedContent.title}</span>
                {platform ? <> on <span className="text-white/80">{PLATFORM_PROFILES[platform].label}</span></> : null}. You review everything before anything renders.
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="button" variant="gradient-cyan" size="sm" className="gap-1.5"
                disabled={!platform} onClick={() => setStudioOpen(true)}>
                Open AI Creative Studio <ArrowRight size={14} />
              </Button>
            </div>
          </section>
        )}
      </div>

      {/* The Studio — seeded with the wizard's choices. Unchanged generate flow. */}
      {brand && selectedContent && platform && (
        <VideoConfigModal
          open={studioOpen}
          brandId={brand.id}
          contentItemId={selectedContent.id}
          contentTitle={selectedContent.title}
          contentBody={selectedContent.body}
          contentHashtags={selectedContent.hashtags}
          initialPlatform={platform}
          brandIndustry={brand.industry}
          onClose={() => setStudioOpen(false)}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Company", "Content", "Platform"] as const;
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = n < step ? "done" : n === step ? "active" : "pending";
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-3xs font-bold"
                style={{
                  background: state === "done" ? "rgba(34,197,94,0.15)" : state === "active" ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: state === "done" ? "#4ade80" : state === "active" ? "#67e8f9" : "rgba(255,255,255,0.4)",
                }}>
                {state === "done" ? <Check size={12} /> : n}
              </span>
              <span className={`text-2xs ${n <= step ? "text-white/70" : "text-white/30"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <span className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />}
          </div>
        );
      })}
    </div>
  );
}

function StepIntro({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div>
      <p className="text-3xs uppercase tracking-wider text-cyan-300/70 font-semibold mb-1">Step {n}</p>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="text-2xs text-white/50 mt-0.5 max-w-2xl">{hint}</p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-2xs rounded-full px-3 py-1 transition-colors ${
        active ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
          : "bg-white/[0.03] text-white/55 border border-white/[0.06] hover:border-white/15"}`}>
      {children}
    </button>
  );
}

function EmptyState({ icon, title, body, ctaHref, ctaLabel }: {
  icon: React.ReactNode; title: string; body: string; ctaHref: string; ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl px-6 py-14 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.10)" }}>
      <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.15), rgba(129,140,248,0.15))", border: "1px solid rgba(34,211,238,0.22)" }}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-white mb-1">{title}</p>
      <p className="text-xs text-white/50 max-w-sm mx-auto leading-relaxed mb-5">{body}</p>
      <Link href={ctaHref}>
        <Button variant="gradient-cyan" size="sm" className="gap-1.5"><Plus size={13} /> {ctaLabel}</Button>
      </Link>
    </div>
  );
}
