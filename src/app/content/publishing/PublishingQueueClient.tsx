"use client";

/**
 * Publishing Queue (Publisher Foundation v1).
 *
 * Manual-first publishing: Copy content → Open platform → Mark published.
 * Scheduling sets a plan (v1 has no automation at the scheduled time — the
 * future API publisher executes plans; the UI says so honestly).
 *
 * Tabs: Approved (ready to ship) · Scheduled (planned) · Published (done).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  Copy,
  ExternalLink,
  CalendarClock,
  CalendarX2,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface PublishItem {
  id: string;
  brandName: string | null;
  platform: string;
  title: string;
  preview: string | null;
  body: string | null;
  status: string;
  hashtags: string[];
  scheduledFor: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  publishingMethod: string | null;
  createdAt: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X / Twitter",
  blog: "Blog",
  email: "Email",
};

/** Where "Open platform" goes. X gets an intent prefill with the post text. */
function platformComposeUrl(platform: string, body: string | null): string | null {
  switch (platform) {
    case "linkedin":
      return "https://www.linkedin.com/feed/?shareActive=true";
    case "twitter":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent((body ?? "").slice(0, 270))}`;
    case "facebook":
      return "https://www.facebook.com/";
    case "instagram":
      return "https://www.instagram.com/";
    default:
      return null; // blog/email — no compose surface
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

function ItemCard({
  item,
  onAction,
}: {
  item: PublishItem;
  onAction: (
    id: string,
    body: Record<string, unknown>,
  ) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [publishMode, setPublishMode] = useState(false);
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");

  const composeUrl = platformComposeUrl(item.platform, item.body);
  const overdue =
    item.status === "scheduled" &&
    !!item.scheduledFor &&
    new Date(item.scheduledFor).getTime() < Date.now();

  async function copyBody() {
    const text =
      (item.body ?? "") +
      (item.hashtags.length
        ? `\n\n${item.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`
        : "");
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onAction(item.id, body);
    setBusy(false);
    if (err) setError(err);
    else {
      setScheduleMode(false);
      setPublishMode(false);
      setWhen("");
      setUrl("");
    }
  }

  function submitSchedule() {
    if (!when) {
      setError("Pick a date and time first.");
      return;
    }
    const iso = new Date(when).toISOString();
    void run({ action: "schedule", scheduledFor: iso });
  }

  function submitPublished() {
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setError("Link must start with http(s):// — or leave it empty.");
      return;
    }
    void run({
      action: "mark_published",
      ...(trimmed ? { publishedUrl: trimmed } : {}),
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className="text-3xs">
              {PLATFORM_LABEL[item.platform] ?? item.platform}
            </Badge>
            {item.brandName && <span className="text-3xs text-white/35">{item.brandName}</span>}
            {item.status === "scheduled" && item.scheduledFor && (
              <span
                className={`text-3xs rounded-full border px-2 py-0.5 ${
                  overdue
                    ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
                    : "text-cyan-300 border-cyan-500/40 bg-cyan-500/10"
                }`}
              >
                {overdue ? "due " : "for "}
                {fmtDateTime(item.scheduledFor)}
              </span>
            )}
            {item.status === "published" && (
              <span className="text-3xs rounded-full border px-2 py-0.5 text-violet-300 border-violet-500/40 bg-violet-500/10">
                published {fmtDateTime(item.publishedAt)}
                {item.publishingMethod ? ` · ${item.publishingMethod}` : ""}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-white/90">{item.title}</p>
          {item.preview && <p className="text-xs text-white/45 mt-0.5">{item.preview}</p>}
          {item.status === "published" && item.publishedUrl && (
            <a
              href={item.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-2xs text-cyan-300 hover:text-cyan-200"
            >
              <ExternalLink size={10} />
              View live post
            </a>
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
        </div>
      )}

      {item.status !== "published" && (
        <div className="mt-3 border-t border-white/5 pt-3">
          {scheduleMode && (
            <div className="flex items-center gap-2 mb-2">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                aria-label="Schedule date and time"
                className="rounded-lg bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50 [color-scheme:dark]"
              />
              <Button size="sm" onClick={submitSchedule} disabled={busy} className="h-7 text-2xs">
                {busy ? <Loader2 size={11} className="animate-spin" /> : "Confirm schedule"}
              </Button>
              <button
                type="button"
                onClick={() => setScheduleMode(false)}
                className="text-2xs text-white/40 hover:text-white/70"
              >
                Cancel
              </button>
            </div>
          )}
          {publishMode && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Link to the live post (optional)"
                aria-label="Published post URL"
                className="flex-1 min-w-[220px] rounded-lg bg-white/[0.04] border border-white/10 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50"
              />
              <Button
                size="sm"
                onClick={submitPublished}
                disabled={busy}
                className="h-7 text-2xs bg-violet-600 hover:bg-violet-500"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : "Confirm published"}
              </Button>
              <button
                type="button"
                onClick={() => setPublishMode(false)}
                className="text-2xs text-white/40 hover:text-white/70"
              >
                Cancel
              </button>
            </div>
          )}
          {error && <p className="text-2xs text-red-400 mb-2">{error}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => void copyBody()} className="h-7 gap-1 text-2xs">
              <Copy size={11} />
              {copied ? "Copied" : "Copy content"}
            </Button>
            {composeUrl && (
              <a href={composeUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-2xs">
                  <ExternalLink size={11} />
                  Open {PLATFORM_LABEL[item.platform] ?? item.platform}
                </Button>
              </a>
            )}
            {item.status === "approved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setScheduleMode((v) => !v);
                  setPublishMode(false);
                  setError(null);
                }}
                className="h-7 gap-1 text-2xs"
              >
                <CalendarClock size={11} />
                Schedule
              </Button>
            )}
            {item.status === "scheduled" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void run({ action: "unschedule" })}
                disabled={busy}
                className="h-7 gap-1 text-2xs"
              >
                <CalendarX2 size={11} />
                Unschedule
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setPublishMode((v) => !v);
                setScheduleMode(false);
                setError(null);
              }}
              className="h-7 gap-1 text-2xs bg-violet-600 hover:bg-violet-500"
            >
              <CheckCheck size={11} />
              Mark published
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = ["approved", "scheduled", "published"] as const;
type Tab = (typeof TABS)[number];

export function PublishingQueueClient({ initialItems }: { initialItems: PublishItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("approved");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [items]);

  const visible = items
    .filter((i) => i.status === tab)
    .sort((a, b) => {
      if (tab === "scheduled") {
        return (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? "");
      }
      if (tab === "published") {
        return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

  async function onAction(
    id: string,
    body: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const res = await fetch(`/api/content/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return (data as { error?: string }).error ?? "Action failed";
      const next = data.item as {
        status: string;
        scheduled_for: string | null;
        published_at: string | null;
        published_url: string | null;
        publishing_method: string | null;
      };
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: next.status,
                scheduledFor: next.scheduled_for,
                publishedAt: next.published_at,
                publishedUrl: next.published_url,
                publishingMethod: next.publishing_method,
              }
            : i,
        ),
      );
      return null;
    } catch {
      return "Network error — try again.";
    }
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <Link
        href="/content/review"
        className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70 transition-colors mb-5"
      >
        <ArrowLeft size={12} />
        Review Queue
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <Send size={18} className="text-violet-400" />
        <h1 className="text-2xl font-bold text-white tracking-tight">Publishing</h1>
      </div>
      <p className="text-sm text-white/40 mb-6">
        Approved posts ready to ship. Copy the content, open the platform, post it, then mark
        it published. Scheduling sets the plan — v1 publishing is manual; platform APIs will
        automate these same steps later.
      </p>

      <div className="flex gap-1.5 mb-5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs capitalize transition-colors border ${
              tab === t
                ? "bg-violet-600/25 text-violet-200 border-violet-500/40"
                : "text-white/50 hover:text-white/75 border-white/10"
            }`}
          >
            {t} ({counts.get(t) ?? 0})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-white/40">
          {tab === "approved"
            ? "Nothing approved and unpublished — approve posts in the Review Queue and they appear here."
            : tab === "scheduled"
              ? "Nothing scheduled. Schedule an approved post to plan it."
              : "Nothing published yet."}
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
