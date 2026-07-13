/**
 * Render Profile Foundation — Sprint 60 / Sprint A.
 *
 * A Render Profile is a SINGLE user-facing selector (Legacy / Modern V1 / …)
 * that resolves to an internal ResolvedRenderFlags set consumed by the FFmpeg
 * composer in LATER sprints. Precedence (highest first):
 *
 *   render_context.renderProfile  →  RENDER_PROFILE_DEFAULT (env)  →  "legacy"
 *
 * ── Sprint A is FOUNDATION ONLY ──────────────────────────────────────────────
 * EVERY profile currently resolves to the LEGACY flag set, because no modern
 * implementation exists yet. Sprints B–F flip individual flag mappings as each
 * feature lands (Caption Engine, Audio Mix V2, Animated End Screen, …). Nothing
 * in the render path consumes these flags in Sprint A, so the rendered output is
 * byte-identical to today's production behaviour regardless of the profile set.
 *
 * This module is pure and dependency-free (no imports from ./types) so it can be
 * unit-tested and called from the API route without pulling in the pipeline.
 */

/** The user-facing render profiles. Only "legacy" has behaviour today. */
export type RenderProfile = "legacy" | "modern_v1" | "modern_v2" | "experimental";

export const RENDER_PROFILES: readonly RenderProfile[] = [
  "legacy",
  "modern_v1",
  "modern_v2",
  "experimental",
] as const;

/** Internal feature flags a profile resolves to. Extensible: later sprints add
 * fields (e.g. captionStyle, captionEmphasis) — every field must default to its
 * Legacy value so an unset/older render stays byte-compatible. */
export interface ResolvedRenderFlags {
  /** The active profile that produced these flags. */
  profile: RenderProfile;
  /** static = the existing renderAss() generator (Legacy). */
  captionEngine: "static" | "animated";
  /** Animated-caption preset when captionEngine = "animated". Ignored for static. */
  captionStyle: "classic" | "bold_creator" | "minimal" | "corporate";
  /** v1 = the existing sidechain+limiter audio mix (Legacy). */
  audioMixProfile: "v1" | "v2";
  /** classic = the existing static renderCtaCard end card (Legacy). */
  endScreenMode: "classic" | "animated";
}

/** The one and only production behaviour today. Every future flag added here
 * must keep its Legacy default so absent/older renders never change. */
export const LEGACY_FLAGS: Readonly<Omit<ResolvedRenderFlags, "profile">> = {
  captionEngine: "static",
  captionStyle: "classic",
  audioMixProfile: "v1",
  endScreenMode: "classic",
} as const;

/**
 * Profile → flags mapping.
 *
 * legacy       → the certified byte-identical production behaviour (default).
 * modern_v1    → Video Quality V2: animated captions (professional "corporate"
 *                preset), broadcast audio master (v2), premium end screen. The
 *                recommended premium profile.
 * modern_v2    → same modern stack with the punchy "bold_creator" caption look.
 * experimental → tracks modern_v2 (bleeding edge; may change).
 *
 * Each modern flag is individually gated + fail-safe in its consumer (captions
 * fall back to Legacy on any error; audio/end-screen default to Legacy strings),
 * so selecting a modern profile can only ADD the opt-in presentation layer — it
 * never alters scene generation, stitching, retries, upload, or the pipeline.
 */
const PROFILE_FLAGS: Record<RenderProfile, ResolvedRenderFlags> = {
  legacy: { profile: "legacy", ...LEGACY_FLAGS },
  modern_v1: {
    profile: "modern_v1",
    captionEngine: "animated",
    captionStyle: "corporate",
    audioMixProfile: "v2",
    endScreenMode: "animated",
  },
  modern_v2: {
    profile: "modern_v2",
    captionEngine: "animated",
    captionStyle: "bold_creator",
    audioMixProfile: "v2",
    endScreenMode: "animated",
  },
  experimental: {
    profile: "experimental",
    captionEngine: "animated",
    captionStyle: "bold_creator",
    audioMixProfile: "v2",
    endScreenMode: "animated",
  },
};

/** Coerce an arbitrary value to a known RenderProfile, or null. Accepts
 * case/spacing/hyphen variants ("Modern V1", "modern-v1" → "modern_v1"). */
export function normalizeProfile(v: unknown): RenderProfile | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (RENDER_PROFILES as readonly string[]).includes(s) ? (s as RenderProfile) : null;
}

/**
 * Resolve the ACTIVE profile name by precedence:
 *   explicit (render_context.renderProfile) → RENDER_PROFILE_DEFAULT env → "legacy".
 * Unknown/invalid values are ignored (fall through), never thrown — a bad env
 * value can never break a render; it degrades to Legacy.
 */
export function resolveRenderProfile(
  explicit?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): RenderProfile {
  return (
    normalizeProfile(explicit) ??
    normalizeProfile(env.RENDER_PROFILE_DEFAULT) ??
    "legacy"
  );
}

/**
 * Resolve a profile source to its internal flag set.
 * Sprint A: always the Legacy flag set (with the resolved profile name attached).
 */
export function resolveRenderFlags(
  explicit?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRenderFlags {
  return PROFILE_FLAGS[resolveRenderProfile(explicit, env)];
}

/**
 * Resolve flags for a SINGLE render from its per-job profile ONLY — ignoring all
 * environment (no global RENDER_PROFILE_DEFAULT). This is the per-render opt-in
 * activation path used by the composer: Modern is chosen per render, never
 * globally. An absent/invalid profile resolves to Legacy (byte-identical).
 */
export function resolveRenderFlagsForJob(profile?: unknown): ResolvedRenderFlags {
  return PROFILE_FLAGS[normalizeProfile(profile) ?? "legacy"];
}
