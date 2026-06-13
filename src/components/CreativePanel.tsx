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
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Download,
  ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { captureFallback } from "@/lib/observability";
import { useSupabase } from "@/components/SupabaseProvider";
import type { DbContentCreative } from "@/lib/types";

const GEN_STEP_LABEL = "Generating background, compositing assets…";

const HIERARCHY_LABEL: Record<string, string> = {
  founder_led: "Founder-led",
  brand_led: "Brand-led",
  data_led: "Data-led",
  quote_led: "Quote-led",
  product_led: "Product-led",
};

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
  confidence: number;
  confidence_components?: { assets: number; model: number; opportunity: number; platform: number };
  eligible_hierarchies?: string[];
  forced_brand_led?: boolean;
  visual_concept: string;
  visual_rationale: string;
  headline: string;
  cta: string;
  logo_usage?: { use: boolean; placement?: string; reason: string };
  headshot_usage?: { use: boolean; placement?: string; reason: string };
  company_name_usage?: { use: boolean; name?: string; treatment: string };
  founder_name_usage?: { use: boolean; name?: string; treatment: string };
  aspect_ratio?: string;
}

export function CreativePanel({
  contentItemId,
  brandId,
}: {
  contentItemId: string;
  brandId?: string | null;
}) {
  const supabase = useSupabase();
  const [creatives, setCreatives] = useState<DbContentCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null); // "approve" | "reject"
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
        <p className="text-xs text-white/40">
          No creative yet. <strong>Generate Creative</strong> composes a
          reviewable strategy brief — hierarchy, concept, copy, and asset usage.
        </p>
      ) : (
        <BriefPreview
          creative={active}
          reviewing={reviewing}
          regenerating={regenerating}
          onApprove={() => void handleReview(active.id, "approve")}
          onReject={() => void handleReview(active.id, "reject")}
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
    </div>
  );
}

function BriefPreview({
  creative,
  reviewing,
  regenerating,
  onApprove,
  onReject,
  onRegenerate,
}: {
  creative: DbContentCreative;
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

  return (
    <div>
      {/* Generating spinner (Phase C: approved → generating → ready) */}
      {(creative.status === "approved" || creative.status === "generating") && (
        <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center justify-center gap-2">
          <Loader2 size={20} className="text-fuchsia-400 animate-spin" />
          <p className="text-xs text-white/60">{GEN_STEP_LABEL}</p>
          <p className="text-3xs text-white/30">Imagen background + asset compositing, ~30–60s.</p>
        </div>
      )}

      {/* Ready image (Phase C output) */}
      {creative.status === "ready" && creative.image_url && (
        <div className="mb-4">
          <div className="rounded-xl overflow-hidden border border-white/[0.06]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={creative.image_url} alt="Generated creative" className="w-full" />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <a href={creative.image_url} target="_blank" rel="noreferrer" download>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-2xs">
                <Download size={11} /> Download
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
            {creative.regen_count > 0 && (
              <span className="text-3xs text-white/30">regen ×{creative.regen_count}</span>
            )}
          </div>
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
