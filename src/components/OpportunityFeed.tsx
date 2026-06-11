"use client";

/**
 * Opportunity Feed (V2 Phase 2C) — evidence-mined content opportunities,
 * highest composite confidence first.
 *
 * Each card explains itself: detection lens, score, the WHY (rationale
 * written against the evidence), and a drill-in to the exact supporting
 * evidence (existing /evidence?ids= endpoint — same data the Grounding
 * Inspector uses). Actions deep-link into the existing generators with the
 * idea pre-selected.
 */
import { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Flame,
  Repeat2,
  Swords,
  TrendingUp,
  FileText,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DbBrandTopic } from "@/lib/types";

interface EvidenceDoc {
  id: string;
  source_type: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  summary: string | null;
  content: string;
  captured_at: string;
}

const KIND_META: Record<
  string,
  { label: string; icon: typeof Flame; className: string }
> = {
  pain_point: {
    label: "Pain point",
    icon: Flame,
    className: "text-red-300 border-red-500/30 bg-red-500/10",
  },
  theme: {
    label: "Repeated theme",
    icon: Repeat2,
    className: "text-violet-300 border-violet-500/30 bg-violet-500/10",
  },
  competitor_gap: {
    label: "Competitor gap",
    icon: Swords,
    className: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  },
  trend: {
    label: "Emerging trend",
    icon: TrendingUp,
    className: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  },
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  website: "Website",
  search_result: "Google Search",
  competitor: "Competitor",
  industry: "Industry",
  keyword: "Keyword",
  social: "Social",
  news: "News",
  manual: "Manual",
};

function OpportunityCard({ brandId, idea }: { brandId: string; idea: DbBrandTopic }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<EvidenceDoc[] | null>(null);
  const kind = KIND_META[idea.opportunity_kind ?? "theme"] ?? KIND_META.theme;
  const KindIcon = kind.icon;
  const evidenceCount = idea.grounded_on?.length ?? 0;
  const pct = idea.confidence != null ? Math.round(idea.confidence * 100) : null;

  async function toggleEvidence() {
    const next = !open;
    setOpen(next);
    if (!next || docs !== null || loading || evidenceCount === 0) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/brands/${brandId}/evidence?ids=${idea.grounded_on.slice(0, 24).join(",")}`,
      );
      const data = await res.json();
      setDocs(res.ok ? ((data.docs ?? []) as EvidenceDoc[]) : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-3xs font-medium ${kind.className}`}
            >
              <KindIcon size={10} />
              {kind.label}
            </span>
            {idea.category && (
              <Badge variant="outline" className="text-3xs">
                {idea.category}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium text-white/90">{idea.title}</p>
          {idea.hook_angle && (
            <p className="text-xs text-white/45 italic mt-0.5">&ldquo;{idea.hook_angle}&rdquo;</p>
          )}
        </div>
        {pct != null && (
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-white leading-none">{pct}</p>
            <p className="text-3xs text-white/35 mt-0.5">score</p>
          </div>
        )}
      </div>

      {idea.rationale && (
        <p className="text-xs text-white/55 leading-relaxed mt-2">
          <span className="text-white/30">Why: </span>
          {idea.rationale}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => void toggleEvidence()}
          disabled={evidenceCount === 0}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-2xs text-white/45 hover:text-white/75 transition-colors disabled:opacity-40"
        >
          {evidenceCount} supporting {evidenceCount === 1 ? "source" : "sources"}
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <Link href={`/content/generate?brandId=${brandId}&topicId=${idea.id}`}>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-2xs">
              <FileText size={11} />
              Post
            </Button>
          </Link>
          <Link href={`/video/generate?brandId=${brandId}&topicId=${idea.id}`}>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-2xs">
              <Video size={11} />
              Video
            </Button>
          </Link>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 size={12} className="animate-spin" /> Loading evidence…
            </div>
          )}
          {docs?.map((d) => (
            <div key={d.id} className="rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-3xs shrink-0">
                  {SOURCE_TYPE_LABEL[d.source_type] ?? d.source_type}
                </Badge>
                <span className="text-2xs text-white/65 truncate flex-1">
                  {d.title || d.domain || "Untitled"}
                </span>
                <span className="text-3xs text-white/30 shrink-0">
                  {d.captured_at.slice(0, 10)}
                </span>
              </div>
              <p className="text-3xs text-white/45 mt-1 line-clamp-2">
                {d.summary ?? d.content.slice(0, 200)}
              </p>
            </div>
          ))}
          {docs && docs.length === 0 && !loading && (
            <p className="text-2xs text-white/35">Evidence rows no longer available.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function OpportunityFeed({
  brandId,
  topics,
  onNewIdeas,
}: {
  brandId: string;
  topics: DbBrandTopic[];
  onNewIdeas: (ideas: DbBrandTopic[]) => void;
}) {
  const [mining, setMining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<{ found: number; scanned: number } | null>(null);

  const mined = topics
    .filter((t) => t.source === "evidence-mined" && t.status !== "archived")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  async function mine() {
    if (mining) return;
    setMining(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/opportunities`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Mining failed — try again.");
        return;
      }
      const ideas = (data.ideas ?? []) as DbBrandTopic[];
      setLastScan({ found: ideas.length, scanned: (data.evidenceScanned as number) ?? 0 });
      onNewIdeas(ideas);
    } catch {
      setError("Network error — try again.");
    } finally {
      setMining(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-amber-400" />
        <h2 className="text-base font-semibold text-white">Content opportunities</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void mine()}
          disabled={mining}
          className="ml-auto gap-1.5 h-7 text-2xs"
        >
          {mining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {mined.length > 0 ? "Scan again" : "Find opportunities"}
        </Button>
      </div>
      <p className="text-xs text-white/40 mb-4">
        Mined from this brand&apos;s research evidence — every opportunity is scored, explained,
        and traceable to its sources.
      </p>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-400 mb-3" role="alert">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
      {mining && (
        <p className="text-xs text-white/40 mb-3">
          Scanning evidence through 4 lenses (pain points · themes · competitor gaps · trends)…
          this takes ~20-40 seconds.
        </p>
      )}
      {lastScan && !mining && (
        <p className="text-2xs text-white/35 mb-3">
          Last scan: {lastScan.found} grounded {lastScan.found === 1 ? "opportunity" : "opportunities"} from{" "}
          {lastScan.scanned} evidence sources.
        </p>
      )}

      {mined.length === 0 && !mining ? (
        <p className="text-sm text-white/40">
          No mined opportunities yet. Run a scan — ideas are generated only where the
          evidence supports them.
        </p>
      ) : (
        <div className="space-y-2.5">
          {mined.map((idea) => (
            <OpportunityCard key={idea.id} brandId={brandId} idea={idea} />
          ))}
        </div>
      )}
    </section>
  );
}
