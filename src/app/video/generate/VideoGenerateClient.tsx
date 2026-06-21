"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { captureFallback } from "@/lib/observability";
import { useSupabase } from "@/components/SupabaseProvider";
import type {
  SSEEvent,
  GenerateRequest,
  DbBrand,
  DbBrandTopic,
  BrandTopicCategory,
} from "@/lib/types";
import {
  ArrowLeft,
  Sparkles,
  Play,
  Download,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  Circle,
  AlertCircle,
  Mic,
  Type,
  Film,
  Music,
  Wand2,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

// Four honest phases that match the real pipeline: the route's SSE stream
// drives script → voice → footage (Gemini script, ElevenLabs voice, stock
// footage + edit plan); the worker drives `render` asynchronously and reports
// back via render_jobs.merge_status (NOT the SSE stream).
type PipelineStage = "script" | "voice" | "footage" | "render";

type StageStatus = "pending" | "running" | "done" | "error";

interface Stage {
  id: PipelineStage;
  label: string;
  icon: React.ElementType;
}

interface LogEntry {
  level: "info" | "warn" | "error" | "success";
  message: string;
  ts: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: Stage[] = [
  { id: "script", label: "Script", icon: Type },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "footage", label: "Footage", icon: Film },
  { id: "render", label: "Render", icon: Zap },
];

const STYLES = [
  "cinematic", "ugc", "minimal", "bold", "luxury", "tech", "outdoor", "neon",
];

const VIBES = ["energetic", "calm", "dramatic", "playful", "inspirational"];

const EXAMPLES = [
  "30-second TikTok ad for an ergonomic standing desk targeting remote workers",
  "UGC-style product review video for a skincare serum, warm lifestyle tone",
  "High-energy Facebook ad for a fitness app with before/after transformation",
  "Luxury brand video for a Swiss watch, cinematic black and white",
  "Quick demo reel showing 3 features of an AI writing tool",
];

function stageFromLog(msg: string): PipelineStage | null {
  const m = msg.toLowerCase();
  if (m.includes("strategy") || m.includes("script") || m.includes("storyboard")) return "script";
  if (m.includes("voice") || m.includes("narration") || m.includes("audio")) return "voice";
  if (
    m.includes("music") || m.includes("footage") || m.includes("composition") ||
    m.includes("editing") || m.includes("plan") || m.includes("clip")
  ) return "footage";
  // "Queueing render" is the planning-side hand-off; the render stage only
  // *completes* when the worker reports merge_status='done' (see Realtime).
  if (m.includes("render") || m.includes("compose") || m.includes("queue")) return "render";
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Phase 2 props (server-fetched) ──────────────────────────────────────────
interface Props {
  brands: DbBrand[];
  initialTopics: DbBrandTopic[];
  preselectBrandId: string | null;
  preselectTopicId: string | null;
}

const STYLE_CATEGORIES: { id: BrandTopicCategory; label: string }[] = [
  { id: "educational", label: "Educational" },
  { id: "storytelling", label: "Storytelling" },
  { id: "ugc", label: "UGC" },
  { id: "product-demo", label: "Product Demo" },
  { id: "listicle", label: "Listicle" },
  { id: "problem-solution", label: "Problem / Solution" },
  { id: "founder-story", label: "Founder Story" },
];

export function VideoGenerateClient({
  brands,
  initialTopics,
  preselectBrandId,
  preselectTopicId,
}: Props) {
  // ─── Phase 2 brand → topic → style picker state ─────────────────────────────
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(
    preselectBrandId ?? brands[0]?.id ?? null,
  );
  const [topics, setTopics] = useState<DbBrandTopic[]>(initialTopics);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(
    preselectTopicId,
  );
  const [topicSearch, setTopicSearch] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<BrandTopicCategory>(
    "educational",
  );
  const [advancedPromptMode, setAdvancedPromptMode] = useState(false);

  // ─── Legacy free-form prompt path (kept for "Advanced" mode) ────────────────
  const [prompt, setPrompt] = useState("");
  // provider + renderVariant are no longer user-selectable (the FFmpeg
  // pipeline is stock-footage-only and ignores them); kept as fixed values so
  // the request body shape stays stable for the route + render_jobs row.
  const [provider] = useState<GenerateRequest["provider"]>("veo3");
  const [style, setStyle] = useState("cinematic");
  const [sceneCount, setSceneCount] = useState(4);
  const [vibe, setVibe] = useState("energetic");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hookStyle, setHookStyle] = useState("bold-statement");
  const [renderVariant] = useState("ugc-v2");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [stages, setStages] = useState<Record<PipelineStage, StageStatus>>({
    script: "pending", voice: "pending", footage: "pending", render: "pending",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // Narration audio (ElevenLabs MP3, data URL) + Jamendo music track
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicTrack, setMusicTrack] = useState<string | null>(null);
  // Stock-footage attribution (e.g. "Photographer Name via Pexels").
  // Shown beneath the video to satisfy Pexels' attribution requirement.
  const [videoAttribution, setVideoAttribution] = useState<string | null>(null);
  // Upload-ready post copy generated by Gemini for the user to paste
  // into TikTok / IG / Reels upload flow.
  const [seo, setSeo] = useState<{
    title: string;
    description: string;
    hashtags: string[];
  } | null>(null);
  // Post-pipeline ffmpeg merge that combines the 3 separate assets into a
  // single downloadable MP4. Lifecycle: null → "pending" → "merging" → "done" | "failed".
  // When done, mergedVideoUrl carries the Supabase Storage URL; the page
  // swaps the <video> source + Download button over.
  const [mergeStatus, setMergeStatus] = useState<
    null | "pending" | "merging" | "done" | "failed"
  >(null);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  // The worker's failure reason (render_jobs.merge_error) when merge_status
  // flips to "failed" — surfaced so the user sees WHY the render failed
  // instead of a hung spinner.
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // ─── Phase 2: refetch topics when the user picks a different brand ─────────
  // initialTopics covers the preselected brand on first paint. When the user
  // switches brands via the dropdown we hit Supabase directly (RLS scopes to
  // owner via brand_id traversal so this is safe).
  const supabaseForTopics = useSupabase();
  useEffect(() => {
    if (!supabaseForTopics || !selectedBrandId) return;
    // Skip refetch when the dropdown matches the server-preselected brand
    // (we already have its topics from SSR).
    if (selectedBrandId === preselectBrandId && topics.length > 0) return;
    let cancelled = false;
    setTopicsLoading(true);
    (async () => {
      const { data, error } = await supabaseForTopics
        .from("brand_topics")
        .select("*")
        .eq("brand_id", selectedBrandId)
        .in("status", ["draft", "used"])
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        captureFallback("video.generate.topic_fetch_failed", error, {
          brandId: selectedBrandId,
        });
        setTopics([]);
      } else {
        setTopics((data ?? []) as DbBrandTopic[]);
      }
      setTopicsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // intentionally exclude `topics` from deps (would infinite-loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseForTopics, selectedBrandId, preselectBrandId]);

  // ─── Realtime: watch render_jobs for the merged video URL ────────────────
  // /api/generate enqueues a ffmpeg merge job on the Railway worker after
  // the SSE pipeline closes. When the worker finishes, render_jobs.
  // merged_video_url is set + merge_status flips to 'done'. We swap the
  // <video> source + Download button to the merged file (audio baked in).
  const supabase = useSupabase();
  useEffect(() => {
    if (!supabase || !jobId) return;
    let cancelled = false;

    // Initial fetch in case the merge already finished (or failed) before we
    // subscribed — the worker can OOM in seconds, faster than the SSE close.
    (async () => {
      const { data } = await supabase
        .from("render_jobs")
        .select("merge_status, merged_video_url, merge_error")
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled || !data) return;
      if (data.merge_status) {
        setMergeStatus(data.merge_status as typeof mergeStatus);
      }
      if (data.merged_video_url) {
        setMergedVideoUrl(data.merged_video_url as string);
      }
      if (data.merge_error) {
        setMergeError(data.merge_error as string);
      }
    })();

    const channel = supabase
      .channel(`render-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "render_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const row = payload.new as {
            merge_status?: string | null;
            merged_video_url?: string | null;
            merge_error?: string | null;
          };
          if (row.merge_status) {
            setMergeStatus(row.merge_status as typeof mergeStatus);
          }
          if (row.merged_video_url) {
            setMergedVideoUrl(row.merged_video_url);
          }
          if (row.merge_error) {
            setMergeError(row.merge_error);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, jobId]);

  // ─── Render stage is WORKER-driven (not the SSE stream) ────────────────────
  // The SSE pipeline only does planning (script → voice → footage + plan). The
  // actual video render runs async in the worker and reports via merge_status.
  // We map that to the final "render" stage + overall completion HERE so the
  // UI never claims "Complete" until a real merged video exists.
  useEffect(() => {
    if (!mergeStatus) return;
    if (mergeStatus === "done") {
      setStages((p) => ({ ...p, script: "done", voice: "done", footage: "done", render: "done" }));
      setProgress(100);
      setStatusLabel("Complete");
      setMergeError(null);
    } else if (mergeStatus === "failed") {
      setStages((p) => ({ ...p, render: "error" }));
      setStatusLabel("Render failed");
    } else {
      // pending | merging — the worker is rendering the final MP4.
      setStages((p) => ({ ...p, render: "running" }));
      setProgress((p) => (p < 95 ? 95 : p));
      setStatusLabel("Rendering final video…");
    }
  }, [mergeStatus]);

  const advanceStage = useCallback((stage: PipelineStage) => {
    setStages((prev) => {
      const next = { ...prev };
      // Mark all previous stages done
      let found = false;
      for (const s of STAGES) {
        if (s.id === stage) { found = true; next[s.id] = "running"; }
        else if (!found && next[s.id] !== "done") next[s.id] = "done";
      }
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    // Two-mode validation: brand path needs brand+topic, prompt path needs text.
    const validBrandPath =
      !advancedPromptMode && !!selectedBrandId && !!selectedTopicId;
    const validPromptPath = advancedPromptMode && prompt.trim().length > 0;
    if (!validBrandPath && !validPromptPath) return;
    if (running) return;

    // Reset state
    setRunning(true);
    setProgress(0);
    setStatusLabel("Initializing pipeline…");
    setVideoUrl(null);
    setAudioUrl(null);
    setMusicUrl(null);
    setMusicTrack(null);
    setVideoAttribution(null);
    setSeo(null);
    setMergeStatus(null);
    setMergedVideoUrl(null);
    setMergeError(null);
    setJobId(null);
    setError(null);
    setLogs([]);
    setStages({ script: "pending", voice: "pending", footage: "pending", render: "pending" });

    abortRef.current = new AbortController();

    // Brand-driven path takes precedence when a brand + topic are selected
    // AND we're not in legacy free-form mode. The API resolves the topic
    // into a brand-voice-aware prompt server-side; we don't need to
    // duplicate that work here.
    const useBrandPath =
      !advancedPromptMode && !!selectedBrandId && !!selectedTopicId;

    const body: GenerateRequest = useBrandPath
      ? {
          brandId: selectedBrandId!,
          topicId: selectedTopicId!,
          style: selectedStyle,
          provider,
          sceneCount,
          musicVibe: vibe,
          hookStyle,
          renderVariant,
        }
      : {
          prompt,
          provider,
          style,
          sceneCount,
          musicVibe: vibe,
          hookStyle,
          renderVariant,
        };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event: SSEEvent;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "log") {
            const level = event.level ?? "info";
            const message = event.message ?? "";
            setLogs((prev) => [...prev, { level, message, ts: Date.now() }]);

            // Detect stage advancement from log message
            const stage = stageFromLog(message);
            if (stage) advanceStage(stage);
          }

          if (event.type === "status") {
            if (event.label) setStatusLabel(event.label);
            // Cap the SSE-reported progress at 90 — the planning phase tops
            // out here. The route emits "Complete 100" at the END of planning,
            // but the actual render hasn't started; the worker's merge_status
            // drives 95 → 100 (see the merge_status effect).
            if (event.pct !== undefined) setProgress(Math.min(event.pct, 90));
          }

          if (event.type === "done") {
            // Planning finished — but the REAL video now renders ASYNC in the
            // worker. Do NOT claim "Complete": mark planning stages done and
            // the render stage running. The merge_status effect flips render →
            // done (or error) + progress → 100 once the worker reports back.
            setStages((p) => ({
              ...p,
              script: "done", voice: "done", footage: "done",
              render: p.render === "done" ? "done" : "running",
            }));
            setProgress((p) => (p < 92 ? 92 : p));
            setStatusLabel("Rendering final video…");
            if (event.videoUrl) setVideoUrl(event.videoUrl);
            if (event.audioUrl) setAudioUrl(event.audioUrl);
            if (event.musicUrl) setMusicUrl(event.musicUrl);
            if (event.musicTrack) setMusicTrack(event.musicTrack);
            if (event.videoAttribution)
              setVideoAttribution(event.videoAttribution);
            if (event.seo) setSeo(event.seo);
            if (event.jobId) setJobId(event.jobId);
            setRunning(false);
          }

          if (event.type === "error") {
            setError(event.error ?? "Unknown error");
            setRunning(false);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        // Surface to UI immediately, AND forward through the observability
        // shim → Sentry. AbortError is voluntary (user clicked Stop) so it
        // stays filtered. Everything else — 404 (route not built yet),
        // 500 from upstream, network failure — needs to be visible to ops.
        captureFallback("video.generate.failed", err, {
          provider,
          sceneCount,
          style,
          vibe,
          // Don't include the prompt verbatim — could contain PII.
          promptLength: prompt.length,
        });
        setError((err as Error).message);
      }
      setRunning(false);
    }
  }, [
    prompt,
    provider,
    style,
    sceneCount,
    vibe,
    hookStyle,
    renderVariant,
    running,
    advanceStage,
    // Phase 2 brand-driven path deps. Without these, useCallback memoizes
    // a stale closure where selectedBrandId/Topic/Style are null even
    // after the user picks them, so the early-return validation rejects
    // the submission silently.
    advancedPromptMode,
    selectedBrandId,
    selectedTopicId,
    selectedStyle,
  ]);

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
    setStatusLabel("Stopped");
  };

  const handleCopyLink = () => {
    const url = mergedVideoUrl ?? videoUrl;
    if (url) navigator.clipboard.writeText(url);
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto">

      {/* Legacy notice — this is the older stock-footage (script→voice→footage)
          generator. The canonical Video V1 path is strategy-driven from a
          content item's approved creative brief. */}
      <div
        className="mb-5 rounded-xl px-4 py-3 flex items-start gap-2 text-2xs"
        style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.22)" }}
      >
        <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <span className="text-amber-100/85">
          <span className="font-semibold">Legacy Video Generator</span> (stock footage).
          The new strategy-driven video is created from a content item — open{" "}
          <Link href="/content" className="underline hover:text-amber-200">Content Pipeline</Link>,
          approve a creative, then click <span className="font-medium">Generate Video</span>.
        </span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/video">
          <button className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors">
            <ArrowLeft size={12} /> Video Pipeline
          </button>
        </Link>
        <span className="text-white/20">/</span>
        <span className="text-xs text-amber-400/90 font-medium">Legacy Video Generator</span>
        {/* Cross-link to the social-post generator — this page makes videos;
            written posts live in the content pipeline. */}
        <Link
          href="/content/generate"
          className="ml-auto flex items-center gap-1.5 text-2xs font-medium text-fuchsia-300/80 hover:text-fuchsia-200 transition-colors"
        >
          <Type size={12} /> Generate a social post instead →
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">

        {/* ── Left: Prompt form ── */}
        <div className="space-y-4">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Wand2 size={16} className="text-cyan-400" />
              <h2 className="text-base font-bold text-white">
                {advancedPromptMode ? "Video Prompt" : "Brand · Topic · Style"}
              </h2>
              <Badge variant="info" className="text-3xs ml-auto">
                {advancedPromptMode ? "Advanced" : "Brand-driven"}
              </Badge>
            </div>

            {/* ── Brand-driven flow (Phase 2 default) ───────────────────── */}
            {!advancedPromptMode && (
              <div className="space-y-4 mb-4">
                {brands.length === 0 ? (
                  <div className="rounded-xl p-4 text-sm text-white/60 leading-relaxed"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    You don&apos;t have any ready brands yet.{" "}
                    <Link href="/brands/new" className="text-cyan-400 hover:underline">
                      Research a brand first
                    </Link>{" "}
                    — generated videos derive script + visuals from the brand profile.
                  </div>
                ) : (
                  <>
                    {/* Brand selector */}
                    <div>
                      <label className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5 block">
                        Brand
                      </label>
                      <select
                        value={selectedBrandId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setSelectedBrandId(id);
                          setSelectedTopicId(null);
                          if (!id) {
                            setTopics([]);
                          }
                        }}
                        disabled={running}
                        className="w-full text-sm text-white outline-none rounded-xl p-3 transition-colors"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        {brands.map((b) => (
                          <option key={b.id} value={b.id} className="bg-slate-900">
                            {b.name}{b.industry ? ` · ${b.industry}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Topic picker */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
                          Topic{" "}
                          <span className="text-white/30">
                            ({topics.length})
                          </span>
                        </label>
                        {selectedBrandId && (
                          <Link
                            href={`/brands/${selectedBrandId}`}
                            className="text-3xs text-cyan-400 hover:underline"
                          >
                            Manage topics →
                          </Link>
                        )}
                      </div>
                      <input
                        type="text"
                        value={topicSearch}
                        onChange={(e) => setTopicSearch(e.target.value)}
                        placeholder="Search topics…"
                        disabled={running || topics.length === 0}
                        className="w-full text-sm text-white/80 placeholder:text-white/30 outline-none rounded-xl px-3 py-2 mb-2"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      />
                      <div
                        className="rounded-xl overflow-y-auto"
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          maxHeight: 240,
                          minHeight: 80,
                        }}
                      >
                        {topicsLoading ? (
                          <div className="p-4 text-xs text-white/50 flex items-center gap-2">
                            <Loader2 size={11} className="animate-spin" />
                            Loading topics…
                          </div>
                        ) : topics.length === 0 ? (
                          <div className="p-4 text-xs text-white/50">
                            No topics yet for this brand.{" "}
                            {selectedBrandId && (
                              <Link
                                href={`/brands/${selectedBrandId}`}
                                className="text-cyan-400 hover:underline"
                              >
                                Generate topics
                              </Link>
                            )}
                          </div>
                        ) : (
                          (() => {
                            const q = topicSearch.trim().toLowerCase();
                            const filtered = q
                              ? topics.filter((t) =>
                                  `${t.title} ${t.description ?? ""} ${t.hook_angle ?? ""}`
                                    .toLowerCase()
                                    .includes(q),
                                )
                              : topics;
                            if (filtered.length === 0) {
                              return (
                                <div className="p-4 text-xs text-white/50">
                                  No topics match &ldquo;{topicSearch}&rdquo;
                                </div>
                              );
                            }
                            return (
                              <div className="divide-y divide-white/[0.04]">
                                {filtered.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    disabled={running}
                                    onClick={() => setSelectedTopicId(t.id)}
                                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                                      selectedTopicId === t.id
                                        ? "bg-cyan-500/10"
                                        : "hover:bg-white/[0.03]"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <p className="text-sm font-semibold text-white truncate">
                                        {t.title}
                                      </p>
                                      {selectedTopicId === t.id && (
                                        <CheckCircle2 size={11} className="text-cyan-400 shrink-0" />
                                      )}
                                    </div>
                                    {t.hook_angle && (
                                      <p className="text-2xs text-white/55 italic truncate">
                                        &ldquo;{t.hook_angle}&rdquo;
                                      </p>
                                    )}
                                    {t.category && (
                                      <Badge variant="purple" className="text-3xs mt-1">
                                        {t.category}
                                      </Badge>
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>

                    {/* Style picker */}
                    <div>
                      <label className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5 block">
                        Video Style
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {STYLE_CATEGORIES.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            disabled={running}
                            onClick={() => setSelectedStyle(s.id)}
                            className={`text-2xs font-semibold rounded-full px-3 py-1.5 transition-colors ${
                              selectedStyle === s.id
                                ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                                : "bg-white/[0.03] text-white/55 border border-white/[0.06] hover:border-white/15"
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Live topic preview when selected */}
                    {selectedTopicId && (() => {
                      const t = topics.find((x) => x.id === selectedTopicId);
                      if (!t) return null;
                      return (
                        <div
                          className="rounded-xl p-3 space-y-1.5"
                          style={{
                            background: "rgba(6,182,212,0.05)",
                            border: "1px solid rgba(6,182,212,0.15)",
                          }}
                        >
                          <p className="text-3xs uppercase tracking-wider text-cyan-300/80 font-semibold">
                            Topic preview
                          </p>
                          <p className="text-sm font-semibold text-white">
                            {t.title}
                          </p>
                          {t.hook_angle && (
                            <div>
                              <p className="text-3xs uppercase tracking-wider text-white/40 mb-0.5">Hook</p>
                              <p className="text-xs text-white/85 italic">
                                &ldquo;{t.hook_angle}&rdquo;
                              </p>
                            </div>
                          )}
                          {t.description && (
                            <div>
                              <p className="text-3xs uppercase tracking-wider text-white/40 mb-0.5">Core angle</p>
                              <p className="text-xs text-white/70 leading-relaxed">
                                {t.description}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setAdvancedPromptMode(true)}
                  className="text-2xs text-white/40 hover:text-white/70 transition-colors"
                >
                  Switch to free-form prompt →
                </button>
              </div>
            )}

            {advancedPromptMode && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setAdvancedPromptMode(false)}
                  className="text-2xs text-white/40 hover:text-white/70 transition-colors"
                >
                  ← Back to brand-driven flow
                </button>
              </div>
            )}

            {/* Prompt textarea (advanced mode only) */}
            {advancedPromptMode && (
            <div className="mb-4">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your video… e.g. '30-second TikTok ad for an ergonomic standing desk targeting remote workers'"
                className="w-full text-sm text-white/75 placeholder:text-white/20 resize-none outline-none transition-colors rounded-xl p-4 leading-relaxed"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${prompt ? "rgba(6,182,212,0.25)" : "rgba(255,255,255,0.08)"}`,
                  minHeight: 110,
                }}
                disabled={running}
              />
              {/* Example prompts */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {EXAMPLES.slice(0, 3).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setPrompt(ex)}
                    disabled={running}
                    className="text-3xs text-white/30 hover:text-white/55 transition-colors px-2 py-1 rounded-lg max-w-[200px] text-left truncate"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Style pills — advanced-mode-only. The brand-driven flow uses
                the BrandTopicCategory style picker above instead. */}
            {advancedPromptMode && (
            <div className="mb-4">
              <p className="text-3xs font-semibold uppercase tracking-wider text-white/35 mb-2">Visual Style</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    disabled={running}
                    className="text-xs px-3 py-1.5 rounded-full capitalize transition-all font-medium"
                    style={{
                      background: style === s ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.04)",
                      border: style === s ? "1px solid rgba(124,58,237,0.3)" : "1px solid rgba(255,255,255,0.06)",
                      color: style === s ? "#a78bfa" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Scene count + Music vibe — keep visible in BOTH modes so
                the brand-driven flow has a fast way to tune length/vibe. */}
            <div className="flex gap-4 mb-4">
              <div className="flex-1">
                <p className="text-3xs font-semibold uppercase tracking-wider text-white/35 mb-2">Scenes</p>
                <div className="flex gap-1.5">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setSceneCount(n)}
                      disabled={running}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: sceneCount === n ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.04)",
                        border: sceneCount === n ? "1px solid rgba(124,58,237,0.3)" : "1px solid rgba(255,255,255,0.06)",
                        color: sceneCount === n ? "#a78bfa" : "rgba(255,255,255,0.35)",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <p className="text-3xs font-semibold uppercase tracking-wider text-white/35 mb-2">Music Vibe</p>
                <div className="flex flex-wrap gap-1">
                  {VIBES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setVibe(v)}
                      disabled={running}
                      className="text-3xs px-2 py-1 rounded-lg capitalize transition-all font-medium"
                      style={{
                        background: vibe === v ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.03)",
                        border: vibe === v ? "1px solid rgba(6,182,212,0.25)" : "1px solid rgba(255,255,255,0.05)",
                        color: vibe === v ? "#67e8f9" : "rgba(255,255,255,0.3)",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-2xs text-white/30 hover:text-white/50 transition-colors mb-3"
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Advanced options
            </button>

            {showAdvanced && (
              <div className="mb-4 pt-3"
                style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <p className="text-3xs font-semibold uppercase tracking-wider text-white/35 mb-2">Hook Style</p>
                <div className="flex flex-wrap gap-1.5">
                  {["bold-statement", "question", "shocking-stat", "story"].map((h) => (
                    <button
                      key={h}
                      onClick={() => setHookStyle(h)}
                      disabled={running}
                      className="text-2xs px-3 py-1.5 rounded-full capitalize transition-all font-medium"
                      style={{
                        background: hookStyle === h ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.03)",
                        border: hookStyle === h ? "1px solid rgba(124,58,237,0.3)" : "1px solid rgba(255,255,255,0.06)",
                        color: hookStyle === h ? "#a78bfa" : "rgba(255,255,255,0.4)",
                      }}
                    >
                      {h.replace(/-/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="flex gap-2">
              {running ? (
                <Button
                  onClick={handleStop}
                  variant="outline"
                  className="flex-1 gap-2 text-red-400 border-red-500/20 hover:border-red-500/40"
                >
                  <Circle size={13} className="fill-red-500 text-red-500" />
                  Stop Generation
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={
                    advancedPromptMode
                      ? !prompt.trim()
                      : !selectedBrandId || !selectedTopicId
                  }
                  variant="gradient-cyan"
                  size="lg"
                  className="flex-1 gap-2"
                >
                  <Sparkles size={15} />
                  Generate Video
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Progress + Output ── */}
        <div className="space-y-4">

          {/* Pipeline progress */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Pipeline Progress</h3>
              {running ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-3xs text-cyan-400">Planning</span>
                </div>
              ) : mergeStatus === "failed" ? (
                <Badge variant="destructive" className="text-3xs">Render failed</Badge>
              ) : mergeStatus === "done" && mergedVideoUrl ? (
                <Badge variant="success" className="text-3xs">Complete</Badge>
              ) : videoUrl ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-3xs text-cyan-400">Rendering</span>
                </div>
              ) : null}
            </div>

            {/* Overall progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-3xs text-white/40 mb-1.5">
                <span>{statusLabel || "Ready"}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>

            {/* Stage badges */}
            <div className="grid grid-cols-4 gap-2">
              {STAGES.map((stage) => {
                const status = stages[stage.id];
                const Icon = stage.icon;
                return (
                  <div
                    key={stage.id}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl text-center transition-all"
                    style={{
                      background:
                        status === "done" ? "rgba(16,185,129,0.08)"
                        : status === "running" ? "rgba(6,182,212,0.08)"
                        : status === "error" ? "rgba(239,68,68,0.08)"
                        : "rgba(255,255,255,0.02)",
                      border:
                        status === "done" ? "1px solid rgba(16,185,129,0.2)"
                        : status === "running" ? "1px solid rgba(6,182,212,0.2)"
                        : status === "error" ? "1px solid rgba(239,68,68,0.2)"
                        : "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    {status === "done" ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : status === "running" ? (
                      <Loader2 size={14} className="text-cyan-400 animate-spin" />
                    ) : status === "error" ? (
                      <AlertCircle size={14} className="text-red-400" />
                    ) : (
                      <Icon size={14} className="text-white/20" />
                    )}
                    <span className="text-3xs font-medium"
                      style={{
                        color: status === "done" ? "#34d399"
                          : status === "running" ? "#67e8f9"
                          : status === "error" ? "#f87171"
                          : "rgba(255,255,255,0.25)",
                      }}>
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div className="rounded-xl p-4 flex items-start gap-3"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-400">Pipeline error</p>
                <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Video output */}
          {videoUrl ? (
            <div className="glass rounded-2xl overflow-hidden">
              <div className="relative">
                <video
                  // Swap source to the final rendered MP4 once the worker
                  // finishes; until then we show the first source clip.
                  src={mergedVideoUrl ?? videoUrl}
                  key={mergedVideoUrl ?? videoUrl}
                  controls
                  autoPlay
                  muted
                  playsInline
                  className="w-full aspect-video bg-black"
                />
                {/* Preview badge — make it unmistakable that the displayed clip
                    is NOT the finished video until the merged URL lands. */}
                {!mergedVideoUrl && (
                  <span
                    className="absolute top-2 left-2 text-3xs font-bold uppercase tracking-wider px-2 py-1 rounded-md flex items-center gap-1"
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      color: mergeStatus === "failed" ? "#fca5a5" : "#67e8f9",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    Preview · first clip
                  </span>
                )}
              </div>

              {/* Honest render-status strip — driven by the worker, not the
                  SSE stream. "Complete" only appears with a real merged URL. */}
              {mergeStatus === "done" && mergedVideoUrl ? (
                <div className="px-4 py-2.5 border-t border-white/5">
                  <p className="text-2xs text-emerald-400/90 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={12} />
                    Final video ready — footage, captions &amp; audio baked into one MP4
                  </p>
                </div>
              ) : mergeStatus === "failed" ? (
                <div className="px-4 py-2.5 border-t border-white/5"
                  style={{ background: "rgba(239,68,68,0.06)" }}>
                  <p className="text-2xs text-red-300 flex items-center gap-1.5 font-semibold">
                    <AlertCircle size={12} />
                    Render failed — showing the first source clip as a preview
                  </p>
                  {mergeError && (
                    <p className="text-3xs text-red-400/70 mt-1 font-mono break-words leading-relaxed">
                      {mergeError.length > 240 ? mergeError.slice(0, 240) + "…" : mergeError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-4 py-2.5 border-t border-white/5">
                  <p className="text-2xs text-cyan-300/90 flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Rendering final video… this preview will swap to the finished MP4 when ready
                  </p>
                </div>
              )}
              {videoAttribution && (
                <div className="px-4 py-2 border-t border-white/5">
                  <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
                    Stock footage ·{" "}
                    <span className="text-white/60 normal-case font-normal">
                      {videoAttribution}
                    </span>
                  </p>
                </div>
              )}
              {(audioUrl || musicUrl) && (
                <div className="px-4 py-3 border-t border-white/5 space-y-2.5">
                  {audioUrl && (
                    <div>
                      <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5 flex items-center gap-1.5">
                        <Mic size={10} className="text-cyan-400" /> Narration (ElevenLabs)
                      </p>
                      <audio src={audioUrl} controls className="w-full h-8" />
                    </div>
                  )}
                  {musicUrl && (
                    <div>
                      <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5 flex items-center gap-1.5">
                        <Music size={10} className="text-emerald-400" /> Music track
                        {musicTrack && (
                          <span className="text-white/60 normal-case font-normal ml-1">· {musicTrack}</span>
                        )}
                      </p>
                      <audio src={musicUrl} controls className="w-full h-8" />
                    </div>
                  )}
                </div>
              )}
              {seo && (
                <div className="px-4 py-4 border-t border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold flex items-center gap-1.5">
                      <Wand2 size={10} className="text-fuchsia-400" /> Post copy · ready to upload
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-6 text-2xs text-white/60 hover:text-white"
                      onClick={() => {
                        const text =
                          `${seo.title}\n\n${seo.description}\n\n` +
                          seo.hashtags.map((h) => `#${h}`).join(" ");
                        navigator.clipboard.writeText(text);
                      }}
                    >
                      <Copy size={11} />
                      Copy all
                    </Button>
                  </div>
                  <div>
                    <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">
                      Title
                    </p>
                    <p className="text-sm text-white/90 leading-snug">{seo.title}</p>
                  </div>
                  <div>
                    <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1">
                      Description
                    </p>
                    <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">
                      {seo.description}
                    </p>
                  </div>
                  <div>
                    <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5">
                      Hashtags · {seo.hashtags.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {seo.hashtags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-2xs py-0 px-1.5 h-5 border-white/10 bg-white/[0.03] text-white/70 font-normal"
                        >
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="p-4 flex gap-2">
                <a href={mergedVideoUrl ?? videoUrl} download>
                  <Button variant="gradient-cyan" size="sm" className="gap-1.5">
                    <Download size={13} />
                    {mergedVideoUrl ? "Download MP4" : "Download preview clip"}
                  </Button>
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleCopyLink}
                >
                  <Copy size={13} />
                  Copy Link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-white/40 ml-auto"
                  onClick={() => {
                    setVideoUrl(null);
                    setAudioUrl(null);
                    setMusicUrl(null);
                    setMusicTrack(null);
                    setVideoAttribution(null);
                    setSeo(null);
                    setMergeStatus(null);
                    setMergedVideoUrl(null);
                    setMergeError(null);
                    setJobId(null);
                    setProgress(0);
                    setStatusLabel("");
                    setPrompt("");
                    setStages({ script: "pending", voice: "pending", footage: "pending", render: "pending" });
                    setLogs([]);
                  }}
                >
                  <RefreshCw size={13} />
                  New
                </Button>
              </div>
            </div>
          ) : !running && progress === 0 ? (
            /* Placeholder */
            <div className="rounded-2xl flex flex-col items-center justify-center py-12 gap-3"
              style={{ border: "1px dashed rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.01)" }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)" }}>
                <Play size={18} className="text-cyan-500/50 ml-0.5" />
              </div>
              <p className="text-sm text-white/25">Your video will appear here</p>
              <p className="text-xs text-white/15">Enter a prompt and click Generate</p>
            </div>
          ) : null}

          {/* Log console */}
          <div className="glass rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowLogs((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/50">Pipeline Logs</span>
                {logs.length > 0 && (
                  <span className="text-3xs px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>
                    {logs.length}
                  </span>
                )}
              </div>
              {showLogs ? (
                <ChevronUp size={13} className="text-white/30" />
              ) : (
                <ChevronDown size={13} className="text-white/30" />
              )}
            </button>

            {showLogs && (
              <div
                ref={logsRef}
                className="overflow-y-auto px-4 pb-4 font-mono text-3xs leading-relaxed space-y-0.5"
                style={{ maxHeight: 260, borderTop: "1px solid rgba(255,255,255,0.05)" }}
              >
                {logs.length === 0 ? (
                  <p className="text-white/20 py-3 text-center">No logs yet</p>
                ) : (
                  logs.map((entry, i) => (
                    <div key={i} className="flex gap-2"
                      style={{
                        color:
                          entry.level === "error" ? "#f87171"
                          : entry.level === "warn" ? "#fbbf24"
                          : entry.level === "success" ? "#34d399"
                          : "rgba(148,163,184,0.7)",
                      }}>
                      <span className="text-white/20 flex-shrink-0 select-none">
                        {entry.level === "error" ? "✗"
                          : entry.level === "success" ? "✓"
                          : entry.level === "warn" ? "⚠"
                          : "›"}
                      </span>
                      <span>{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
