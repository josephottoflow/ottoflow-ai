"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Globe,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Clock,
  Target,
  Users,
  Mic,
  Layers,
  Key,
  Sparkles,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureFallback } from "@/lib/observability";
import { useSupabase } from "@/components/SupabaseProvider";
import type {
  DbBrand,
  DbBrandResearchJob,
  DbBrandTopic,
  DbCompetitor,
  DbKeyword,
  DbContentPillar,
  ResearchLogEntry,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AskResearch } from "@/components/AskResearch";
import { BrandAssets } from "@/components/BrandAssets";
import { BrandColors } from "@/components/BrandColors";
import { OpportunityFeed } from "@/components/OpportunityFeed";

interface Props {
  initialBrand: DbBrand;
  initialJob: DbBrandResearchJob | null;
  initialCompetitors: DbCompetitor[];
  initialKeywords: DbKeyword[];
  initialPillars: DbContentPillar[];
  initialTopics: DbBrandTopic[];
}

const STEP_LABEL: Record<string, string> = {
  queued: "Queued",
  fetching_site: "Fetching website",
  extracting_profile: "Extracting brand profile",
  finding_competitors: "Researching competitors",
  generating_seo: "Generating SEO + content pillars",
  generating_topics: "Generating content topics",
  finalizing: "Saving results",
};

export function BrandDetailClient({
  initialBrand,
  initialJob,
  initialCompetitors,
  initialKeywords,
  initialPillars,
  initialTopics,
}: Props) {
  const router = useRouter();
  const supabase = useSupabase();
  const [brand, setBrand] = useState(initialBrand);
  const [job, setJob] = useState(initialJob);
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [pillars, setPillars] = useState(initialPillars);
  const [topics, setTopics] = useState(initialTopics);
  const [topicsRegenerating, setTopicsRegenerating] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  // ─── Realtime subscriptions ─────────────────────────────────────────────────
  // Gated on `supabase` being ready (SupabaseProvider injects the Clerk JWT
  // BEFORE exposing the client — so by the time `supabase` is non-null we
  // have a Realtime-authenticated channel that RLS will honour).
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel(`brand:${brand.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "brand_research_jobs",
          filter: job ? `id=eq.${job.id}` : `brand_id=eq.${brand.id}`,
        },
        (payload) => {
          setJob(payload.new as DbBrandResearchJob);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "brands",
          filter: `id=eq.${brand.id}`,
        },
        (payload) => {
          setBrand(payload.new as DbBrand);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, brand.id, job?.id]);

  // ─── When job transitions to done, pull fresh related data ─────────────────
  useEffect(() => {
    if (job?.status !== "done" || !supabase) return;
    let cancelled = false;

    (async () => {
      const [comps, kws, plr, tpcs] = await Promise.all([
        supabase.from("competitors").select("*").eq("brand_id", brand.id),
        supabase
          .from("keywords")
          .select("*")
          .eq("brand_id", brand.id)
          .order("opportunity_score", { ascending: false, nullsFirst: false }),
        supabase
          .from("content_pillars")
          .select("*")
          .eq("brand_id", brand.id)
          .order("priority", { ascending: true }),
        supabase
          .from("brand_topics")
          .select("*")
          .eq("brand_id", brand.id)
          .eq("status", "draft")
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (comps.data) setCompetitors(comps.data as DbCompetitor[]);
      if (kws.data) setKeywords(kws.data as DbKeyword[]);
      if (plr.data) setPillars(plr.data as DbContentPillar[]);
      if (tpcs.data) setTopics(tpcs.data as DbBrandTopic[]);
      // Refresh server component data for navigation back/forward
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [job?.status, brand.id, router, supabase]);

  const isRunning = brand.status === "researching" || job?.status === "running" || job?.status === "queued";
  const isFailed = brand.status === "failed" || job?.status === "failed";
  const isReady = brand.status === "ready" && brand.profile;

  return (
    <div className="p-6 max-w-[1280px] mx-auto">
      <Link
        href="/brands"
        className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70 transition-colors mb-6"
      >
        <ArrowLeft size={12} />
        All brands
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-6">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(233,134,59,0.2), rgba(194,90,30,0.1))",
              border: "1px solid rgba(233,134,59,0.2)",
            }}
          >
            <Briefcase size={20} className="text-[#F2A863]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white tracking-tight truncate">
              {brand.name}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-white/45">
              {brand.industry && <span>{brand.industry}</span>}
              {brand.website && (
                <a
                  href={brand.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-white/70 transition-colors"
                >
                  <Globe size={11} />
                  {brand.website.replace(/^https?:\/\//, "")}
                  <ExternalLink size={9} />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Creative Intelligence — internal ops view of what the brand has learned. */}
          <Link
            href={`/brands/${brand.id}/intelligence`}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-white/55 hover:text-white/85 hover:border-white/20 transition-colors"
            title="Creative Intelligence — internal"
          >
            <Sparkles size={12} className="text-[#F2A863]" />
            Intelligence
          </Link>
          <StatusPill status={brand.status} />
        </div>
      </div>

      {/* Brand asset library (Creative Orchestrator Phase A) — independent of
          research state, so it renders for pending/researching brands too. */}
      <div className="mb-6">
        <BrandAssets brandId={brand.id} />
      </div>

      {/* Brand color palette (Creative Quality Phase 0B) — drives creative
          background / scrim / CTA so creatives render in the brand's colors. */}
      <div className="mb-6">
        <BrandColors brandId={brand.id} initial={brand.brand_colors} />
      </div>

      {/* Live progress card */}
      {isRunning && job && <ProgressCard job={job} />}

      {/* Failure card */}
      {isFailed && job && (
        <FailureCard
          brandId={brand.id}
          job={job}
          onRetried={() => {
            // The retry endpoint already mutated the DB; mirror that into
            // local state so the FailureCard branch unmounts immediately,
            // without waiting on Realtime + router.refresh + React reconcile.
            setBrand((prev) => ({ ...prev, status: "pending" }));
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    status: "queued",
                    current_step: "queued",
                    progress: 0,
                    error_message: null,
                    completed_at: null,
                  }
                : prev,
            );
          }}
        />
      )}

      {/* Ready: profile + competitors + keywords + pillars */}
      {isReady && brand.profile && (
        <div className="space-y-6">
          <ProfileSection brand={brand} />
          {/* V2 Phase 2A — grounded Q&A over the brand's evidence store */}
          <AskResearch brandId={brand.id} brandReady={!!isReady} />
          {/* V2 Phase 2C — evidence-mined content opportunities */}
          <OpportunityFeed
            brandId={brand.id}
            topics={topics}
            onNewIdeas={(ideas) => setTopics((prev) => [...ideas, ...prev])}
          />
          {competitors.length > 0 && <CompetitorsSection competitors={competitors} />}
          {keywords.length > 0 && <KeywordsSection keywords={keywords} />}
          {pillars.length > 0 && <PillarsSection pillars={pillars} />}
          {brand.profile && (
            <TopicsSection
              brandId={brand.id}
              topics={topics}
              isRegenerating={topicsRegenerating}
              regenerateError={topicsError}
              onRegenerate={async () => {
                setTopicsRegenerating(true);
                setTopicsError(null);
                try {
                  const res = await fetch(
                    `/api/brands/${brand.id}/topics/generate`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ replaceExisting: true }),
                    },
                  );
                  if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                      body.error ?? `Server returned ${res.status}`,
                    );
                  }
                  if (supabase) {
                    const { data } = await supabase
                      .from("brand_topics")
                      .select("*")
                      .eq("brand_id", brand.id)
                      .eq("status", "draft")
                      .order("created_at", { ascending: false });
                    if (data) setTopics(data as DbBrandTopic[]);
                  }
                } catch (err) {
                  const msg =
                    err instanceof Error ? err.message : String(err);
                  setTopicsError(msg);
                  captureFallback("brand.topics.client_regenerate_failed", err, {
                    brandId: brand.id,
                  });
                } finally {
                  setTopicsRegenerating(false);
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge variant="success" className="text-2xs gap-1.5 px-3 py-1">
        <CheckCircle2 size={11} />
        Ready
      </Badge>
    );
  }
  if (status === "researching") {
    return (
      <Badge variant="info" className="text-2xs gap-1.5 px-3 py-1">
        <Loader2 size={11} className="animate-spin" />
        Researching
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="text-2xs gap-1.5 px-3 py-1">
        <AlertTriangle size={11} />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-2xs gap-1.5 px-3 py-1">
      <Clock size={11} />
      Pending
    </Badge>
  );
}

function ProgressCard({ job }: { job: DbBrandResearchJob }) {
  const logs = job.logs ?? [];
  const stepLabel = STEP_LABEL[job.current_step ?? ""] ?? job.current_step ?? "Working…";

  return (
    <div className="glass rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-[#F2A863] animate-spin" />
          <p className="text-sm font-semibold text-white">{stepLabel}</p>
        </div>
        <span className="text-xs font-medium text-[#F2A863]">{job.progress}%</span>
      </div>
      <Progress value={job.progress} className="h-1.5 mb-4" />

      {/* Log stream */}
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
        {logs.length === 0 ? (
          <p className="text-xs text-white/35 italic">Waiting for worker to pick up the job…</p>
        ) : (
          [...logs].reverse().map((log, i) => <LogRow key={`${log.ts}-${i}`} log={log} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: ResearchLogEntry }) {
  const color =
    log.level === "error" ? "text-red-400"
    : log.level === "warn"    ? "text-amber-400"
    : log.level === "success" ? "text-emerald-400"
    :                           "text-white/55";
  const dot =
    log.level === "error" ? "bg-red-400"
    : log.level === "warn"    ? "bg-amber-400"
    : log.level === "success" ? "bg-emerald-400"
    :                           "bg-[#E9863B]";

  return (
    <div className="flex items-start gap-2 text-xs">
      <div className={`w-1 h-1 rounded-full ${dot} mt-1.5 flex-shrink-0`} />
      <span className="text-3xs text-white/30 font-mono mt-0.5 flex-shrink-0">
        {new Date(log.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className={color}>{log.message}</span>
    </div>
  );
}

function FailureCard({
  brandId,
  job,
  onRetried,
}: {
  brandId: string;
  job: DbBrandResearchJob;
  onRetried: () => void;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `Retry failed (HTTP ${res.status})`);
      }
      // Mirror the DB mutation into parent React state so the FailureCard
      // unmounts immediately. Realtime + router.refresh() take care of the
      // subsequent worker progress updates.
      onRetried();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      captureFallback("brands.retry.client_failed", err, { brandId });
      setRetryError(message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-300 mb-1">Research failed</h3>
          <p className="text-xs text-red-300/80 break-words mb-4">
            {job.error_message ?? "Unknown error. Check the worker logs."}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="border-red-500/30 text-red-300 hover:bg-red-500/10 gap-1.5"
            >
              {retrying ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              {retrying ? "Restarting…" : "Retry research"}
            </Button>
            {retryError && (
              <span className="text-2xs text-red-400/90">{retryError}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ brand }: { brand: DbBrand }) {
  const p = brand.profile!;
  return (
    <section className="glass rounded-2xl p-6">
      <SectionHeader icon={Target} label="Brand Profile" />

      <p className="text-sm text-white/75 leading-relaxed mb-4">{p.summary}</p>

      <div className="rounded-xl p-4 mb-5" style={{ background: "rgba(233,134,59,0.06)", border: "1px solid rgba(233,134,59,0.15)" }}>
        <p className="text-3xs uppercase tracking-widest text-[#F2A863]/70 font-semibold mb-1.5">
          Positioning
        </p>
        <p className="text-sm text-white/85 leading-relaxed italic">
          &ldquo;{p.positioning_statement}&rdquo;
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SubBlock title="Value Propositions" items={p.value_propositions} />
        <SubBlock title="Offers" items={p.offers} />
      </div>

      <Divider />

      <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold mb-3">
        Services
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {p.services.map((s, i) => (
          <div key={i} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-sm font-medium text-white/90">{s.name}</p>
            <p className="text-xs text-white/55 mt-1 leading-relaxed">{s.description}</p>
          </div>
        ))}
      </div>

      {p.products.length > 0 && (
        <>
          <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold mb-3">
            Products
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            {p.products.map((s, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="text-sm font-medium text-white/90">{s.name}</p>
                <p className="text-xs text-white/55 mt-1 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <Divider />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Mic size={12} className="text-[#F2A863]" />
            <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold">
              Brand Voice
            </h4>
          </div>
          <PillRow label="Tone" items={p.brand_voice.tone} />
          <PillRow label="Do" items={p.brand_voice.vocabulary_dos} muted />
          <PillRow label="Don't" items={p.brand_voice.vocabulary_donts} muted />
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Users size={12} className="text-[#F2A863]" />
            <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold">
              Audience &amp; ICP
            </h4>
          </div>
          <PillRow label="Demographics" items={p.audience.demographics} />
          <PillRow label="Psychographics" items={p.audience.psychographics} muted />
          <PillRow label="ICP industries" items={p.icp.industries} muted />
          <PillRow label="ICP roles" items={p.icp.roles} muted />
        </div>
      </div>

      {p.personas.length > 0 && (
        <>
          <Divider />
          <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold mb-3">
            Personas
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {p.personas.map((per, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <p className="text-sm font-semibold text-white">{per.name}</p>
                <p className="text-2xs text-[#F2A863]/80 mb-2">{per.role}</p>
                <PillRow label="Goals" items={per.goals} muted />
                <PillRow label="Pains" items={per.pain_points} muted />
                <PillRow label="Channels" items={per.channels} muted />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CompetitorsSection({ competitors }: { competitors: DbCompetitor[] }) {
  return (
    <section className="glass rounded-2xl p-6">
      <SectionHeader icon={Layers} label="Competitors" count={competitors.length} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {competitors.map((c) => (
          <div key={c.id} className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-start justify-between mb-1.5">
              <p className="text-sm font-semibold text-white">{c.name}</p>
              {c.website && (
                <a href={c.website} target="_blank" rel="noreferrer" className="text-white/35 hover:text-white/70 transition-colors">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            {c.summary && <p className="text-xs text-white/60 leading-relaxed mb-2">{c.summary}</p>}
            {c.positioning && (
              <p className="text-2xs text-[#F2A863]/70 italic mb-2">&ldquo;{c.positioning}&rdquo;</p>
            )}
            {c.strengths.length > 0 && <PillRow label="Strengths" items={c.strengths} muted />}
            {c.weaknesses.length > 0 && <PillRow label="Weaknesses" items={c.weaknesses} muted />}
          </div>
        ))}
      </div>
    </section>
  );
}

function KeywordsSection({ keywords }: { keywords: DbKeyword[] }) {
  return (
    <section className="glass rounded-2xl p-6">
      <SectionHeader icon={Key} label="Keywords" count={keywords.length} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-white/45 text-3xs uppercase tracking-wider">
            <tr className="border-b border-white/[0.05]">
              <th className="text-left font-semibold py-2 pr-3">Term</th>
              <th className="text-left font-semibold py-2 pr-3">Intent</th>
              <th className="text-right font-semibold py-2 pr-3">Relevance</th>
              <th className="text-right font-semibold py-2">Opportunity</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.id} className="border-b border-white/[0.03]">
                <td className="py-2 pr-3 text-white/85">{k.term}</td>
                <td className="py-2 pr-3 text-white/55">{k.intent ?? "—"}</td>
                <td className="py-2 pr-3 text-right text-white/65 font-mono">
                  {k.relevance_score?.toFixed(2) ?? "—"}
                </td>
                <td className="py-2 text-right font-mono">
                  <OpportunityBar score={k.opportunity_score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OpportunityBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-white/35">—</span>;
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? "bg-emerald-400" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <div className="w-16 h-1 rounded-full bg-white/8 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white/70 w-9 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

function PillarsSection({ pillars }: { pillars: DbContentPillar[] }) {
  return (
    <section className="glass rounded-2xl p-6">
      <SectionHeader icon={Sparkles} label="Content Pillars" count={pillars.length} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pillars.map((p) => (
          <div key={p.id} className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="purple" className="text-3xs">P{p.priority}</Badge>
              <p className="text-sm font-semibold text-white">{p.name}</p>
            </div>
            {p.description && <p className="text-xs text-white/60 leading-relaxed mb-2">{p.description}</p>}
            <PillRow label="Formats" items={p.content_types} />
            <PillRow label="Topics" items={p.example_topics} muted />
          </div>
        ))}
      </div>
    </section>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  educational: "Educational",
  storytelling: "Storytelling",
  ugc: "UGC",
  "product-demo": "Product Demo",
  listicle: "Listicle",
  "problem-solution": "Problem / Solution",
  "founder-story": "Founder Story",
};

const CATEGORY_BADGE_VARIANT: Record<
  string,
  "info" | "purple" | "success" | "warning" | "destructive"
> = {
  educational: "info",
  storytelling: "purple",
  ugc: "success",
  "product-demo": "warning",
  listicle: "info",
  "problem-solution": "destructive",
  "founder-story": "purple",
};

function TopicsSection({
  brandId,
  topics,
  isRegenerating,
  regenerateError,
  onRegenerate,
}: {
  brandId: string;
  topics: DbBrandTopic[];
  isRegenerating: boolean;
  regenerateError: string | null;
  onRegenerate: () => void;
}) {
  // Group by category for legibility — sparse categories render the empty state
  // with the section header so users see what's missing.
  const byCategory = topics.reduce<Record<string, DbBrandTopic[]>>((acc, t) => {
    const key = t.category ?? "uncategorized";
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#F2A863]" />
          <h2 className="text-sm font-bold text-white">Content Topics</h2>
          <span className="text-3xs text-white/40 font-medium">({topics.length})</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-7 text-2xs"
          onClick={onRegenerate}
          disabled={isRegenerating}
        >
          {isRegenerating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {topics.length === 0
            ? "Generate topics"
            : isRegenerating
              ? "Regenerating…"
              : "Regenerate"}
        </Button>
      </div>

      {regenerateError && (
        <div className="mb-3 rounded-md px-3 py-2 text-2xs text-rose-300/90 border border-rose-500/20 bg-rose-500/5">
          {regenerateError}
        </div>
      )}

      {topics.length === 0 && !isRegenerating && (
        <p className="text-xs text-white/40">
          No topics generated yet. Click <strong>Generate topics</strong> above
          to produce 40+ on-brand video ideas powered by the brand profile.
        </p>
      )}

      <div className="space-y-4">
        {Object.entries(byCategory).map(([cat, list]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant={CATEGORY_BADGE_VARIANT[cat] ?? "purple"}
                className="text-3xs uppercase"
              >
                {CATEGORY_LABEL[cat] ?? cat}
              </Badge>
              <span className="text-3xs text-white/40">{list.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {list.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg p-3 transition hover:bg-white/[0.04]"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <p className="text-sm font-semibold text-white leading-snug">
                    {t.title}
                  </p>
                  {t.hook_angle && (
                    <p className="text-2xs text-white/55 mt-1 leading-relaxed italic">
                      &ldquo;{t.hook_angle}&rdquo;
                    </p>
                  )}
                  {t.description && (
                    <p className="text-2xs text-white/45 mt-1 leading-relaxed line-clamp-2">
                      {t.description}
                    </p>
                  )}
                  {/* Per-idea entry points: turn the idea into a video or a
                      brand-voiced social post, both pre-aligned to this idea. */}
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/[0.04]">
                    <Link
                      href="/video/start"
                      className="text-3xs font-semibold text-[#F2A863] hover:underline"
                    >
                      Generate video →
                    </Link>
                    <Link
                      href={`/content/generate?brandId=${brandId}&topicId=${t.id}`}
                      className="text-3xs font-semibold text-[#F2A863] hover:underline"
                    >
                      Generate post →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Tiny shared bits ─────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Briefcase;
  label: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} className="text-[#F2A863]" />
      <h2 className="text-sm font-bold text-white">{label}</h2>
      {count != null && (
        <span className="text-3xs text-white/40 font-medium">({count})</span>
      )}
    </div>
  );
}

function SubBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs uppercase tracking-widest text-white/45 font-semibold mb-2">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-white/75 leading-relaxed flex gap-2">
            <span className="text-[#F2A863] mt-0.5">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PillRow({ label, items, muted = false }: { label: string; items: string[]; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span
            key={i}
            className={`text-3xs px-1.5 py-0.5 rounded-md ${
              muted
                ? "bg-white/[0.04] text-white/55"
                : "bg-[#E9863B]/10 text-[#F2A863] border border-[#E9863B]/15"
            }`}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-5 border-t border-white/[0.04]" />;
}
