"use client";

/**
 * Campaign Library (Campaign Workspace V1) — the operator's mission-control index.
 * Client-side search / filter / sort / favorite / archive over the campaigns the
 * server loaded. Filtering + sorting reuse the pure helpers in db-campaigns.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Star, Archive, SlidersHorizontal } from "lucide-react";
import type { DbCampaign } from "@/lib/types";
import {
  filterCampaigns,
  sortCampaigns,
  campaignDisplayName,
  type CampaignFilter,
  type CampaignSort,
} from "@/lib/db-campaigns";

const STATUS_TONE: Record<string, string> = {
  planning: "bg-white/[0.06] text-white/50",
  research: "bg-violet-500/[0.12] text-violet-300",
  in_progress: "bg-amber-500/[0.1] text-amber-300",
  generating: "bg-amber-500/[0.1] text-amber-300",
  review: "bg-cyan-500/[0.1] text-cyan-300",
  ready: "bg-emerald-500/[0.1] text-emerald-300",
  scheduled: "bg-sky-500/[0.12] text-sky-300",
  live: "bg-emerald-500/[0.14] text-emerald-300",
  completed: "bg-emerald-500/[0.1] text-emerald-300",
  archived: "bg-white/[0.04] text-white/35",
  failed: "bg-rose-500/[0.1] text-rose-300",
};

const STATUS_OPTIONS = [
  "all", "planning", "research", "in_progress", "review", "scheduled", "live", "completed",
] as const;

const SORTS: { id: CampaignSort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "created", label: "Newest" },
  { id: "name", label: "Name A–Z" },
  { id: "priority", label: "Priority" },
  { id: "status", label: "Status" },
];

function label(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function CampaignLibrary({ initial }: { initial: DbCampaign[] }) {
  const [rows, setRows] = useState<DbCampaign[]>(initial);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CampaignFilter["status"]>("all");
  const [sort, setSort] = useState<CampaignSort>("recent");
  const [favorite, setFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    const filtered = filterCampaigns(rows, { q, status, favorite, archived });
    return sortCampaigns(filtered, sort);
  }, [rows, q, status, favorite, archived, sort]);

  const activeCount = useMemo(() => rows.filter((c) => !(c.is_archived ?? false)).length, [rows]);

  async function patch(id: string, body: Partial<DbCampaign>) {
    // Optimistic — reflect immediately, then persist.
    setRows((prev) => prev.map((c) => (c.id === id ? { ...c, ...body } : c)));
    startTransition(async () => {
      try {
        await fetch(`/api/campaigns/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* best-effort; a refresh reconciles */
      }
    });
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search campaigns…"
            className="w-full glass rounded-xl pl-9 pr-3 py-2 text-sm text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#F2A863]/40"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CampaignFilter["status"])}
          className="glass rounded-xl px-3 py-2 text-sm text-white/70 focus:outline-none"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-neutral-900">
              {s === "all" ? "All statuses" : label(s)}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CampaignSort)}
          className="glass rounded-xl px-3 py-2 text-sm text-white/70 focus:outline-none"
          aria-label="Sort"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id} className="bg-neutral-900">
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setFavorite((v) => !v)}
          className={`glass rounded-xl px-3 py-2 text-sm flex items-center gap-1.5 ${favorite ? "text-[#F2A863]" : "text-white/55"}`}
          title="Favorites only"
        >
          <Star size={14} className={favorite ? "fill-[#F2A863]" : ""} /> Favorites
        </button>
        <button
          onClick={() => setArchived((v) => !v)}
          className={`glass rounded-xl px-3 py-2 text-sm flex items-center gap-1.5 ${archived ? "text-white/80" : "text-white/45"}`}
          title="Show archived"
        >
          <Archive size={14} /> Archived
        </button>
      </div>

      <p className="text-3xs uppercase tracking-wider text-white/30 mb-3 flex items-center gap-1.5">
        <SlidersHorizontal size={11} />
        {visible.length} of {archived ? rows.length : activeCount} campaign{visible.length === 1 ? "" : "s"}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-white/40">No campaigns match your filters.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map((c) => (
            <li key={c.id} className="glass card-hover rounded-2xl p-4 flex items-start gap-3 relative">
              <span
                className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: c.color || "#F2A863" }}
                aria-hidden
              />
              <Link href={`/campaigns/${c.id}`} className="min-w-0 flex-1 block">
                <p className="text-sm font-medium text-white/85 truncate pr-6">{campaignDisplayName(c)}</p>
                <p className="text-xs text-white/40 truncate mt-0.5">
                  {(c.channels && c.channels.length ? c.channels.join(" · ") : c.platform)}
                  {" · "}
                  {c.asset_count} asset{c.asset_count === 1 ? "" : "s"}
                </p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span
                    className={`text-3xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_TONE[c.status] ?? STATUS_TONE.planning}`}
                  >
                    {label(c.status)}
                  </span>
                  {(c.priority === "high" || c.priority === "urgent") && (
                    <span className="text-3xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/[0.1] text-rose-300">
                      {c.priority}
                    </span>
                  )}
                  {(c.tags ?? []).slice(0, 2).map((t) => (
                    <span key={t} className="text-3xs px-2 py-0.5 rounded-full bg-white/[0.05] text-white/45">
                      #{t}
                    </span>
                  ))}
                </div>
              </Link>
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => patch(c.id, { is_favorite: !(c.is_favorite ?? false) })}
                  title={c.is_favorite ? "Unfavorite" : "Favorite"}
                  className="text-white/30 hover:text-[#F2A863] transition-colors"
                >
                  <Star size={15} className={c.is_favorite ? "fill-[#F2A863] text-[#F2A863]" : ""} />
                </button>
                <button
                  onClick={() => patch(c.id, { is_archived: !(c.is_archived ?? false) })}
                  title={c.is_archived ? "Unarchive" : "Archive"}
                  className="text-white/25 hover:text-white/70 transition-colors"
                >
                  <Archive size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
