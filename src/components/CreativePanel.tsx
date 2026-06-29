"use client";

/**
 * Creative Panel (Creative Orchestrator Phase B) — lives on the content item
 * detail page.
 *
 * Workflow it renders:
 *   Generate Creative → Creative Brief → Brief Preview → Approve Brief
 *   → [Phase C: Generate Image → Composite Assets → Ready]
 *
 * The Brief Preview is the CREATIVE APPROVAL GATE: the user reviews the
 * strategy (hierarchy, confidence, concept, rationale, copy, asset usage)
 * BEFORE any image-generation cost is incurred. Approve moves the creative
 * to 'approved'; reject archives the brief so a fresh one can be composed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  Lock,
  Maximize2,
  Palette,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { captureFallback } from "@/lib/observability";
import { useSupabase } from "@/components/SupabaseProvider";
import type { DbContentCreative } from "@/lib/types";
import { toAppMediaUrl } from "@/lib/media-url";

const GEN_STEP_LABEL = "Generating background, compositing assets…";

const HIERARCHY_LABEL: Record<string, string> = {
  founder_led: "Founder-led",
  brand_led: "Brand-led",
  data_led: "Data-led",
  quote_led: "Quote-led",
  product_led: "Product-led",
};

// The four hierarchies the v1 engine selects from — shown in the asset-
// readiness block with a lock/unlock state per brief.eligible_hierarchies.
const READINESS_HIERARCHIES = ["founder_led", "data_led", "quote_led", "brand_led"] as const;

// Platform-native pixel canvases (mirrors compositor CANVAS_BY_PLATFORM) — used
// by the publishing preview to show exactly how the creative will post.
const PLATFORM_DIMS: Record<string, { w: number; h: number }> = {
  linkedin: { w: 1200, h: 627 },
  facebook: { w: 1200, h: 630 },
  twitter: { w: 1600, h: 900 },
  instagram: { w: 1080, h: 1350 },
  blog: { w: 1600, h: 900 },
  email: { w: 1200, h: 630 },
};
const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  twitter: "X / Twitter",
  instagram: "Instagram",
  blog: "Blog",
  email: "Email",
};

/** Post copy threaded in for the publishing preview (optional). */
export interface PostCopy {
  title?: string | null;
  body?: string | null;
  cta?: string | null;
  hashtags?: string[] | null;
}

const STATUS_META: Record<
  DbContentCreative["status"],
  { label: string; variant: "secondary" | "success" | "info" | "warning" | "destructive" }
> = {
  brief_ready: { label: "Awaiting review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  generating: { label: "Generating", variant: "info" },
  ready: { label: "Ready", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  rejected: { label: "Rejected", variant: "secondary" },
};

interface BriefView {
  hierarchy: string;
  visual_tension?: string;
  visual_metaphor?: string;
  confidence: number;
  confidence_components?: { assets: number; model: number; opportunity: number; platform: number };
  eligible_hierarchies?: string[];
  forced_brand_led?: boolean;
  visual_concept: string;
  visual_rationale: string;
  headline: string;
  subheadline?: string;
  cta: string;
  logo_usage?: { use: boolean; placement?: string; reason: string };
  headshot_usage?: { use: boolean; placement?: string; reason: string };
  company_name_usage?: { use: boolean; name?: string; treatment: string };
  founder_name_usage?: { use: boolean; name?: string; treatment: string };
  expert_name_usage?: { use: boolean; name?: string; treatment: string };
  assets_available?: { logo: boolean; founder_headshot: boolean };
  palette?: { primary?: string; secondary?: string; accent?: string };
  aspect_ratio?: string;
}

export function CreativePanel({
  contentItemId,
  brandId,
  post,
}: {
  contentItemId: string;
  brandId?: string | null;
  /** Post copy for the in-workflow publishing preview (optional). */
  post?: PostCopy | null;
}) {
  const supabase = useSupabase();
  const [creatives, setCreatives] = useState<DbContentCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null); // "approve" | "reject"
  const [confirmReject, setConfirmReject] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/content/${contentItemId}/creative`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { creatives: DbContentCreative[] };
      setCreatives(body.creatives ?? []);
    } catch (err) {
      captureFallback("creative.client_list_failed", err, { contentItemId });
    } finally {
      setLoading(false);
    }
  }, [contentItemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: watch this item's creatives flip through the Phase C pipeline
  // (approved → generating → ready/failed) without polling. Scoped by
  // content_item_id; RLS authorizes the channel via the Clerk JWT.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`creatives:${contentItemId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_creatives",
          filter: `content_item_id=eq.${contentItemId}`,
        },
        (payload) => {
          const row = payload.new as DbContentCreative;
          if (!row?.id) return;
          setCreatives((prev) => {
            const i = prev.findIndex((c) => c.id === row.id);
            if (i === -1) return [row, ...prev];
            const next = [...prev];
            next[i] = row;
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, contentItemId]);

  const active = creatives.find((c) =>
    ["brief_ready", "approved", "generating", "ready", "failed"].includes(c.status),
  );

  // Polling fallback: Realtime on content tables is unreliable, so while a
  // creative is actively generating (approved → generating) poll every 3s
  // until it lands on a terminal state. The ready image then appears in the
  // same workflow with NO manual refresh (P4/P8 workspace requirement).
  useEffect(() => {
    const s = active?.status;
    if (s !== "approved" && s !== "generating") return;
    let stopped = false;
    const iv = setInterval(() => {
      if (!stopped) void refresh();
    }, 3000);
    const safety = setTimeout(() => {
      stopped = true;
      clearInterval(iv);
    }, 180_000);
    return () => {
      stopped = true;
      clearInterval(iv);
      clearTimeout(safety);
    };
  }, [active?.status, refresh]);

  // Spec #1: every generated post immediately produces a creative strategy.
  // Once the initial load settles with no creative on file, compose one
  // automatically (one Gemini concept call, no image cost). Fires once per
  // mount; a rejected-only history is left alone (the user opted out).
  const autoComposed = useRef(false);
  useEffect(() => {
    if (loading || autoComposed.current) return;
    if (creatives.length === 0 && !composing) {
      autoComposed.current = true;
      void handleCompose();
    }
    // handleCompose is a stable per-render closure; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, creatives.length, composing]);

  async function handleRegenerate(creativeId: string) {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/creatives/${creativeId}/regenerate`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const updated = (body as { creative: DbContentCreative }).creative;
      if (updated?.id) {
        setCreatives((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      captureFallback("creative.client_regenerate_failed", err, { contentItemId });
    } finally {
      setRegenerating(false);
    }
  }
  void brandId; // reserved for future cross-brand creative views

  async function handleCompose() {
    if (composing) return;
    setComposing(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${contentItemId}/creative`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setCreatives((prev) => [(body as { creative: DbContentCreative }).creative, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      captureFallback("creative.client_compose_failed", err, { contentItemId });
    } finally {
      setComposing(false);
    }
  }

  async function handleReview(creativeId: string, action: "approve" | "reject") {
    if (reviewing) return;
    setReviewing(action);
    setError(null);
    try {
      const res = await fetch(`/api/creatives/${creativeId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const updated = (body as { creative: DbContentCreative }).creative;
      setCreatives((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      captureFallback("creative.client_review_failed", err, { contentItemId, action });
    } finally {
      setReviewing(null);
    }
  }

  return (
    <div className="glass rounded-2xl p-6 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-fuchsia-400" />
          <h2 className="text-sm font-semibold text-white">Creative</h2>
          {active && (
            <Badge variant={STATUS_META[active.status].variant} className="text-3xs">
              {STATUS_META[active.status].label}
            </Badge>
          )}
        </div>
        {!active && !loading && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-2xs"
            onClick={handleCompose}
            disabled={composing}
          >
            {composing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {composing ? "Composing brief…" : "Generate Creative"}
          </Button>
        )}
      </div>
      <p className="text-2xs text-white/40 mb-4">
        Brief → review → approve → image. The brief is reviewed <em>before</em>{" "}
        any image-generation cost is incurred.
      </p>

      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-2xs text-rose-300/90 border border-rose-500/20 bg-rose-500/5">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-white/35 italic">Loading…</p>
      ) : !active ? (
        composing ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center justify-center gap-2">
            <Loader2 size={18} className="text-fuchsia-400 animate-spin" />
            <p className="text-xs text-white/60">Composing the creative strategy…</p>
            <p className="text-3xs text-white/30">
              Hierarchy, concept, copy &amp; asset usage — no image generated yet.
            </p>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            No creative yet. <strong>Generate Creative</strong> composes a
            reviewable strategy brief — hierarchy, concept, copy, and asset usage.
          </p>
        )
      ) : (
        <BriefPreview
          creative={active}
          contentItemId={contentItemId}
          post={post ?? null}
          reviewing={reviewing}
          regenerating={regenerating}
          onApprove={() => void handleReview(active.id, "approve")}
          onReject={() => setConfirmReject(true)}
          onRegenerate={() => void handleRegenerate(active.id)}
        />
      )}

      {/* Rejected briefs collapse into a one-line history so the panel stays scannable */}
      {creatives.some((c) => c.status === "rejected") && (
        <div className="mt-4 pt-3 border-t border-white/[0.04]">
          <p className="text-3xs uppercase tracking-wider text-white/30 mb-1.5">
            Rejected briefs
          </p>
          {creatives
            .filter((c) => c.status === "rejected")
            .map((c) => (
              <p key={c.id} className="text-2xs text-white/35">
                {HIERARCHY_LABEL[c.creative_hierarchy]} ·{" "}
                {Math.round(c.creative_confidence * 100)}% confidence ·{" "}
                {new Date(c.created_at).toLocaleDateString()}
              </p>
            ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmReject}
        title="Reject this brief?"
        message="The creative strategy will be archived. You can compose a fresh brief afterward. No image is generated for a rejected brief."
        confirmLabel="Reject brief"
        busy={reviewing === "reject"}
        onConfirm={() => {
          if (active) void handleReview(active.id, "reject");
          setConfirmReject(false);
        }}
        onCancel={() => setConfirmReject(false)}
      />
    </div>
  );
}

function BriefPreview({
  creative,
  contentItemId,
  post,
  reviewing,
  regenerating,
  onApprove,
  onReject,
  onRegenerate,
}: {
  creative: DbContentCreative;
  contentItemId: string;
  post?: PostCopy | null;
  reviewing: string | null;
  regenerating: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}) {
  const brief = creative.creative_brief as unknown as BriefView;
  const confPct = Math.round(creative.creative_confidence * 100);
  const confColor =
    confPct >= 70 ? "text-emerald-400" : confPct >= 55 ? "text-amber-400" : "text-rose-400";

  // Brand color system (#5): swatches when configured, warning when not.
  const palette = brief.palette ?? {};
  const swatches = (
    [
      ["Primary", palette.primary],
      ["Secondary", palette.secondary],
      ["Accent", palette.accent],
    ] as const
  ).filter(([, hex]) => !!hex) as Array<readonly [string, string]>;

  // Asset readiness (#6). assets_available is authoritative on new briefs;
  // fall back to usage flags for briefs composed before that field existed.
  const hasLogo = brief.assets_available?.logo ?? !!brief.logo_usage?.use;
  const hasHeadshot =
    brief.assets_available?.founder_headshot ?? !!brief.headshot_usage?.use;
  const eligible = brief.eligible_hierarchies ?? [brief.hierarchy];

  return (
    <div>
      {/* Approved — strategy locked. Image generation is a SEPARATE later step
          (Phase C / render worker); approval does not depend on the worker
          being online, so this is a calm "deferred" state, not a spinner. */}
      {creative.status === "approved" && (
        <div className="mb-4 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4 flex items-start gap-3">
          <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-white/80 font-medium">
              Strategy approved &amp; locked
            </p>
            <p className="text-3xs text-white/45 mt-0.5 flex items-center gap-1">
              <Clock size={9} /> Image generation is a separate step — it runs on the
              render worker and will produce the creative when available.
            </p>
          </div>
        </div>
      )}

      {/* Generating spinner — only once the worker has actually picked the job
          up and flipped the row to 'generating'. */}
      {creative.status === "generating" && (
        <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center justify-center gap-2">
          <Loader2 size={20} className="text-fuchsia-400 animate-spin" />
          <p className="text-xs text-white/60">{GEN_STEP_LABEL}</p>
          <p className="text-3xs text-white/30">Imagen background + asset compositing, ~30–60s.</p>
        </div>
      )}

      {/* Ready image (Phase C output) — large preview + actions + publishing
          preview, all in the same workflow (no navigation to /content/[id]). */}
      {creative.status === "ready" && creative.image_url && (
        <div className="mb-4">
          <p className="text-3xs uppercase tracking-wider text-white/35 mb-1.5">Creative Image</p>
          <div className="rounded-xl overflow-hidden border border-white/[0.06]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toAppMediaUrl(creative.image_url) ?? undefined} alt="Generated creative" className="w-full" />
          </div>
          {/* CTA row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <a href={toAppMediaUrl(creative.image_url) ?? undefined} target="_blank" rel="noreferrer" download>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-2xs">
                <Download size={11} /> Download
              </Button>
            </a>
            <a href={toAppMediaUrl(creative.image_url) ?? undefined} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-2xs">
                <Maximize2 size={11} /> Open full size
              </Button>
            </a>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 h-7 text-2xs"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Regenerate
            </Button>
            <a href={`/content/${contentItemId}`}>
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-2xs">
                <ExternalLink size={11} /> Open post detail
              </Button>
            </a>
            {creative.regen_count > 0 && (
              <span className="text-3xs text-white/30">regen ×{creative.regen_count}</span>
            )}
          </div>

          <PublishingPreview creative={creative} post={post} />
        </div>
      )}
      {creative.status === "failed" && (
        <div className="mb-4">
          {creative.generation_error && (
            <div className="mb-2 rounded-md px-3 py-2 text-2xs text-rose-300/90 border border-rose-500/20 bg-rose-500/5">
              Generation failed: {creative.generation_error}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-2xs"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            Retry generation
          </Button>
        </div>
      )}

      {/* ── Hierarchy + Confidence ── */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div>
          <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">
            Creative Hierarchy
          </p>
          <div className="flex items-center gap-1.5">
            <Badge variant="purple" className="text-2xs">
              {HIERARCHY_LABEL[brief.hierarchy] ?? brief.hierarchy}
            </Badge>
            {brief.forced_brand_led && (
              <span className="text-3xs text-amber-300/80" title="Confidence fell below 0.55 — brand-led fallback applied">
                fallback
              </span>
            )}
          </div>
          {brief.eligible_hierarchies && (
            <p className="text-3xs text-white/30 mt-1">
              Eligible: {brief.eligible_hierarchies.map((h) => HIERARCHY_LABEL[h] ?? h).join(", ")}
            </p>
          )}
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">
            Creative Confidence
          </p>
          <p className={`text-lg font-bold ${confColor}`}>{confPct}%</p>
          {brief.confidence_components && (
            <p className="text-3xs text-white/30">
              assets {fmt(brief.confidence_components.assets)} · model{" "}
              {fmt(brief.confidence_components.model)} · opportunity{" "}
              {fmt(brief.confidence_components.opportunity)} · platform{" "}
              {fmt(brief.confidence_components.platform)}
            </p>
          )}
        </div>
        {brief.aspect_ratio && (
          <div className="ml-auto text-right">
            <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">Format</p>
            <p className="text-2xs text-white/55 flex items-center gap-1 justify-end">
              <ImageIcon size={10} /> {brief.aspect_ratio} · {creative.platform}
            </p>
          </div>
        )}
      </div>

      {/* ── Asset readiness — what's on file + which hierarchies unlock ── */}
      <div
        className="rounded-lg p-3 mb-3"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <p className="text-3xs uppercase tracking-wider text-white/35 mb-2">Asset Readiness</p>
        <div className="flex items-center gap-4 mb-2.5">
          <ReadinessChip label="Logo" present={hasLogo} />
          <ReadinessChip label="Founder Headshot" present={hasHeadshot} />
        </div>
        <p className="text-3xs uppercase tracking-wider text-white/30 mb-1.5">Hierarchies unlocked</p>
        <div className="flex flex-wrap gap-1.5">
          {READINESS_HIERARCHIES.map((h) => {
            const unlocked = eligible.includes(h);
            const isChosen = brief.hierarchy === h;
            return (
              <span
                key={h}
                className="text-3xs px-2 py-1 rounded-full flex items-center gap-1"
                style={{
                  background: unlocked
                    ? isChosen
                      ? "rgba(168,85,247,0.18)"
                      : "rgba(16,185,129,0.10)"
                    : "rgba(255,255,255,0.03)",
                  color: unlocked
                    ? isChosen
                      ? "rgb(216,180,254)"
                      : "rgb(110,231,183)"
                    : "rgba(255,255,255,0.3)",
                  border: isChosen ? "1px solid rgba(168,85,247,0.35)" : "1px solid transparent",
                }}
              >
                {unlocked ? <Check size={9} /> : <Lock size={9} />}
                {HIERARCHY_LABEL[h]}
                {isChosen && <span className="opacity-70">· chosen</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Brand color system — palette preview or fallback warning (#5) ── */}
      <div className="mb-3">
        <p className="text-3xs uppercase tracking-wider text-white/35 mb-1.5">Brand Colors</p>
        {swatches.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {swatches.map(([label, hex]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-md border border-white/10 flex-shrink-0"
                  style={{ background: hex }}
                />
                <span className="text-3xs text-white/45">
                  {label} <span className="text-white/30 font-mono">{hex}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md px-3 py-2 text-2xs text-amber-300/90 border border-amber-500/20 bg-amber-500/[0.06] flex items-center gap-1.5">
            <AlertTriangle size={11} className="flex-shrink-0" />
            Brand colors not configured. Creative will use a fallback palette.
          </div>
        )}
      </div>

      {/* ── Topic → Visual Metaphor (P4 Phase 1) ── */}
      {(brief.visual_tension || brief.visual_metaphor) && (
        <div
          className="rounded-lg p-3 mb-3"
          style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.18)" }}
        >
          {brief.visual_tension && (
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-3xs uppercase tracking-wider text-white/35">Visual Tension</p>
              <Badge variant="purple" className="text-3xs">{brief.visual_tension}</Badge>
            </div>
          )}
          {brief.visual_metaphor && (
            <>
              <p className="text-3xs uppercase tracking-wider text-white/35 mb-0.5">Visual Metaphor</p>
              <p className="text-xs text-white/80 leading-relaxed italic">{brief.visual_metaphor}</p>
            </>
          )}
        </div>
      )}

      {/* ── Concept + Rationale ── */}
      <Field label="Visual Concept">{brief.visual_concept}</Field>
      <Field label="Visual Rationale">{brief.visual_rationale}</Field>

      {/* ── Copy ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div
          className="rounded-lg p-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">Headline</p>
          <p className="text-sm font-semibold text-white leading-snug">“{brief.headline}”</p>
          {brief.subheadline && (
            <p className="text-2xs text-white/55 mt-1 leading-snug">{brief.subheadline}</p>
          )}
        </div>
        <div
          className="rounded-lg p-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">CTA</p>
          <p className="text-sm text-white/85">{brief.cta}</p>
        </div>
      </div>

      {/* ── Asset + identity usage (deterministic facts) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
        <UsageRow label="Logo Usage" usage={brief.logo_usage} />
        <UsageRow label="Headshot Usage" usage={brief.headshot_usage} />
        <NameRow label="Company Name Usage" usage={brief.company_name_usage} />
        <NameRow label="Founder Name Usage" usage={brief.founder_name_usage} />
        {brief.expert_name_usage?.use && (
          <NameRow label="Expert Name Usage" usage={brief.expert_name_usage} />
        )}
      </div>

      {/* ── The gate ── */}
      {creative.status === "brief_ready" && (
        <div className="flex items-center gap-2 pt-3 border-t border-white/[0.05]">
          <Button
            size="sm"
            className="gap-1.5 h-8 text-2xs bg-emerald-600 hover:bg-emerald-500 text-white"
            onClick={onApprove}
            disabled={reviewing != null}
          >
            {reviewing === "approve" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Approve Brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-2xs border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
            onClick={onReject}
            disabled={reviewing != null}
          >
            {reviewing === "reject" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ThumbsDown size={12} />
            )}
            Reject
          </Button>
          <span className="text-3xs text-white/30 ml-1">
            Image generation starts only after approval.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * In-workflow publishing preview (preview only — no publishing actions). Shows
 * the creative's platform, native pixel dimensions, a thumbnail, and the post
 * copy as it will appear, so the user never has to leave the workspace.
 */
function PublishingPreview({
  creative,
  post,
}: {
  creative: DbContentCreative;
  post?: PostCopy | null;
}) {
  const platform = creative.platform;
  const dims = PLATFORM_DIMS[platform] ?? null;
  const title = post?.title?.trim() ?? "";
  const bodyFull = (post?.body ?? "").trim();
  const body = bodyFull.length > 220 ? `${bodyFull.slice(0, 220)}…` : bodyFull;
  const cta = post?.cta?.trim() ?? "";
  const tags = post?.hashtags ?? [];
  const hasCopy = !!(title || body || cta || tags.length);
  return (
    <div className="mt-4 pt-3 border-t border-white/[0.05]">
      <p className="text-3xs uppercase tracking-wider text-white/35 mb-2">Publishing Preview</p>
      <div
        className="rounded-xl p-3"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="info" className="text-3xs">
            {PLATFORM_LABEL[platform] ?? platform}
          </Badge>
          {dims && (
            <span className="text-3xs text-white/40">
              {dims.w}×{dims.h}px
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {creative.image_url && (
            <div
              className="w-28 flex-shrink-0 rounded-md overflow-hidden border border-white/10"
              style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : "16 / 9" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={toAppMediaUrl(creative.image_url) ?? undefined} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {hasCopy ? (
              <>
                {title && (
                  <p className="text-2xs font-semibold text-white/85 mb-0.5 leading-snug">{title}</p>
                )}
                {body && (
                  <p className="text-2xs text-white/65 leading-relaxed whitespace-pre-wrap">{body}</p>
                )}
                {cta && <p className="text-2xs text-white/50 mt-1">{cta}</p>}
                {tags.length > 0 && (
                  <p className="text-2xs text-violet-300/70 mt-1 break-words">
                    {tags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-2xs text-white/35 italic">
                Post copy preview unavailable here — open the post detail for the full copy.
              </p>
            )}
          </div>
        </div>
        <p className="text-3xs text-white/25 mt-2">
          Preview only — publishing is managed from the post detail page.
        </p>
      </div>
    </div>
  );
}

function ReadinessChip({ label, present }: { label: string; present: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-2xs">
      {present ? (
        <CheckCircle2 size={12} className="text-emerald-400" />
      ) : (
        <X size={12} className="text-white/30" />
      )}
      <span className={present ? "text-white/70" : "text-white/40"}>{label}</span>
      <span className={present ? "text-emerald-400/80" : "text-white/30"}>
        {present ? "✓" : "Missing"}
      </span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-3xs uppercase tracking-wider text-white/35 mb-1">{label}</p>
      <p className="text-xs text-white/75 leading-relaxed">{children}</p>
    </div>
  );
}

function UsageRow({
  label,
  usage,
}: {
  label: string;
  usage?: { use: boolean; placement?: string; reason: string };
}) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        {usage?.use ? (
          <Check size={10} className="text-emerald-400 flex-shrink-0" />
        ) : (
          <X size={10} className="text-white/30 flex-shrink-0" />
        )}
        <p className="text-3xs uppercase tracking-wider text-white/45 font-semibold">{label}</p>
        {usage?.use && usage.placement && (
          <span className="text-3xs text-white/40 ml-auto">{usage.placement.replace(/_/g, " ")}</span>
        )}
      </div>
      <p className="text-2xs text-white/50 leading-relaxed">{usage?.reason ?? "—"}</p>
    </div>
  );
}

function NameRow({
  label,
  usage,
}: {
  label: string;
  usage?: { use: boolean; name?: string; treatment: string };
}) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        {usage?.use ? (
          <Check size={10} className="text-emerald-400 flex-shrink-0" />
        ) : (
          <X size={10} className="text-white/30 flex-shrink-0" />
        )}
        <p className="text-3xs uppercase tracking-wider text-white/45 font-semibold">{label}</p>
        {usage?.use && usage.name && (
          <span className="text-3xs text-white/55 ml-auto truncate max-w-[40%]" title={usage.name}>
            {usage.name}
          </span>
        )}
      </div>
      <p className="text-2xs text-white/50 leading-relaxed">{usage?.treatment ?? "—"}</p>
    </div>
  );
}

function fmt(v: number): string {
  return v.toFixed(2);
}
