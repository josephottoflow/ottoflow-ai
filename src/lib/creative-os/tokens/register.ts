/**
 * OttoFlow Creative OS — Register token dictionary (Phase 6).
 *
 * The 13 registers from the Register System (Phase 9) and Design Tokens (Phase 11
 * §4), each as a row of dials that SELECT and TUNE the other engines' tokens into
 * one coherent voice. Pure data — no logic, no rendering. The Register Engine
 * reads these to orchestrate typography/motion/layout/caption; it never modifies
 * them.
 *
 * A register only ever sets pre-existing dials — it adds no rule and removes none
 * (Register System §14). Nothing here is wired into a render; consumed only
 * through the engine + Render Profile mechanism.
 */
import type { CaptionMode } from "./caption";

export type RegisterId =
  | "luxury" | "founder" | "technology" | "finance" | "travel" | "fashion"
  | "fitness" | "lifestyle" | "education" | "documentary" | "ugc" | "b2b" | "b2c";

/** A register's dial-row. Multipliers are relative to the register-neutral tokens. */
export interface RegisterConfig {
  id: RegisterId;
  /** Which caption personality this register speaks in. */
  captionMode: CaptionMode;
  /** Motion pace multiplier (× base durations; <1 slower/calmer, >1 faster). */
  paceMult: number;
  /** Motion budget multiplier (× base energy). */
  motionMult: number;
  /** Emphasis intensity 1 (minimal) … 5 (punchy). */
  emphasis: 1 | 2 | 3 | 4 | 5;
  /** Negative-space multiplier (× base spacing; >1 more air). */
  spaceMult: number;
  /** QA Pass threshold θ for this register. */
  passThreshold: number;
}

export const REGISTER_IDS: readonly RegisterId[] = [
  "luxury", "founder", "technology", "finance", "travel", "fashion",
  "fitness", "lifestyle", "education", "documentary", "ugc", "b2b", "b2c",
];

/** The 13 registers (values trace to Design Tokens §4). captionMode maps to the
 * available caption personalities; registers without a dedicated one use default. */
export const REGISTERS: Record<RegisterId, RegisterConfig> = {
  luxury: { id: "luxury", captionMode: "luxury", paceMult: 0.7, motionMult: 0.5, emphasis: 1, spaceMult: 1.6, passThreshold: 84 },
  founder: { id: "founder", captionMode: "founder", paceMult: 1.0, motionMult: 0.9, emphasis: 3, spaceMult: 1.0, passThreshold: 82 },
  technology: { id: "technology", captionMode: "default", paceMult: 1.0, motionMult: 0.8, emphasis: 2, spaceMult: 0.95, passThreshold: 83 },
  finance: { id: "finance", captionMode: "default", paceMult: 0.8, motionMult: 0.7, emphasis: 2, spaceMult: 1.2, passThreshold: 84 },
  travel: { id: "travel", captionMode: "default", paceMult: 0.85, motionMult: 1.0, emphasis: 2, spaceMult: 1.4, passThreshold: 82 },
  fashion: { id: "fashion", captionMode: "default", paceMult: 1.05, motionMult: 1.1, emphasis: 4, spaceMult: 1.1, passThreshold: 83 },
  fitness: { id: "fitness", captionMode: "ugc", paceMult: 1.35, motionMult: 1.4, emphasis: 5, spaceMult: 0.85, passThreshold: 81 },
  lifestyle: { id: "lifestyle", captionMode: "default", paceMult: 0.9, motionMult: 0.8, emphasis: 2, spaceMult: 1.15, passThreshold: 81 },
  education: { id: "education", captionMode: "default", paceMult: 0.95, motionMult: 0.85, emphasis: 3, spaceMult: 1.05, passThreshold: 83 },
  documentary: { id: "documentary", captionMode: "documentary", paceMult: 0.8, motionMult: 0.6, emphasis: 1, spaceMult: 1.1, passThreshold: 83 },
  ugc: { id: "ugc", captionMode: "ugc", paceMult: 1.2, motionMult: 1.3, emphasis: 4, spaceMult: 0.9, passThreshold: 80 },
  b2b: { id: "b2b", captionMode: "default", paceMult: 0.95, motionMult: 0.8, emphasis: 3, spaceMult: 1.05, passThreshold: 83 },
  b2c: { id: "b2c", captionMode: "default", paceMult: 1.1, motionMult: 1.05, emphasis: 4, spaceMult: 1.0, passThreshold: 82 },
};
