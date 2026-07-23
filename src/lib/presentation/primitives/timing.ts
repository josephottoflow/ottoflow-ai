/**
 * TIMING / RHYTHM library — resolves a philosophy's declared TIMING token into concrete
 * motion parameters, so the recipe's `timing` actually SHAPES the render (a "calm"
 * philosophy breathes; an "aggressive" one snaps). Reusable across every philosophy — the
 * renderer reads a profile here instead of hardcoding a stagger/fade/drift. Pure/data.
 *
 * Rhythm is the difference between "designed" and "template": entrance stagger, fade
 * lengths, continuous drift, easing and settle all move together to give each philosophy a
 * distinct temporal signature. Nothing here emits ASS — it returns numbers the renderer
 * serialises.
 */

export type TimingToken =
  | "calm" | "slow" | "minimal" | "steady" | "driving" | "aggressive";

export interface TimingProfile {
  /** Per-slot entrance offset (ms) — the "lead" between kicker and hero. */
  staggerMs: number;
  /** Default entrance fade (ms) when the caller doesn't override. */
  fadeInMs: number;
  fadeOutMs: number;
  /** Continuous-hold drift target scale-% (100 = perfectly still). */
  driftPct: number;
  /** \t acceleration for entrances (<1 ease-out/premium, 1 linear, >1 ease-in). */
  easeAccel: number;
  /** Overshoot settle window (ms) for pop reveals (0 = no settle). */
  settleMs: number;
  /** Rise distance as a fraction of font size (entrance travel). */
  riseFrac: number;
}

const PROFILES: Record<TimingToken, TimingProfile> = {
  // Unhurried, confident: a real lead between lines, long fades, a breath of drift.
  calm:       { staggerMs: 95,  fadeInMs: 240, fadeOutMs: 200, driftPct: 102, easeAccel: 0.5, settleMs: 90, riseFrac: 0.30 },
  // Cinematic: even slower, more drift, wider lead.
  slow:       { staggerMs: 130, fadeInMs: 300, fadeOutMs: 260, driftPct: 103, easeAccel: 0.4, settleMs: 110, riseFrac: 0.26 },
  // Restraint: gentle, no drift (perfect stillness), quiet lead.
  minimal:    { staggerMs: 75,  fadeInMs: 260, fadeOutMs: 220, driftPct: 100, easeAccel: 0.5, settleMs: 0,  riseFrac: 0.22 },
  // Broadcast: crisp and even, minimal drift, quick confident lead.
  steady:     { staggerMs: 65,  fadeInMs: 200, fadeOutMs: 170, driftPct: 100, easeAccel: 0.7, settleMs: 60, riseFrac: 0.34 },
  // Forward energy: tight lead, brisk fades, no drift (the cut carries momentum).
  driving:    { staggerMs: 48,  fadeInMs: 150, fadeOutMs: 140, driftPct: 100, easeAccel: 0.6, settleMs: 70, riseFrac: 0.40 },
  // Punchy: near-simultaneous, fast fades, strong settle after the pop.
  aggressive: { staggerMs: 38,  fadeInMs: 110, fadeOutMs: 100, driftPct: 100, easeAccel: 0.5, settleMs: 85, riseFrac: 0.44 },
};

/** Resolve a timing token → profile (unknown → "calm", the safe premium default). */
export function resolveTiming(token?: string): TimingProfile {
  return PROFILES[(token as TimingToken)] ?? PROFILES.calm;
}
