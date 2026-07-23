"use client";

/**
 * TextOverlayControl (M2B) — the ONE UI control for burned text on any visual
 * asset (video today; image/carousel/story via M2C+). Renders its style options
 * from the shared Creative OS text-style registry, so the UI, API, and both
 * renderers share one design vocabulary and can never drift.
 *
 * Behaviour:
 *   • "Include text overlay" OFF → a CLEAN asset (no headline / subtitle / CTA /
 *     decorative typography). Logo / watermark / branding are INDEPENDENT options
 *     and are NOT touched here.
 *   • ON → pick a Text Style: Premium · Impact · Founder · Legacy.
 *
 * Purely presentational: it owns no render logic. Each generator maps the emitted
 * TextOverlay to its renderer via the registry (e.g. overlayToVideoFields).
 */
import { TEXT_STYLES, type TextOverlay, type TextStyleId } from "@/lib/creative-os/text-style-registry";

const SELECT_CLS =
  "w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 focus:outline-none focus:ring-1 focus:ring-[#E9863B]/40";

export function TextOverlayControl({
  value,
  onChange,
  className = "",
}: {
  value: TextOverlay;
  onChange: (v: TextOverlay) => void;
  className?: string;
}) {
  const enabled = value.enabled;
  const style: TextStyleId = value.enabled ? value.style : "legacy";

  return (
    <div className={className}>
      <label className="flex items-center gap-2 text-2xs text-white/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { enabled: true, style } : { enabled: false })}
          className="accent-[#E9863B]"
        />
        Include text overlay
      </label>

      {enabled ? (
        <div className="mt-2">
          <label className="text-3xs text-white/45">Text Style</label>
          <select
            className={`${SELECT_CLS} mt-0.5`}
            value={style}
            onChange={(e) => onChange({ enabled: true, style: e.target.value as TextStyleId })}
            aria-label="Text style"
          >
            {TEXT_STYLES.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#1a1510]">
                {s.label} · {s.description}
              </option>
            ))}
          </select>
          <p className="text-3xs text-white/40 mt-0.5">
            One design language across every asset. Legacy is the production default; the Creative OS styles render through the certified Motion engine.
          </p>
        </div>
      ) : (
        <p className="text-3xs text-white/40 mt-1.5">
          Clean asset — no headline, subtitle, CTA, or decorative type. Logo &amp; watermark are unaffected.
        </p>
      )}
    </div>
  );
}
