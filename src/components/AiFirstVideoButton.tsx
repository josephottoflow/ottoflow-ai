"use client";

/**
 * AiFirstVideoButton — Ottoflow Video V1 trigger.
 *
 * Drops next to the CreativePanel on a content item. Turns the item's existing
 * creative brief (tension/metaphor) into a brand-aligned video: POSTs to
 * /api/video/generate, then routes to /video/[jobId] where render_jobs +
 * scene_generations stream status via Supabase Realtime (migration 007).
 *
 * No live render here — the route enqueues; the worker generates + composes
 * (and only produces real clips once SEEDANCE_API_KEY + the Railway RAM bump
 * are provisioned). Until then the job will surface its state on the detail
 * page like any other render job.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Clapperboard, Loader2 } from "lucide-react";

interface AiFirstVideoButtonProps {
  brandId: string;
  contentItemId: string;
  /** Disable until a creative brief exists for this item. */
  disabled?: boolean;
}

export function AiFirstVideoButton({
  brandId,
  contentItemId,
  disabled,
}: AiFirstVideoButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, contentItemId, platform: "linkedin" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        renderJobId?: string;
        error?: string;
      };
      if (!res.ok || !json.renderJobId) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      router.push(`/video/${json.renderJobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        onClick={onClick}
        disabled={disabled || loading}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Clapperboard className="h-4 w-4" />
        )}
        {loading ? "Starting video…" : "Generate Video (LinkedIn)"}
      </Button>
      {error && <p className="text-3xs text-red-400">{error}</p>}
    </div>
  );
}
