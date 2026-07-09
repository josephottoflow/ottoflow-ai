"use client";

/**
 * Research Workspace (V2 Phase 2B) — explore the evidence corpus.
 *
 * Three tabs, all read-only over data loaded server-side:
 *   Evidence  — library (filter/search/sort over captured sources) + viewer
 *               (chunks, summary, entities, keywords, related evidence —
 *               chunk text + related fetched lazily per source).
 *   Timeline  — research_runs: what ran, what it collected, what it cost.
 *   Grounding — ideas / posts / videos → the evidence that grounds them.
 *
 * Filtering/search is client-side: per-brand evidence is a few hundred rows
 * (capped at 800 server-side) — instant UX, zero extra endpoints.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  FlaskConical,
  History,
  Link2,
  FileText,
  Lightbulb,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DbResearchRun } from "@/lib/types";
import type { EvidenceListRow, GroundedArtifact } from "@/lib/db-brands";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvidenceDoc {
  id: string;
  source_id: string | null;
  source_type: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  summary: string | null;
  entities: Record<string, string[]> | null;
  keywords: string[] | null;
  content: string;
  chunk_index: number;
  captured_at: string;
}

interface RelatedDoc {
  id: string;
  source_id: string | null;
  source_type: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  summary: string | null;
  content: string;
  captured_at: string;
  similarity: number;
}

/** One captured source = grouped chunks sharing source_id. */
interface SourceGroup {
  key: string;
  sourceId: string | null;
  sourceType: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  summary: string | null;
  entities: Record<string, string[]> | null;
  keywords: string[];
  capturedAt: string;
  chunkCount: number;
}

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

const ENTITY_LABEL: Record<string, string> = {
  organizations: "Organizations",
  people: "People",
  products: "Products",
  locations: "Locations",
};

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtCost(v: number | null): string {
  if (v == null) return "—";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

// ─── Evidence library grouping ───────────────────────────────────────────────

function groupSources(rows: EvidenceListRow[]): SourceGroup[] {
  const map = new Map<string, SourceGroup>();
  for (const r of rows) {
    const key = r.source_id ?? `solo:${r.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        sourceId: r.source_id,
        sourceType: r.source_type,
        url: r.url,
        domain: r.domain,
        title: r.title,
        summary: r.summary,
        entities: (r.entities as Record<string, string[]> | null) ?? null,
        keywords: r.keywords ?? [],
        capturedAt: r.captured_at,
        chunkCount: 1,
      });
    } else {
      existing.chunkCount++;
      existing.title = existing.title ?? r.title;
      existing.summary = existing.summary ?? r.summary;
      existing.entities =
        existing.entities ?? ((r.entities as Record<string, string[]> | null) ?? null);
      if (existing.keywords.length === 0 && r.keywords?.length) {
        existing.keywords = r.keywords;
      }
      if (r.captured_at > existing.capturedAt) existing.capturedAt = r.captured_at;
    }
  }
  return [...map.values()];
}

// ─── Source card + viewer ────────────────────────────────────────────────────

function SourceCard({ brandId, group }: { brandId: string; group: SourceGroup }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<EvidenceDoc[] | null>(null);
  const [related, setRelated] = useState<RelatedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || chunks !== null || loading || !group.sourceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brands/${brandId}/evidence?source=${encodeURIComponent(group.sourceId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed");
      setChunks((data.chunks ?? []) as EvidenceDoc[]);
      setRelated((data.related ?? []) as RelatedDoc[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }

  const entityGroups = Object.entries(group.entities ?? {}).filter(
    ([, v]) => Array.isArray(v) && v.length > 0,
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        <Badge variant="outline" className="text-3xs shrink-0">
          {SOURCE_TYPE_LABEL[group.sourceType] ?? group.sourceType}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/85 font-medium truncate">
            {group.title || group.domain || group.url || "Untitled source"}
          </p>
          <p className="text-3xs text-white/35 truncate">
            {group.domain ?? "no domain"} · {group.chunkCount}{" "}
            {group.chunkCount === 1 ? "chunk" : "chunks"} · captured {fmtDate(group.capturedAt)}
          </p>
        </div>
        {open ? (
          <ChevronUp size={15} className="text-white/40 shrink-0" />
        ) : (
          <ChevronDown size={15} className="text-white/40 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {group.summary && (
            <div>
              <p className="text-3xs uppercase tracking-wide text-white/35 mb-1">Summary</p>
              <p className="text-xs text-white/70 leading-relaxed">{group.summary}</p>
            </div>
          )}

          {entityGroups.length > 0 && (
            <div>
              <p className="text-3xs uppercase tracking-wide text-white/35 mb-1">Entities</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {entityGroups.map(([k, vals]) => (
                  <span key={k} className="text-2xs text-white/55">
                    <span className="text-white/30">{ENTITY_LABEL[k] ?? k}:</span>{" "}
                    {vals.slice(0, 6).join(", ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {group.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {group.keywords.slice(0, 10).map((kw) => (
                <span
                  key={kw}
                  className="text-3xs text-[#F2A863]/90 bg-[#E9863B]/10 border border-[#E9863B]/20 rounded-full px-2 py-0.5"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          {group.url && (
            <a
              href={group.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-2xs text-cyan-300 hover:text-cyan-200"
            >
              <ExternalLink size={11} />
              View original source
            </a>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 size={13} className="animate-spin" />
              Loading captured text…
            </div>
          )}
          {error && <p className="text-2xs text-red-400">{error}</p>}

          {chunks && chunks.length > 0 && (
            <div>
              <p className="text-3xs uppercase tracking-wide text-white/35 mb-1">
                Captured text ({chunks.length} {chunks.length === 1 ? "chunk" : "chunks"})
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {chunks.map((c) => (
                  <p
                    key={c.id}
                    className="text-xs text-white/60 whitespace-pre-wrap leading-relaxed bg-white/[0.02] rounded-lg p-2.5"
                  >
                    {c.content}
                  </p>
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div>
              <p className="text-3xs uppercase tracking-wide text-white/35 mb-1">
                Related evidence
              </p>
              <div className="space-y-1.5">
                {related.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-1.5"
                  >
                    <span className="text-3xs text-emerald-400/80 font-mono shrink-0">
                      {(r.similarity * 100).toFixed(0)}%
                    </span>
                    <span className="text-2xs text-white/65 truncate flex-1">
                      {r.title || r.domain || "Untitled"}
                      {r.summary ? ` — ${r.summary}` : ""}
                    </span>
                    <Badge variant="outline" className="text-3xs shrink-0">
                      {SOURCE_TYPE_LABEL[r.source_type] ?? r.source_type}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function TimelineTab({ runs }: { runs: DbResearchRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-white/40">
        No research runs recorded yet — runs are tracked from the evidence-layer
        release onward. Re-run research to see the first entry.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div key={run.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`text-3xs ${
                run.status === "done"
                  ? "text-emerald-400 border-emerald-500/30"
                  : run.status === "failed"
                    ? "text-red-400 border-red-500/30"
                    : "text-amber-400 border-amber-500/30"
              }`}
            >
              {run.status}
            </Badge>
            <span className="text-xs text-white/70 font-medium capitalize">{run.trigger}</span>
            <span className="text-3xs text-white/35">{fmtDate(run.started_at)}</span>
            {run.intelligence_version != null && (
              <Badge variant="outline" className="text-3xs text-[#F2A863] border-[#E9863B]/30">
                intelligence v{run.intelligence_version}
              </Badge>
            )}
            {run.duration_ms != null && (
              <span className="text-3xs text-white/35 ml-auto">
                {(run.duration_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
            <Stat label="Sources" value={String(run.sources_collected)} />
            <Stat label="Chunks" value={String(run.chunks_stored)} />
            <Stat label="Embedded" value={String(run.chunks_embedded)} />
            <Stat
              label="Tokens"
              value={`${(run.tokens_input / 1000).toFixed(1)}k in · ${(run.tokens_output / 1000).toFixed(1)}k out`}
            />
            <Stat label="Est. cost" value={fmtCost(run.cost_estimate_usd)} />
          </div>
          {run.error_message && (
            <p className="text-2xs text-red-400/80 mt-2 truncate">{run.error_message}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-3xs uppercase tracking-wide text-white/30">{label}</p>
      <p className="text-xs text-white/75 mt-0.5">{value}</p>
    </div>
  );
}

// ─── Grounding inspector ─────────────────────────────────────────────────────

const KIND_META: Record<GroundedArtifact["kind"], { label: string; icon: typeof Lightbulb }> = {
  idea: { label: "Idea", icon: Lightbulb },
  post: { label: "Post", icon: FileText },
  video: { label: "Video", icon: Video },
};

function GroundingRow({ brandId, artifact }: { brandId: string; artifact: GroundedArtifact }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<EvidenceDoc[] | null>(null);
  const Icon = KIND_META[artifact.kind].icon;
  const hasGrounding = artifact.grounded_on.length > 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || docs !== null || loading || !hasGrounding) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/brands/${brandId}/evidence?ids=${artifact.grounded_on.slice(0, 24).join(",")}`,
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
    <div
      className={`rounded-xl border ${hasGrounding ? "border-white/10 bg-white/[0.03]" : "border-white/5 opacity-50"}`}
    >
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={!hasGrounding}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-3 text-left disabled:cursor-default"
      >
        <Icon size={14} className="text-white/40 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/80 truncate">{artifact.label}</p>
          <p className="text-3xs text-white/35">
            {KIND_META[artifact.kind].label}
            {artifact.sublabel ? ` · ${artifact.sublabel}` : ""} · {fmtDate(artifact.created_at)}
          </p>
        </div>
        <span className="text-3xs text-white/40 shrink-0">
          {hasGrounding
            ? `${artifact.grounded_on.length} evidence`
            : "no grounding (pre-evidence)"}
        </span>
        {hasGrounding &&
          (open ? (
            <ChevronUp size={14} className="text-white/40 shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-white/40 shrink-0" />
          ))}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/5 pt-2 space-y-1.5">
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
                <span className="text-3xs text-white/30 shrink-0">{fmtDate(d.captured_at)}</span>
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

// ─── Main ────────────────────────────────────────────────────────────────────

type Tab = "evidence" | "timeline" | "grounding";

export function ResearchWorkspaceClient({
  brand,
  evidence,
  runs,
  artifacts,
}: {
  brand: { id: string; name: string };
  evidence: EvidenceListRow[];
  runs: DbResearchRun[];
  artifacts: GroundedArtifact[];
}) {
  const [tab, setTab] = useState<Tab>("evidence");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [oldestFirst, setOldestFirst] = useState(false);

  const groups = useMemo(() => groupSources(evidence), [evidence]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) m.set(g.sourceType, (m.get(g.sourceType) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [groups]);

  const domains = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) if (g.domain) m.set(g.domain, (m.get(g.domain) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [groups]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = groups.filter((g) => {
      if (typeFilter && g.sourceType !== typeFilter) return false;
      if (domainFilter && g.domain !== domainFilter) return false;
      if (q) {
        const hay = [g.title, g.summary, g.domain, g.url, ...(g.keywords ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) =>
      oldestFirst
        ? a.capturedAt.localeCompare(b.capturedAt)
        : b.capturedAt.localeCompare(a.capturedAt),
    );
  }, [groups, search, typeFilter, domainFilter, oldestFirst]);

  const groundedCount = artifacts.filter((a) => a.grounded_on.length > 0).length;

  const TABS: Array<{ key: Tab; label: string; icon: typeof FlaskConical }> = [
    { key: "evidence", label: `Evidence (${groups.length})`, icon: FlaskConical },
    { key: "timeline", label: `Timeline (${runs.length})`, icon: History },
    { key: "grounding", label: `Grounding (${groundedCount}/${artifacts.length})`, icon: Link2 },
  ];

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <Link
        href={`/brands/${brand.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70 transition-colors mb-5"
      >
        <ArrowLeft size={12} />
        {brand.name}
      </Link>

      <h1 className="text-2xl font-bold text-white tracking-tight">Research Workspace</h1>
      <p className="text-sm text-white/40 mt-1 mb-6">
        Everything the research engine has read, stored, and grounded for this brand.
      </p>

      <div className="flex gap-1.5 mb-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tab === key
                ? "bg-[#E9863B]/25 text-[#F5B77A] border border-[#E9863B]/40"
                : "text-white/50 hover:text-white/75 border border-white/10"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {tab === "evidence" && (
        <div>
          {groups.length === 0 ? (
            <p className="text-sm text-white/40">
              No evidence stored yet. Evidence accumulates automatically on every research
              run from the evidence-layer release onward — re-run research to populate this.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative flex-1 min-w-[220px]">
                  <Search
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search evidence…"
                    aria-label="Search evidence"
                    className="w-full rounded-lg bg-white/[0.04] border border-white/10 pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#E9863B]/50"
                  />
                </div>
                <select
                  value={domainFilter ?? ""}
                  onChange={(e) => setDomainFilter(e.target.value || null)}
                  aria-label="Filter by domain"
                  className="rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-2 text-xs text-white/70 focus:outline-none"
                >
                  <option value="">All domains</option>
                  {domains.map(([d, n]) => (
                    <option key={d} value={d}>
                      {d} ({n})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setOldestFirst((v) => !v)}
                  className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-white/50 hover:text-white/75"
                >
                  {oldestFirst ? "Oldest first" : "Newest first"}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                <FilterChip
                  active={typeFilter === null}
                  label={`All (${groups.length})`}
                  onClick={() => setTypeFilter(null)}
                />
                {typeCounts.map(([t, n]) => (
                  <FilterChip
                    key={t}
                    active={typeFilter === t}
                    label={`${SOURCE_TYPE_LABEL[t] ?? t} (${n})`}
                    onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                  />
                ))}
              </div>

              <div className="space-y-2">
                {visible.map((g) => (
                  <SourceCard key={g.key} brandId={brand.id} group={g} />
                ))}
                {visible.length === 0 && (
                  <p className="text-sm text-white/40">No evidence matches the filters.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "timeline" && <TimelineTab runs={runs} />}

      {tab === "grounding" && (
        <div className="space-y-2">
          {artifacts.length === 0 ? (
            <p className="text-sm text-white/40">No ideas or content yet for this brand.</p>
          ) : (
            artifacts.map((a) => (
              <GroundingRow key={`${a.kind}:${a.id}`} brandId={brand.id} artifact={a} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-2xs transition-colors border ${
        active
          ? "bg-[#E9863B]/25 text-[#F5B77A] border-[#E9863B]/40"
          : "text-white/45 hover:text-white/70 border-white/10"
      }`}
    >
      {label}
    </button>
  );
}
