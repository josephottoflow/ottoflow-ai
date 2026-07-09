"use client";

/**
 * Brand Assets section (Creative Orchestrator Phase A).
 *
 * Self-contained: fetches the asset list from GET /api/brands/[id]/assets on
 * mount, uploads via POST (multipart), deletes via DELETE. Renders on the
 * brand detail page regardless of research state — the asset library doesn't
 * depend on the brand profile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageIcon,
  Loader2,
  Lock,
  Trash2,
  Upload,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { captureFallback } from "@/lib/observability";
import { toAppMediaUrl } from "@/lib/media-url";
import type { BrandAssetKind, DbBrandAsset } from "@/lib/types";

const KIND_META: Record<
  BrandAssetKind,
  { label: string; icon: typeof ImageIcon; hint: string }
> = {
  logo: { label: "Logo", icon: ImageIcon, hint: "Transparent PNG works best" },
  founder_headshot: {
    label: "Founder headshot",
    icon: User,
    hint: "Label it with the founder's name (e.g. “Jane Doe — Founder”)",
  },
  team_headshot: {
    label: "Team headshot",
    icon: Users,
    hint: "Stored for future use — not yet placed by v1 creatives",
  },
};

export function BrandAssets({ brandId }: { brandId: string }) {
  const [assets, setAssets] = useState<DbBrandAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<BrandAssetKind>("logo");
  const [label, setLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DbBrandAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/brands/${brandId}/assets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { assets: DbBrandAsset[] };
      setAssets(body.assets ?? []);
    } catch (err) {
      captureFallback("brand_assets.client_list_failed", err, { brandId });
      setError("Couldn't load assets.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      if (label.trim()) form.set("label", label.trim());
      const res = await fetch(`/api/brands/${brandId}/assets`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? `Upload failed (HTTP ${res.status})`,
        );
      }
      setAssets((prev) => [(body as { asset: DbBrandAsset }).asset, ...prev]);
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      captureFallback("brand_assets.client_upload_failed", err, { brandId, kind });
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    const asset = pendingDelete;
    if (!asset || deleting) return;
    setDeleting(true);
    setError(null);
    const prev = assets;
    setAssets((a) => a.filter((x) => x.id !== asset.id));
    try {
      const res = await fetch(`/api/brands/${brandId}/assets/${asset.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPendingDelete(null);
    } catch (err) {
      captureFallback("brand_assets.client_delete_failed", err, { brandId, assetId: asset.id });
      setAssets(prev); // restore on failure
      setError("Delete failed — try again.");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <ImageIcon size={14} className="text-[#F2A863]" />
        <h2 className="text-sm font-bold text-white">Brand Assets</h2>
        <span className="text-3xs text-white/40 font-medium">({assets.length})</span>
      </div>
      <p className="text-2xs text-white/40 mb-4 flex items-center gap-1.5">
        <Lock size={10} className="flex-shrink-0" />
        Originals are locked: never modified, never sent to AI models. Creatives
        only place them — resize, crop, position.
      </p>

      {/* Upload row */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as BrandAssetKind)}
          className="h-8 rounded-md bg-white/[0.04] border border-white/10 text-xs text-white/80 px-2 focus:outline-none"
        >
          {(Object.keys(KIND_META) as BrandAssetKind[]).map((k) => (
            <option key={k} value={k} className="bg-zinc-900">
              {KIND_META[k].label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind.endsWith("headshot") ? "Person's name + role" : "Label (optional)"}
          maxLength={120}
          className="h-8 flex-1 min-w-[160px] rounded-md bg-white/[0.04] border border-white/10 text-xs text-white/80 px-2 placeholder:text-white/25 focus:outline-none"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-2xs text-white/50 file:mr-2 file:h-8 file:rounded-md file:border-0 file:bg-white/[0.06] file:px-3 file:text-2xs file:text-white/75 file:cursor-pointer"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-2xs"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Upload size={12} />
          )}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <p className="text-3xs text-white/30 mb-4">
        PNG, JPEG, or WebP · max 4 MB · {KIND_META[kind].hint}
      </p>

      {error && (
        <div className="mb-3 rounded-md px-3 py-2 text-2xs text-rose-300/90 border border-rose-500/20 bg-rose-500/5">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <p className="text-xs text-white/35 italic">Loading assets…</p>
      ) : assets.length === 0 ? (
        <p className="text-xs text-white/40">
          No assets yet. Upload your logo and a founder headshot — the creative
          orchestrator uses them to compose on-brand visuals.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {assets.map((a) => {
            const Meta = KIND_META[a.kind] ?? KIND_META.logo;
            const KIcon = Meta.icon;
            return (
              <div
                key={a.id}
                className="group rounded-lg p-2"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <div
                  className="aspect-square rounded-md mb-2 flex items-center justify-center overflow-hidden"
                  style={{
                    // Checker-ish neutral so transparent logos stay visible.
                    background:
                      "repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, rgba(255,255,255,0.01) 0% 50%) 0 0 / 16px 16px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={toAppMediaUrl(a.public_url) ?? undefined}
                    alt={a.label ?? Meta.label}
                    className="max-w-full max-h-full object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="flex items-center justify-between gap-1">
                  <Badge variant="secondary" className="text-3xs gap-1 px-1.5">
                    <KIcon size={9} />
                    {Meta.label}
                  </Badge>
                  <button
                    onClick={() => setPendingDelete(a)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-white/35 hover:text-rose-400"
                    title="Delete asset"
                    aria-label={`Delete ${Meta.label}${a.label ? ` "${a.label}"` : ""}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {a.label && (
                  <p className="text-3xs text-white/50 mt-1 truncate" title={a.label}>
                    {a.label}
                  </p>
                )}
                {a.width != null && a.height != null && (
                  <p className="text-3xs text-white/25 mt-0.5">
                    {a.width}×{a.height}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this asset?"
        message={
          pendingDelete
            ? `"${pendingDelete.label ?? KIND_META[pendingDelete.kind]?.label ?? "Asset"}" will be removed from this brand's library. Creatives already generated keep their rendered image.`
            : ""
        }
        confirmLabel="Delete asset"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </section>
  );
}
