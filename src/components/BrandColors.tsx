"use client";

/**
 * Brand Colors editor (Creative Quality Phase 0B). Lets the user set the
 * brand's palette (primary / secondary / accent / neutral) which every
 * generated creative then renders in — background, scrim, and CTA. When no
 * colors are set, creatives use a NEUTRAL palette (never Ottoflow purple).
 */
import { useState } from "react";
import { Palette, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureFallback } from "@/lib/observability";

const FIELDS = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["accent", "Accent"],
  ["neutral", "Neutral"],
] as const;
type ColorKey = (typeof FIELDS)[number][0];

/** Normalize to #rrggbb (lowercase). Returns "" for empty, null for invalid. */
function normHex(v: string): string | null {
  let h = v.trim();
  if (!h) return "";
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h.slice(1).split("").map((c) => c + c).join("")}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

export function BrandColors({
  brandId,
  initial,
}: {
  brandId: string;
  initial?: Record<string, string> | null;
}) {
  const init = initial ?? {};
  const [vals, setVals] = useState<Record<ColorKey, string>>({
    primary: init.primary ?? "",
    secondary: init.secondary ?? "",
    accent: init.accent ?? "",
    neutral: init.neutral ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(
    typeof init.source === "string" ? init.source : null,
  );

  const configured = FIELDS.some(([k]) => !!vals[k]);

  async function save() {
    setError(null);
    const out: Record<string, string> = {};
    for (const [k, label] of FIELDS) {
      const raw = vals[k];
      if (!raw) continue;
      const n = normHex(raw);
      if (n === null) {
        setError(`${label} is not a valid hex color (e.g. #1a73e8).`);
        return;
      }
      out[k] = n;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/colors`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(out),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        brand_colors?: Record<string, string>;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const saved = body.brand_colors ?? {};
      setVals({
        primary: saved.primary ?? "",
        secondary: saved.secondary ?? "",
        accent: saved.accent ?? "",
        neutral: saved.neutral ?? "",
      });
      setSource(typeof saved.source === "string" ? saved.source : "manual");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      captureFallback("brand_colors.client_save_failed", e, { brandId });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Palette size={14} className="text-fuchsia-400" />
        <h2 className="text-sm font-semibold text-white">Brand Colors</h2>
        {source && <span className="text-3xs text-white/35 ml-1">source: {source}</span>}
      </div>
      <p className="text-2xs text-white/40 mb-4">
        Used to color every generated creative — background, scrim, and CTA.
        Without brand colors, creatives use a neutral palette.
      </p>

      {!configured && (
        <div className="mb-4 rounded-md px-3 py-2 text-2xs text-amber-300/90 border border-amber-500/20 bg-amber-500/[0.06]">
          Brand colors not configured. Creatives will use a neutral palette.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {FIELDS.map(([k, label]) => {
          const norm = normHex(vals[k]);
          const valid = norm !== null; // "" is valid (empty), null is invalid
          const swatch = norm || "transparent";
          return (
            <div key={k}>
              <label className="text-3xs uppercase tracking-wider text-white/45 mb-1 block">
                {label}
              </label>
              <div className="flex items-center gap-2">
                <span
                  className="w-8 h-8 rounded-md border border-white/15 flex-shrink-0"
                  style={{ background: swatch }}
                />
                <input
                  value={vals[k]}
                  onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
                  placeholder="#000000"
                  className={`flex-1 bg-white/[0.04] border rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-white/25 focus:outline-none transition-colors ${
                    valid ? "border-white/10 focus:border-violet-500/40" : "border-rose-500/50"
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Live preview bar */}
      <div className="rounded-lg overflow-hidden border border-white/10 mb-4 flex">
        {FIELDS.map(([k, label]) => {
          const c = normHex(vals[k]);
          return (
            <div
              key={k}
              className="h-9 flex-1"
              style={{ background: c || "rgba(255,255,255,0.04)" }}
              title={label}
            />
          );
        })}
      </div>

      {error && <div className="mb-3 text-2xs text-rose-300/90">{error}</div>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="gradient"
          className="gap-1.5"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saved ? (
            <Check size={13} />
          ) : (
            <Palette size={13} />
          )}
          {saved ? "Saved" : "Save colors"}
        </Button>
      </div>
    </div>
  );
}
