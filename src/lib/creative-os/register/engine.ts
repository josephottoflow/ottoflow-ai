/**
 * OttoFlow Creative OS — Register Engine (Phase 6).
 *
 * The ORCHESTRATION layer. A register is a row of dials that SELECTS and TUNES the
 * previously-certified engines — Typography, Motion, Layout, Caption — into one
 * coherent voice. This module IMPORTS and CALLS those engines; it never modifies
 * them (compose, not replace). Given a register id + frame it returns a single
 * resolved bundle, delegating each concern to its owning engine.
 *
 * Pure and deterministic. Nothing here is wired into a render; the composed bundle
 * is applied only through the flag-gated activation seam + Render Profile mechanism.
 */
import { REGISTERS, type RegisterConfig, type RegisterId } from "../tokens/register";
import { resolveCaptionPersonality, toPresetOverrides, type CaptionPresetOverrides } from "../caption/engine";
import { resolveMotionSig } from "../motion/engine";
import type { MotionSignature } from "../tokens/motion";
import { resolveSafeInsets, type Frame, type Insets } from "../layout/engine";
import { resolveTypeSpec, type TypeSpec } from "../typography/engine";

const KNOWN = new Set<string>(Object.keys(REGISTERS));

/** Resolve a register's dial-row. Unknown → the neutral "founder" register. Fresh
 * object so callers cannot mutate the token table. */
export function resolveRegister(id?: string): RegisterConfig {
  const key = (id && KNOWN.has(id) ? id : "founder") as RegisterId;
  return { ...REGISTERS[key] };
}

/** A fully composed register — one concern per owning engine, plus the register's
 * own dials. Every sub-field is produced by delegating to a certified engine. */
export interface ComposedRegister {
  id: RegisterId;
  captionMode: string;
  /** From the Caption Engine. */
  caption: CaptionPresetOverrides;
  /** From the Motion Engine (statement baseline shown; treatments resolve the same way). */
  motionStatement: MotionSignature;
  /** From the Layout Engine. */
  safeInsets: Insets;
  /** From the Typography Engine (the display role at this frame). */
  displayType: TypeSpec;
  /** The register's own dials (Register System). */
  passThreshold: number;
  paceMult: number;
  motionMult: number;
  spaceMult: number;
  emphasis: number;
}

/**
 * Compose a register into a single resolved bundle by delegating to each engine.
 * Pure; deterministic for a given (id, frame). Never mutates the engines' tokens.
 */
export function composeRegister(id: string, frame: Frame): ComposedRegister {
  const cfg = resolveRegister(id);
  return {
    id: cfg.id,
    captionMode: cfg.captionMode,
    caption: toPresetOverrides(resolveCaptionPersonality(cfg.captionMode)), // Caption Engine
    motionStatement: resolveMotionSig("statement"), // Motion Engine
    safeInsets: resolveSafeInsets(frame), // Layout Engine
    displayType: resolveTypeSpec("display", frame.height), // Typography Engine
    passThreshold: cfg.passThreshold,
    paceMult: cfg.paceMult,
    motionMult: cfg.motionMult,
    spaceMult: cfg.spaceMult,
    emphasis: cfg.emphasis,
  };
}
