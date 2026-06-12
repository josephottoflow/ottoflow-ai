"use client";

/**
 * Review Queue (V2 Phase 2, first slice).
 *
 * One place to move generated posts through the lifecycle:
 *   in_review → approve / reject / request revision (note required)
 * Tabs filter by status; actions are optimistic with server confirmation.
 * scheduled/published are display-only states reserved for the publisher.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Undo2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ClipboardCheck,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ReviewItem {
  id: string;
  brandName: string | null;
  platform: string;
  title: string;
  preview: string | null;
  body: string | null;
  status: string;
  hashtags: string[];
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  evidenceCount: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X / Twitter",
  blog: "Blog",
  email: "Email",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  in_review: { label: "In review", className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  draft: { label: "Draft", className: "text-white/50 border-white/15 bg-white/5" },
  approved: { label: "Approved", className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  rejected: { label: "Rejected", className: "text-red-300 border-red-500/40 bg-red-500/10" },
  scheduled: { label: "Scheduled", className: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10" },
  published: { label: "Published", className: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
};

const TABS = ["in_review", "draft", "approved", "rejected", "all"] as const;
type Tab = (typeof TABS)[number];

function ItemCard({
  item,
  onAction,
}: {
  item: ReviewItem;
  onAction: (id: string, action: "approve" | "reject" | "revise", note?: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [noteMode, setNoteMode] = useState<null | "reject" | "revise">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[item.status] ?? STATUS_META.draft;
  const actionable = item.status === "in_review" || item.status === "draft";

  async function run(action: "approve" | "reject" | "revise") {
    if (busy) return;
    if ((action === "revise" || action === "reject") && noteMode !== action) {
      setNoteMode(action);
      setError(null);
      return; // first click opens the note box; second click submits
    }
    if (action === "revise" && !note.trim()) {
      setError("Add a note — what should change?");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onAction(item.id, action, note.trim() || undefined);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setNoteMode(null);
      setNote("");
    }
  }

  async function copyBody() {
    if (!item.body) return;
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`rounded-full border px-2 py-0.5 text-3xs font-medium ${meta.className}`}>
              {meta.label}
            </span>
            <Badge variant="outline" className="text-3xs">
              {PLATFORM_LABEL[item.platform] ?? item.platform}
            </Badge>
            {item.brandName && (
              <span className="text-3xs text-white/35">{item.brandName}</span>
            )}
            <span className="text-3xs text-white/25">{item.createdAt.slice(0, 10)}</span>
            {item.evidenceCount > 0 && (
              <span className="text-3xs text-violet-300/70">
                {item.evidenceCount} evidence
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-white/90">{item.title}</p>
          {item.preview && <p className="text-xs text-white/45 mt-0.5">{item.preview}</p>}
          {item.reviewNote && (item.status === "draft" || item.status === "rejected") && (
            <p className="text-2xs text-amber-300/80 mt-1.5">
              <span className="text-white/30">
                {item.status === "draft" ? "Revision requested: " : "Rejected: "}
              </span>
              {item.reviewNote}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle full content"
          className="text-white/40 hover:text-white/70 shrink-0 mt-1"
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {open && item.body && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
            {item.body}
          </p>
          {item.hashtags.length > 0 && (
            <p className="text-2xs text-cyan-300/70 mt-2">
              {item.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
            </p>
          )}
          <button
            type="button"
            onClick={() => void copyBody()}
            className="inline-flex items-center gap-1 mt-2 text-2xs text-white/45 hover:text-white/75"
          >
            <Copy size={11} />
            {copied ? "Copied" : "Copy text"}
          </button>
        </div>
      )}

      {actionable && (
        <div className="mt-3 border-t border-white/5 pt-3">
          {noteMode && (
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                noteMode === "revise"
                  ? "What should change? (required)"
                  : "Why is this rejected? (optional)"
              }
              maxLength={1000}
              aria-label="Review note"
              className="w-full mb-2 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50"
            />
          )}
          {error && <p className="text-2xs text-red-400 mb-2">{error}</p>}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void run("approve")}
              disabled={busy}
              className="h-7 gap-1 text-2xs bg-emerald-600 hover:bg-emerald-500"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run("revise")}
              disabled={busy}
              className="h-7 gap-1 text-2xs"
            >
              <Undo2 size={11} />
              {noteMode === "revise" ? "Send revision request" : "Request revision"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run("reject")}
              disabled={busy}
              className="h-7 gap-1 text-2xs text-red-300 border-red-500/30 hover:bg-red-500/10"
            >
              <X size={11} />
              {noteMode === "reject" ? "Confirm reject" : "Reject"}
            </Button>
            {noteMode && (
              <button
                type="button"
                onClick={() => {
                  setNoteMode(null);
                  setNote("");
                  setError(null);
                }}
                className="text-2xs text-white/40 hover:text-white/70 ml-1"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewQueueClient({ initialItems }: { initialItems: ReviewItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("in_review");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [items]);

  const visible = items.filter((i) => (tab === "all" ? true : i.status === tab));

  async function onAction(
    id: string,
    action: "approve" | "reject" | "revise",
    note?: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`/api/content/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const data = await res.json();
      if (!res.ok) return (data as { error?: string }).error ?? "Action failed";
      const next = (data.item as { status: string; review_note: string | null }) ?? null;
      if (next) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, status: next.status, reviewNote: next.review_note }
              : i,
          ),
        );
      }
      return null;
    } catch {
      return "Network error — try again.";
    }
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <Link
        href="/content"
        className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70 transition-colors mb-5"
      >
        <ArrowLeft size={12} />
        Content Pipeline
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck size={18} className="text-emerald-400" />
        <h1 className="text-2xl font-bold text-white tracking-tight">Review Queue</h1>
        <Link
          href="/content/publishing"
          className="ml-auto inline-flex items-center gap-1 text-2xs text-white/45 hover:text-white/75 transition-colors"
        >
          Publishing
          <ArrowRight size={11} />
        </Link>
      </div>
      <p className="text-sm text-white/40 mb-6">
        Every generated post lands here. Approve it, reject it, or send it back with a note —
        approved posts are what publishing will pick up.
      </p>

      <div className="flex gap-1.5 mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors border ${
              tab === t
                ? "bg-violet-600/25 text-violet-200 border-violet-500/40"
                : "text-white/50 hover:text-white/75 border-white/10"
            }`}
          >
            {t === "all"
              ? `All (${items.length})`
              : `${STATUS_META[t]?.label ?? t} (${counts.get(t) ?? 0})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-white/40">
          {tab === "in_review"
            ? "Queue is clear — nothing awaiting review. Newly generated posts land here automatically."
            : "Nothing here yet."}
        </p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}
