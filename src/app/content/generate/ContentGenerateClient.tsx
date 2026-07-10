"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Linkedin,
  Facebook,
  Globe,
  Twitter,
  BookOpen,
  Mail,
  Copy,
  Check,
  Briefcase,
  Wand2,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CreativePanel } from "@/components/CreativePanel";
import { PromptStudio } from "@/components/PromptStudio";
import { useSupabase } from "@/components/SupabaseProvider";
import { captureFallback } from "@/lib/observability";
import type { DbBrandTopic } from "@/lib/types";

interface ReadyBrand {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
}

type Platform = "linkedin" | "facebook" | "instagram" | "twitter" | "blog" | "email";

const PLATFORMS: Array<{
  id: Platform;
  label: string;
  hint: string;
  icon: typeof Linkedin;
  color: string;
  bg: string;
}> = [
  { id: "linkedin", label: "LinkedIn", hint: "Pro post · 250-350 words", icon: Linkedin, color: "#0a66c2", bg: "rgba(10,102,194,0.12)" },
  { id: "twitter", label: "X / Twitter", hint: "240-280 chars · punchy", icon: Twitter, color: "#1da1f2", bg: "rgba(29,161,242,0.12)" },
  { id: "instagram", label: "Instagram", hint: "Caption + hashtags", icon: Globe, color: "#e1306c", bg: "rgba(225,48,108,0.12)" },
  { id: "facebook", label: "Facebook", hint: "Story-driven post", icon: Facebook, color: "#1877f2", bg: "rgba(24,119,242,0.12)" },
  { id: "blog", label: "Blog Article", hint: "500-700 words · markdown", icon: BookOpen, color: "#F2A863", bg: "rgba(233,134,59,0.12)" },
  { id: "email", label: "Email", hint: "Subject + body", icon: Mail, color: "#34d399", bg: "rgba(16,185,129,0.12)" },
];

const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p])) as Record<Platform, (typeof PLATFORMS)[number]>;

const STEP_LABEL: Record<string, string> = {
  queued: "Queued",
  preparing_prompt: "Loading brand context",
  generating: "Generating content",
  finalizing: "Saving",
  done: "Done",
  error: "Failed",
};

interface JobRow {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  current_step: string | null;
  progress: number;
  error_message: string | null;
}

interface ContentItemRow {
  id: string;
  title: string;
  preview: string | null;
  body: string | null;
  platform: string;
  engagement: { hashtags?: string[]; cta?: string | null } | null;
}

interface Generation {
  platform: Platform;
  contentItemId: string;
  contentJobId: string;
}

interface Props {
  readyBrands: ReadyBrand[];
  preselectBrandId: string | null;
  preselectTopicId: string | null;
}

// ─── Session persistence (P4/P8) ────────────────────────────────────────────
// The generate workspace keeps its results only in React state, so a refresh /
// navigation / new tab / tab-reopen loses the cards (the content + creatives
// still exist in the DB and on /content/[id]). We persist a lightweight pointer
// per generated post and rehydrate from the DB on mount — no new tables, no
// migration; content_items + content_creatives are the source of truth.
//
// NOTE: uses localStorage, NOT sessionStorage. The acceptance criteria require
// restoration across a NEW TAB and a reopened tab, plus a 7-day retention —
// sessionStorage is tab-scoped and cleared on tab close, so it cannot satisfy
// any of those. localStorage (same-origin, shared across tabs, persistent) is
// the correct store for the stated goals.
const SESSION_KEY = "ottoflow.generate.sessions.v1";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SavedSession {
  id: string; // content_item_id (the durable key; creative is fetched from it)
  platform: Platform;
  createdAt: number;
}

/** Read sessions, drop entries older than 7 days, newest first; writes back the pruned list. */
function readSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const now = Date.now();
    const all = (JSON.parse(raw) as SavedSession[])
      .filter((s) => s && s.id && typeof s.createdAt === "number" && now - s.createdAt < SESSION_TTL_MS)
      .sort((a, b) => b.createdAt - a.createdAt);
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(all));
    return all;
  } catch {
    return [];
  }
}

/** Merge new entries (newest wins), prune >7d, cap, persist. */
function persistSessions(entries: SavedSession[]): void {
  if (typeof window === "undefined") return;
  try {
    const byId = new Map<string, SavedSession>();
    for (const s of [...entries, ...readSessions()]) byId.set(s.id, s);
    const merged = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
  } catch {
    /* sessionStorage quota / disabled — non-fatal */
  }
}

/** Drop sessions whose content item no longer exists (deleted). */
function pruneSessions(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  try {
    const keep = readSessions().filter((s) => !ids.includes(s.id));
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(keep));
  } catch {
    /* non-fatal */
  }
}

export function ContentGenerateClient({
  readyBrands,
  preselectBrandId,
  preselectTopicId,
}: Props) {
  const supabase = useSupabase();

  const [brandId, setBrandId] = useState<string>(
    (preselectBrandId && readyBrands.some((b) => b.id === preselectBrandId)
      ? preselectBrandId
      : readyBrands[0]?.id) ?? "",
  );

  // ─── Researched ideas (brand_topics) ────────────────────────────────────────
  const [topics, setTopics] = useState<DbBrandTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(preselectTopicId);
  const [topicSearch, setTopicSearch] = useState("");

  // ─── Platforms (multi-select) ───────────────────────────────────────────────
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set<Platform>(["linkedin"]));
  const [userPrompt, setUserPrompt] = useState("");
  // Branding overrides for the eventual creative (Creative Orchestrator).
  const [companyName, setCompanyName] = useState("");
  const [founderName, setFounderName] = useState("");
  const [expertName, setExpertName] = useState("");
  const [useLogo, setUseLogo] = useState(true);
  const [useHeadshot, setUseHeadshot] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // After submit — one generation per platform.
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobRow>>({});
  const [items, setItems] = useState<Record<string, ContentItemRow>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // True when the current results view was restored from sessionStorage (a
  // "Recent Generated Content" view) rather than an active generation.
  const [rehydrated, setRehydrated] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const selectedBrand = readyBrands.find((b) => b.id === brandId) ?? null;
  const selectedTopic = topics.find((t) => t.id === selectedTopicId) ?? null;

  // ─── Fetch the brand's researched ideas when the brand changes ──────────────
  useEffect(() => {
    if (!supabase || !brandId) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    setTopicsLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("brand_topics")
        .select("*")
        .eq("brand_id", brandId)
        .in("status", ["draft", "used"])
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        captureFallback("content.generate.topic_fetch_failed", error, { brandId });
        setTopics([]);
      } else {
        setTopics((data ?? []) as DbBrandTopic[]);
      }
      setTopicsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, brandId]);

  const togglePlatform = (id: Platform) => {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id); // keep at least one
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ─── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting || !brandId || platforms.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    startedAtRef.current = Date.now();
    const platformList = PLATFORMS.map((p) => p.id).filter((id) => platforms.has(id));
    try {
      const res = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platforms: platformList,
          topicId: selectedTopicId ?? undefined,
          userPrompt: userPrompt.trim() || undefined,
          branding: {
            companyName: companyName.trim() || undefined,
            founderName: founderName.trim() || undefined,
            expertName: expertName.trim() || undefined,
            useLogo,
            useHeadshot,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const gens: Generation[] = data.generations ?? [];
      setRehydrated(false);
      setGenerations(gens);
      // Persist a pointer per generated post so the workspace survives refresh.
      persistSessions(
        gens.map((g) => ({ id: g.contentItemId, platform: g.platform, createdAt: Date.now() })),
      );
      // Optimistic placeholders so each card shows progress immediately.
      const j: Record<string, JobRow> = {};
      for (const g of gens) {
        j[g.contentJobId] = {
          id: g.contentJobId,
          status: "queued",
          current_step: "queued",
          progress: 0,
          error_message: null,
        };
      }
      setJobs(j);
      setItems({});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      captureFallback("content.generate.client_submit_failed", err, {
        brandId,
        platformCount: platformList.length,
        hasTopic: !!selectedTopicId,
      });
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, brandId, platforms, selectedTopicId, userPrompt, companyName, founderName, expertName, useLogo, useHeadshot]);

  // ─── Rehydrate the workspace from sessionStorage on mount ───────────────────
  // Restores "Recent Generated Content" (newest first) after refresh / reopen /
  // navigation. Pointers come from sessionStorage; the actual post + creative
  // state is re-fetched from the DB (content_items + content_creatives). The
  // per-card CreativePanel then restores the image (ready) or continues polling
  // (brief_ready/approved/generating).
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!supabase || rehydratedRef.current) return;
    rehydratedRef.current = true;
    const saved = readSessions();
    if (saved.length === 0) return;
    const gens: Generation[] = saved.map((s) => ({
      platform: s.platform,
      contentItemId: s.id,
      contentJobId: s.id, // synthetic: the post is already generated
    }));
    const doneJobs: Record<string, JobRow> = {};
    for (const s of saved) {
      doneJobs[s.id] = { id: s.id, status: "done", current_step: "done", progress: 100, error_message: null };
    }
    setRehydrated(true);
    setGenerations(gens);
    setJobs(doneJobs);
    void (async () => {
      const ids = saved.map((s) => s.id);
      const { data } = await supabase
        .from("content_items")
        .select("id, title, preview, body, platform, engagement")
        .in("id", ids);
      if (!data) return;
      const m: Record<string, ContentItemRow> = {};
      for (const r of data) m[(r as ContentItemRow).id] = r as ContentItemRow;
      setItems(m);
      // Drop pointers to items that were deleted so the view stays honest.
      const existing = new Set(data.map((r) => (r as ContentItemRow).id));
      const gone = ids.filter((id) => !existing.has(id));
      if (gone.length) {
        pruneSessions(gone);
        setGenerations((prev) => prev.filter((g) => existing.has(g.contentItemId)));
      }
    })();
  }, [supabase]);

  // ─── Realtime: one channel per generation (job + item) ──────────────────────
  useEffect(() => {
    if (!supabase || generations.length === 0 || rehydrated) return;
    const channels = generations.map((g) => {
      void (async () => {
        const { data: itemData } = await supabase
          .from("content_items")
          .select("id, title, preview, body, platform, engagement")
          .eq("id", g.contentItemId)
          .maybeSingle();
        if (itemData) setItems((m) => ({ ...m, [g.contentItemId]: itemData as ContentItemRow }));
        const { data: jobData } = await supabase
          .from("content_generation_jobs")
          .select("id, status, current_step, progress, error_message")
          .eq("id", g.contentJobId)
          .maybeSingle();
        if (jobData) setJobs((m) => ({ ...m, [g.contentJobId]: jobData as JobRow }));
      })();

      return supabase
        .channel(`content-job:${g.contentJobId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "content_generation_jobs", filter: `id=eq.${g.contentJobId}` },
          (payload) => setJobs((m) => ({ ...m, [g.contentJobId]: payload.new as JobRow })),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "content_items", filter: `id=eq.${g.contentItemId}` },
          (payload) => setItems((m) => ({ ...m, [g.contentItemId]: payload.new as ContentItemRow })),
        )
        .subscribe();
    });
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [supabase, generations, rehydrated]);

  // ─── Polling fallback ───────────────────────────────────────────────────────
  // Realtime UPDATE events for content_generation_jobs / content_items don't
  // reliably reach the client in this project (the worker completes in ~10s but
  // the UI can stay on "Generating…"). Poll every 2.5s until every job is
  // terminal so results always show. Belt-and-suspenders with the Realtime sub.
  useEffect(() => {
    if (!supabase || generations.length === 0 || rehydrated) return;
    let stopped = false;
    const jobIds = generations.map((g) => g.contentJobId);
    const itemIds = generations.map((g) => g.contentItemId);

    const poll = async () => {
      if (stopped) return;
      const [{ data: jobRows }, { data: itemRows }] = await Promise.all([
        supabase
          .from("content_generation_jobs")
          .select("id, status, current_step, progress, error_message")
          .in("id", jobIds),
        supabase
          .from("content_items")
          .select("id, title, preview, body, platform, engagement")
          .in("id", itemIds),
      ]);
      if (stopped) return;
      if (jobRows) {
        setJobs((m) => {
          const n = { ...m };
          for (const r of jobRows) n[(r as JobRow).id] = r as JobRow;
          return n;
        });
      }
      if (itemRows) {
        setItems((m) => {
          const n = { ...m };
          for (const r of itemRows) n[(r as ContentItemRow).id] = r as ContentItemRow;
          return n;
        });
      }
      const allTerminal =
        !!jobRows &&
        jobRows.length === generations.length &&
        jobRows.every((r) => {
          const s = (r as JobRow).status;
          return s === "done" || s === "failed";
        });
      if (allTerminal) {
        clearInterval(interval);
        clearTimeout(safety);
      }
    };

    void poll(); // immediate first poll
    const interval = setInterval(poll, 2500);
    const safety = setTimeout(() => clearInterval(interval), 180_000); // give up after 3m

    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(safety);
    };
  }, [supabase, generations, rehydrated]);

  const handleGenerateAnother = () => {
    setGenerations([]);
    setJobs({});
    setItems({});
    setCopiedId(null);
    setSubmitError(null);
    setRehydrated(false); // back to the form; sessionStorage keeps the recents
  };

  const copyItem = (item: ContentItemRow) => {
    const text =
      `${item.title}\n\n${item.body ?? ""}` +
      (item.engagement?.hashtags?.length
        ? `\n\n${item.engagement.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`
        : "") +
      (item.engagement?.cta ? `\n\n${item.engagement.cta}` : "");
    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1800);
  };

  // ─── Empty state (no ready brands) ──────────────────────────────────────────
  if (readyBrands.length === 0) {
    return (
      <div className="p-6 max-w-[800px] mx-auto">
        <Link href="/content">
          <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
            <ArrowLeft size={12} /> Back to Content
          </button>
        </Link>
        <div className="glass rounded-2xl p-10 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(233,134,59,0.12)" }}>
            <Briefcase size={20} className="text-[#F2A863]" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">No brands ready yet</h2>
          <p className="text-sm text-white/50 mb-6 max-w-md mx-auto">
            Post generation needs at least one brand with completed research.
            Research a brand first, then come back here.
          </p>
          <Link href="/brands/new">
            <Button variant="gradient" size="sm" className="gap-1.5">
              <Sparkles size={14} /> Research a brand
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ─── Results state (one card per platform) ──────────────────────────────────
  if (generations.length > 0) {
    const allDone = generations.every((g) => {
      const s = jobs[g.contentJobId]?.status;
      return s === "done" || s === "failed";
    });

    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <Link href="/content">
          <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
            <ArrowLeft size={12} /> Back to Content
          </button>
        </Link>

        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white tracking-tight">
              {rehydrated
                ? "Recent Generated Content"
                : generations.length > 1
                  ? `Generating ${generations.length} posts for ${selectedBrand?.name}`
                  : `Generating a post for ${selectedBrand?.name}`}
            </h1>
            {rehydrated ? (
              <p className="text-xs text-white/50 mt-1">
                Restored from this session — content &amp; creatives stay here through refreshes.
              </p>
            ) : (
              selectedTopic && (
                <p className="text-xs text-white/50 mt-1 flex items-center gap-1.5">
                  <Lightbulb size={11} className="text-amber-400" />
                  Aligned to idea: <span className="text-white/75 font-medium">{selectedTopic.title}</span>
                </p>
              )
            )}
          </div>
          {(allDone || rehydrated) && (
            <Button variant="outline" size="sm" onClick={handleGenerateAnother} className="gap-1.5 flex-shrink-0">
              <Sparkles size={13} /> {rehydrated ? "Generate new post" : "Generate more"}
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {generations.map((g) => {
            const job = jobs[g.contentJobId];
            const item = items[g.contentItemId];
            const status = job?.status ?? "queued";
            const isDone = status === "done";
            const isFailed = status === "failed";
            const progress = job?.progress ?? 0;
            const stepLabel = STEP_LABEL[job?.current_step ?? "queued"] ?? "Running";
            const cfg = PLATFORM_BY_ID[g.platform];
            const PIcon = cfg.icon;

            return (
              <div key={g.contentJobId} className="space-y-3">
              <div className="glass rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: cfg.bg }}>
                    <PIcon size={18} style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
                        {cfg.label}
                      </span>
                      {isDone ? (
                        <Badge variant="success" className="text-3xs gap-1">
                          <CheckCircle2 size={9} /> Ready
                        </Badge>
                      ) : isFailed ? (
                        <Badge variant="destructive" className="text-3xs gap-1">
                          <AlertCircle size={9} /> Failed
                        </Badge>
                      ) : (
                        <Badge variant="info" className="text-3xs gap-1">
                          <Loader2 size={9} className="animate-spin" /> {stepLabel}
                        </Badge>
                      )}
                    </div>
                    {item?.title && !item.title.startsWith("Generating ") ? (
                      <h2 className="text-sm font-bold text-white leading-snug">{item.title}</h2>
                    ) : (
                      <h2 className="text-sm font-semibold text-white/50">Writing…</h2>
                    )}
                  </div>
                  {item?.body && (
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-shrink-0"
                      onClick={() => copyItem(item)}>
                      {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === item.id ? "Copied" : "Copy"}
                    </Button>
                  )}
                </div>

                {!isDone && !isFailed && (
                  <div className="mt-4">
                    <Progress value={progress} className="h-1.5" />
                    <div className="flex items-center justify-between mt-1.5 text-2xs text-white/40">
                      <span>{stepLabel}</span>
                      <span>{progress}%</span>
                    </div>
                  </div>
                )}

                {isFailed && job?.error_message && (
                  <p className="mt-3 text-xs text-red-300/80 break-words">{job.error_message}</p>
                )}

                {item?.body && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    {item.preview && (
                      <p className="text-sm text-white/70 italic mb-3 leading-relaxed">{item.preview}</p>
                    )}
                    <div className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed font-light">
                      {item.body}
                    </div>
                    {item.engagement?.cta && (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">Suggested CTA</p>
                        <p className="text-sm text-white/70">{item.engagement.cta}</p>
                      </div>
                    )}
                    {item.engagement?.hashtags && item.engagement.hashtags.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-2">Hashtags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {item.engagement.hashtags.map((h) => (
                            <span key={h} className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/60">
                              #{h.replace(/^#/, "")}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Creative Strategy + image + publishing preview — the full
                  workspace, no navigation needed. */}
              {item?.body && (
                <CreativePanel
                  contentItemId={g.contentItemId}
                  brandId={brandId}
                  post={{
                    title: item.title,
                    body: item.body,
                    cta: item.engagement?.cta ?? null,
                    hashtags: item.engagement?.hashtags ?? null,
                  }}
                />
              )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
  const q = topicSearch.trim().toLowerCase();
  const filteredTopics = q
    ? topics.filter((t) =>
        `${t.title} ${t.description ?? ""} ${t.hook_angle ?? ""}`.toLowerCase().includes(q),
      )
    : topics;

  return (
    <div className="p-6 max-w-[800px] mx-auto">
      <Link href="/content">
        <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
          <ArrowLeft size={12} /> Back to Content
        </button>
      </Link>

      <div className="flex items-start gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(233,134,59,0.12)" }}>
          <Wand2 size={17} className="text-[#F2A863]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Generate social posts</h1>
          <p className="text-white/50 text-sm mt-1">
            Pick a brand and one of its researched ideas, choose your platforms, and
            generate on-brand posts aligned to that idea.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-6">
        {/* Brand picker */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">Brand</label>
          <select
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setSelectedTopicId(null);
              setTopicSearch("");
            }}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#E9863B]/50 transition-colors"
          >
            {readyBrands.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#1a1510]">
                {b.name}{b.industry ? ` — ${b.industry}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Idea (brand_topics) picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">
              Idea{" "}
              <span className="text-white/30 font-normal normal-case">
                ({topics.length}) — optional, aligns the post
              </span>
            </label>
            {brandId && (
              <Link href={`/brands/${brandId}`} className="text-2xs text-[#F2A863] hover:underline">
                Manage ideas →
              </Link>
            )}
          </div>
          <input
            type="text"
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            placeholder="Search ideas…"
            disabled={topics.length === 0}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#E9863B]/50 transition-colors mb-2"
          />
          <div className="rounded-xl overflow-y-auto"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", maxHeight: 220, minHeight: 72 }}>
            {topicsLoading ? (
              <div className="p-4 text-xs text-white/50 flex items-center gap-2">
                <Loader2 size={11} className="animate-spin" /> Loading ideas…
              </div>
            ) : topics.length === 0 ? (
              <div className="p-4 text-xs text-white/50">
                No researched ideas for this brand yet.{" "}
                <Link href={`/brands/${brandId}`} className="text-[#F2A863] hover:underline">Generate ideas</Link>
                {" "}or leave this blank for an open-ended post.
              </div>
            ) : filteredTopics.length === 0 ? (
              <div className="p-4 text-xs text-white/50">No ideas match &ldquo;{topicSearch}&rdquo;</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {/* Open-ended (no idea) option */}
                <button
                  type="button"
                  onClick={() => setSelectedTopicId(null)}
                  className={`w-full text-left px-3 py-2 transition-colors ${selectedTopicId === null ? "bg-[#E9863B]/10" : "hover:bg-white/[0.03]"}`}
                >
                  <span className="text-xs text-white/55 italic">No idea — open-ended post from the brand profile</span>
                </button>
                {filteredTopics.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTopicId(t.id)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${selectedTopicId === t.id ? "bg-[#E9863B]/10" : "hover:bg-white/[0.03]"}`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                      {selectedTopicId === t.id && <CheckCircle2 size={11} className="text-[#F2A863] shrink-0" />}
                    </div>
                    {t.hook_angle && (
                      <p className="text-2xs text-white/55 italic truncate">&ldquo;{t.hook_angle}&rdquo;</p>
                    )}
                    {t.category && (
                      <Badge variant="purple" className="text-3xs mt-1">{t.category}</Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Platform multi-select */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">
            Platforms{" "}
            <span className="text-white/30 font-normal normal-case">({platforms.size} selected)</span>
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const selected = platforms.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlatform(p.id)}
                  className="flex items-center gap-2.5 p-3 rounded-xl text-left transition-all relative"
                  style={{
                    background: selected ? p.bg : "rgba(255,255,255,0.03)",
                    border: selected ? `1px solid ${p.color}40` : "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: selected ? p.bg : "rgba(255,255,255,0.04)" }}>
                    <Icon size={14} style={{ color: p.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: selected ? p.color : "rgba(255,255,255,0.7)" }}>
                      {p.label}
                    </p>
                    <p className="text-3xs text-white/35 truncate">{p.hint}</p>
                  </div>
                  {selected && (
                    <CheckCircle2 size={13} style={{ color: p.color }} className="absolute top-1.5 right-1.5" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-2xs text-white/30 mt-1.5">
            One post is generated per platform — each tuned to that platform&apos;s format.
          </p>
        </div>

        {/* Prompt Studio — premium editable prompt with history / saved prompts
            (client-side; wired to the existing userPrompt field the API accepts) */}
        <PromptStudio
          value={userPrompt}
          onChange={setUserPrompt}
          maxLength={500}
          brandName={selectedBrand?.name}
        />

        {/* Branding — overlay identity for the eventual creative image */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">
            Branding <span className="text-white/30 font-normal normal-case">(optional — overlays on the creative)</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value.slice(0, 120))}
              placeholder="Company name"
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#E9863B]/50"
            />
            <input
              type="text"
              value={founderName}
              onChange={(e) => setFounderName(e.target.value.slice(0, 120))}
              placeholder="Founder name"
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#E9863B]/50"
            />
            <input
              type="text"
              value={expertName}
              onChange={(e) => setExpertName(e.target.value.slice(0, 120))}
              placeholder="Expert name"
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#E9863B]/50"
            />
          </div>
          <div className="flex items-center gap-4 mt-2.5">
            <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} className="accent-[#E9863B]" />
              Use uploaded logo
            </label>
            <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={useHeadshot} onChange={(e) => setUseHeadshot(e.target.checked)} className="accent-[#E9863B]" />
              Use uploaded headshot
            </label>
          </div>
          <p className="text-2xs text-white/30 mt-1.5">
            Locked assets are only composited (resize / crop / mask / position) — never AI-modified. Blank fields fall back to the brand profile.
          </p>
        </div>

        {submitError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-red-300/80">{submitError}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-2xs text-white/30">Gemini Flash · ~50 credits per post</p>
          <Button variant="gradient" onClick={handleSubmit} disabled={submitting || !brandId || platforms.size === 0} className="gap-1.5">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {submitting
              ? "Starting…"
              : `Generate ${platforms.size > 1 ? `${platforms.size} posts` : "post"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
