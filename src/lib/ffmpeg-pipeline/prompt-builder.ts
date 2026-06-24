/**
 * Prompt Builder (Video V1.1 — commercial_story mode ONLY).
 *
 * Canonical 10-slot Seedance prompt grammar + universal negative + a
 * deterministic, pre-spend prompt validator. PURE module: no network, no
 * side effects. The certified 4-beat path NEVER imports this — it is reached
 * only when VIDEO_MODE = commercial_story (mode-gated, additive). This keeps
 * the certified render (46bd40cd) byte-identical.
 *
 * Source of truth: docs/VIDEO_V1.1_PROMPT_BUILDER_SPEC.md (§1, §5, §6).
 */
import type { BrandPalette } from "./video-strategy";

/** Slot 7 — fidelity constant. */
export const RENDER_QUALITY = "photorealistic, 4K, cinematic color grade";
/** Slot 8 — default lens character. */
export const DEFAULT_DEPTH = "shallow depth of field";

/** Universal negative appended to every commercial_story scene (spec §1.3). */
export const UNIVERSAL_NEGATIVE =
  "on-screen text, captions, subtitles, letters, words, numbers, logos, brand marks, " +
  "watermarks, readable UI text, fake dashboards with legible labels, distorted or extra hands or fingers, " +
  "deformed faces, stock-footage look, generic tech visuals, abstract geometric shapes, tunnels, corridors, " +
  "floating structures, particle voids, bright saturated cartoon colors, fast cuts";

export interface PromptSlots {
  /** Slot 1 */ shotType: string;
  /** Slot 3 — protagonist blueprint, reused VERBATIM across all scenes. */ subject: string;
  /** Slot 4 */ action: string;
  /** Slot 2 */ environment: string;
  /** Slot 5 */ emotion: string;
  /** Slot 6 */ lighting: string;
  /** Slot 10 */ cameraMotion: string;
  /** Slot 9 source */ palette?: BrandPalette | null;
  /** Adds the no-legible-text guard when the scene shows a screen (§6). */ hasScreen?: boolean;
}

/** Slot 9 — brand palette as ACCENT LIGHTING, never as the subject's fill color. */
export function brandAccentClause(p?: BrandPalette | null): string {
  const cols = [p?.primary, p?.accent].filter(Boolean) as string[];
  if (!cols.length) return "restrained premium accent lighting";
  return `${cols.join(" and ")} accent lighting, premium aesthetic`;
}

/** Assemble the canonical 10-slot prompt (spec §1.2 order). */
export function assembleScenePrompt(s: PromptSlots): string {
  const screen = s.hasScreen ? " (no legible text on screen, no readable menus or labels)" : "";
  return (
    `Cinematic ${s.shotType} of ${s.subject} ${s.action} ` +
    `in ${s.environment}${screen}, mood is ${s.emotion}, ${s.lighting}, ` +
    `${RENDER_QUALITY}, ${DEFAULT_DEPTH}, ${brandAccentClause(s.palette)}, ` +
    `${s.cameraMotion} toward the focal point`
  );
}

/**
 * Light per-render preamble the worker prepends to each commercial_story scene
 * (the negative lives here; each scene prompt already carries its 10 slots).
 * Mode-gated — the certified path uses its own style block, untouched.
 */
export function buildCommercialStyleBlock(protagonist: string): string {
  return (
    `Consistent commercial film across all scenes — the same protagonist (${protagonist}), ` +
    `matched cinematic lighting and color grade so every scene reads as one film. ` +
    `Avoid: ${UNIVERSAL_NEGATIVE}.`
  );
}

// ─── Deterministic pre-spend validator (spec §5/§6; gap-analysis §E) ─────────
// Runs BEFORE enqueue / spend / Seedance, on each assembled scene prompt. The
// assembled prompt does NOT contain the negative clause, so text/logo tokens
// here are genuine violations, not the guard list.
const HUMAN =
  /\b(person|people|operator|manager|director|owner|professional|woman|man|men|women|team|colleague|colleagues|founder|lead|executive|worker|specialist|agent|hands|she|he|they)\b/i;
const ENV =
  /\b(office|desk|room|workplace|jobsite|job site|home|house|store|storefront|studio|warehouse|clinic|neighborhood|city|building|van|floor|lounge|bullpen|window|meeting room|deal room|driveway|dispatch)\b/i;
const ABSTRACT =
  /\b(tunnel|corridor|labyrinth|maze|geometric|floating structure|particle void|abstract space|digital realm|black void|kaleidoscope|data sphere|wireframe void)\b/i;
const AFFIRMATIVE_TEXT =
  /\b(text reading|logo|brand name|watermark|label saying|caption reading|ui text|words on screen)\b/i;
const SCREEN = /\b(dashboard|screen|monitor|display|map|tablet|graphic|interface|board)\b/i;
// Physical reactions only — NOT emotional states. ("focused" is an emotion in
// slot 5 and must not satisfy the product-demo human-reaction check.)
const REACTION =
  /\b(leans|leaning|reviews|reviewing|watches|watching|nods|nodding|points|gestures|smiles|smiling|reacts|reacting|studies|studying)\b/i;

export interface PromptViolation {
  rule: "HumanPresence" | "RealEnvironment" | "NoAbstractSubject" | "NoSyntheticText" | "ProductDemonstration";
  detail: string;
}

/** Validate ONE assembled scene prompt. Returns [] when clean. */
export function validateScenePrompt(prompt: string): PromptViolation[] {
  const v: PromptViolation[] = [];
  if (!HUMAN.test(prompt)) v.push({ rule: "HumanPresence", detail: "no human subject token" });
  if (!ENV.test(prompt)) v.push({ rule: "RealEnvironment", detail: "no real-environment token" });
  const abs = ABSTRACT.exec(prompt);
  if (abs) v.push({ rule: "NoAbstractSubject", detail: `banned subject "${abs[0]}"` });
  const txt = AFFIRMATIVE_TEXT.exec(prompt);
  if (txt) v.push({ rule: "NoSyntheticText", detail: `affirmative text/logo request "${txt[0]}"` });
  if (SCREEN.test(prompt) && !REACTION.test(prompt) && !/no legible text/i.test(prompt)) {
    v.push({ rule: "ProductDemonstration", detail: "screen without human reaction or no-text guard" });
  }
  return v;
}

/** Validate every scene of a strategy; returns a per-scene violation map. */
export function validateScenes(prompts: string[]): Map<number, PromptViolation[]> {
  const out = new Map<number, PromptViolation[]>();
  prompts.forEach((p, i) => {
    const v = validateScenePrompt(p);
    if (v.length) out.set(i, v);
  });
  return out;
}
