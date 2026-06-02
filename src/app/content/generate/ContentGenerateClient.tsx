"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useSupabase } from "@/components/SupabaseProvider";
import { captureFallback } from "@/lib/observability";

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
  { id: "blog", label: "Blog Article", hint: "500-700 words · markdown", icon: BookOpen, color: "#a78bfa", bg: "rgba(124,58,237,0.12)" },
  { id: "twitter", label: "X / Twitter", hint: "240-280 chars · punchy", icon: Twitter, color: "#1da1f2", bg: "rgba(29,161,242,0.12)" },
  { id: "instagram", label: "Instagram", hint: "Caption + hashtags", icon: Globe, color: "#e1306c", bg: "rgba(225,48,108,0.12)" },
  { id: "facebook", label: "Facebook", hint: "Story-driven post", icon: Facebook, color: "#1877f2", bg: "rgba(24,119,242,0.12)" },
  { id: "email", label: "Email", hint: "Subject + body", icon: Mail, color: "#34d399", bg: "rgba(16,185,129,0.12)" },
];

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
  logs: Array<{ ts: string; level: string; step: string; message: string }> | null;
}

interface ContentItemRow {
  id: string;
  title: string;
  preview: string | null;
  body: string | null;
  platform: string;
  engagement: { hashtags?: string[]; cta?: string | null } | null;
}

export function ContentGenerateClient({ readyBrands }: { readyBrands: ReadyBrand[] }) {
  const router = useRouter();
  const supabase = useSupabase();

  const [brandId, setBrandId] = useState<string>(readyBrands[0]?.id ?? "");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [userPrompt, setUserPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // After submit
  const [jobId, setJobId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [item, setItem] = useState<ContentItemRow | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const selectedBrand = readyBrands.find((b) => b.id === brandId) ?? null;

  // ─── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting || !brandId) return;
    setSubmitting(true);
    setSubmitError(null);
    startedAtRef.current = Date.now();
    try {
      const res = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform,
          userPrompt: userPrompt.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setJobId(data.contentJobId);
      setItemId(data.contentItemId);
      // Optimistic placeholder so the user sees the progress card immediately
      setJob({
        id: data.contentJobId,
        status: "queued",
        current_step: "queued",
        progress: 0,
        error_message: null,
        logs: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      captureFallback("content.generate.client_submit_failed", err, {
        brandId,
        platform,
        promptLength: userPrompt.length,
      });
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, brandId, platform, userPrompt]);

  // ─── Realtime subscription on the job + the content item ────────────────────
  useEffect(() => {
    if (!supabase || !jobId || !itemId) return;

    const channel = supabase
      .channel(`content-job:${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "content_generation_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          setJob(payload.new as JobRow);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "content_items",
          filter: `id=eq.${itemId}`,
        },
        (payload) => {
          setItem(payload.new as ContentItemRow);
        },
      )
      .subscribe();

    // Also fetch the initial item snapshot once
    void (async () => {
      const { data } = await supabase
        .from("content_items")
        .select("id, title, preview, body, platform, engagement")
        .eq("id", itemId)
        .maybeSingle();
      if (data) setItem(data as ContentItemRow);
    })();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, jobId, itemId]);

  // ─── Reset for next generation ──────────────────────────────────────────────
  const handleGenerateAnother = () => {
    setJobId(null);
    setItemId(null);
    setJob(null);
    setItem(null);
    setCopied(false);
    setSubmitError(null);
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
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(124,58,237,0.12)" }}
          >
            <Briefcase size={20} className="text-violet-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">
            No brands ready yet
          </h2>
          <p className="text-sm text-white/50 mb-6 max-w-md mx-auto">
            Content generation needs at least one brand with completed research.
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

  // ─── Generating / Done state ────────────────────────────────────────────────
  if (jobId) {
    const status = job?.status ?? "queued";
    const isDone = status === "done";
    const isFailed = status === "failed";
    const progress = job?.progress ?? 0;
    const stepLabel = STEP_LABEL[job?.current_step ?? "queued"] ?? "Running";
    const elapsedMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    const platformConfig = PLATFORMS.find((p) => p.id === platform)!;
    const PIcon = platformConfig.icon;

    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <Link href="/content">
          <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
            <ArrowLeft size={12} /> Back to Content
          </button>
        </Link>

        {/* Header card */}
        <div className="glass rounded-2xl p-6 mb-4">
          <div className="flex items-start gap-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: platformConfig.bg }}
            >
              <PIcon size={20} style={{ color: platformConfig.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
                  {platformConfig.label}
                </span>
                {isDone && (
                  <Badge variant="success" className="text-[9px] gap-1">
                    <CheckCircle2 size={9} /> Ready
                  </Badge>
                )}
                {isFailed && (
                  <Badge variant="destructive" className="text-[9px] gap-1">
                    <AlertCircle size={9} /> Failed
                  </Badge>
                )}
                {!isDone && !isFailed && (
                  <Badge variant="info" className="text-[9px] gap-1">
                    <Loader2 size={9} className="animate-spin" />
                    {stepLabel}
                  </Badge>
                )}
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                {item?.title?.startsWith("Generating ")
                  ? `Generating content for ${selectedBrand?.name}…`
                  : (item?.title ?? `Generating content for ${selectedBrand?.name}…`)}
              </h1>
              {userPrompt.trim() && (
                <p className="text-xs text-white/40 mt-1 italic">
                  &ldquo;{userPrompt.trim()}&rdquo;
                </p>
              )}
            </div>
          </div>

          {!isDone && !isFailed && (
            <div className="mt-5">
              <Progress value={progress} className="h-1.5" />
              <div className="flex items-center justify-between mt-2 text-[11px] text-white/40">
                <span>{stepLabel}</span>
                <span>{progress}% · {Math.round(elapsedMs / 1000)}s</span>
              </div>
            </div>
          )}
        </div>

        {/* Failure card */}
        {isFailed && job?.error_message && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle
                size={16}
                className="text-red-400 flex-shrink-0 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-red-300 mb-1">
                  Generation failed
                </h3>
                <p className="text-xs text-red-300/80 break-words mb-4">
                  {job.error_message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAnother}
                  className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Output preview as soon as item has a body */}
        {item?.body && (
          <div className="glass rounded-2xl p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Generated content</h2>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => {
                  const text =
                    `${item.title}\n\n${item.body}` +
                    (item.engagement?.hashtags?.length
                      ? `\n\n${item.engagement.hashtags
                          .map((h) => `#${h.replace(/^#/, "")}`)
                          .join(" ")}`
                      : "") +
                    (item.engagement?.cta ? `\n\n${item.engagement.cta}` : "");
                  navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            {item.preview && (
              <p className="text-sm text-white/70 italic mb-4 leading-relaxed">
                {item.preview}
              </p>
            )}

            <div className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed font-light">
              {item.body}
            </div>

            {item.engagement?.cta && (
              <div className="mt-5 pt-5 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">
                  Suggested CTA
                </p>
                <p className="text-sm text-white/70">{item.engagement.cta}</p>
              </div>
            )}

            {item.engagement?.hashtags && item.engagement.hashtags.length > 0 && (
              <div className="mt-5 pt-5 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-2">
                  Hashtags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.engagement.hashtags.map((h) => (
                    <span
                      key={h}
                      className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/60"
                    >
                      #{h.replace(/^#/, "")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live log feed while generating */}
        {!isDone && !isFailed && job?.logs && job.logs.length > 0 && (
          <div className="glass rounded-2xl p-5 mb-4">
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
              Live log
            </h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {job.logs.map((l, i) => (
                <div
                  key={`${l.ts}-${i}`}
                  className="flex items-start gap-2 text-[11px]"
                >
                  <span className="text-white/30 font-mono mt-0.5 flex-shrink-0">
                    {new Date(l.ts).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span
                    className={
                      l.level === "error"
                        ? "text-red-400"
                        : l.level === "success"
                          ? "text-emerald-400"
                          : "text-white/60"
                    }
                  >
                    {l.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action row */}
        {isDone && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateAnother}
              className="gap-1.5"
            >
              <Sparkles size={13} /> Generate another
            </Button>
            <Link href="/content">
              <Button variant="ghost" size="sm">
                Back to content list
              </Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  // ─── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[800px] mx-auto">
      <Link href="/content">
        <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
          <ArrowLeft size={12} /> Back to Content
        </button>
      </Link>

      <div className="flex items-start gap-3 mb-8">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(124,58,237,0.12)" }}
        >
          <Wand2 size={17} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Generate content
          </h1>
          <p className="text-white/50 text-sm mt-1">
            Pick a brand, pick a platform, write the topic (or leave blank for
            an open-ended take). One Gemini call, ~15-25 seconds.
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-6">
        {/* Brand picker */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">
            Brand
          </label>
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500/40 transition-colors"
          >
            {readyBrands.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#0a0a18]">
                {b.name}
                {b.industry ? ` — ${b.industry}` : ""}
              </option>
            ))}
          </select>
          {selectedBrand?.website && (
            <p className="text-[11px] text-white/30 mt-1.5">
              Uses brand profile, voice, and audience from {selectedBrand.website}
            </p>
          )}
        </div>

        {/* Platform picker */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">
            Platform
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const selected = platform === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className="flex items-center gap-2.5 p-3 rounded-xl text-left transition-all"
                  style={{
                    background: selected ? p.bg : "rgba(255,255,255,0.03)",
                    border: selected
                      ? `1px solid ${p.color}40`
                      : "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: selected ? p.bg : "rgba(255,255,255,0.04)" }}
                  >
                    <Icon size={14} style={{ color: p.color }} />
                  </div>
                  <div className="min-w-0">
                    <p
                      className="text-xs font-semibold truncate"
                      style={{ color: selected ? p.color : "rgba(255,255,255,0.7)" }}
                    >
                      {p.label}
                    </p>
                    <p className="text-[10px] text-white/35 truncate">{p.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional prompt */}
        <div>
          <label className="text-xs font-semibold text-white/70 uppercase tracking-wider block mb-2">
            Topic <span className="text-white/30 font-normal normal-case">(optional)</span>
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value.slice(0, 500))}
            placeholder="e.g. 'Why product managers should care about RICE scoring' — or leave blank for an open-ended take based on the brand profile."
            rows={3}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 transition-colors resize-none"
          />
          <p className="text-[11px] text-white/30 mt-1.5">
            {userPrompt.length}/500 — the more specific, the better
          </p>
        </div>

        {submitError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-red-300/80">{submitError}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-white/30">
            Uses Gemini Flash · ~50 credits
          </p>
          <Button
            variant="gradient"
            onClick={handleSubmit}
            disabled={submitting || !brandId}
            className="gap-1.5"
          >
            {submitting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {submitting ? "Starting…" : "Generate content"}
          </Button>
        </div>
      </div>
    </div>
  );
}
