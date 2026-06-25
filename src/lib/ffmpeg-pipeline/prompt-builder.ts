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

/** Slot 7 — fidelity constant (Sprint 6: premium commercial look). */
export const RENDER_QUALITY =
  "photorealistic, 4K, cinematic color grade, premium commercial cinematography, natural skin tones, subtle film grain";
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
// HumanPresence is validated ONCE on the protagonist (FM-A/FM-B fix), NOT per
// scene — the protagonist is injected verbatim into slot 3 of every scene, so a
// human-valid protagonist guarantees a human in every scene. Broad role lexicon +
// age cue avoids false-rejecting common roles (CEO/engineer/developer/analyst…).
const HUMAN_PROTAGONIST =
  /\b(person|people|professional|individual|woman|man|men|women|guy|lady|she|he|they|his|her|their|manager|director|owner|founder|cofounder|executive|ceo|cto|cfo|coo|chief|president|vp|lead|leader|head|boss|engineer|developer|programmer|coder|designer|analyst|scientist|architect|consultant|specialist|technician|entrepreneur|operator|agent|broker|realtor|nurse|doctor|physician|practitioner|therapist|teacher|professor|marketer|strategist|writer|editor|accountant|advisor|adviser|coach|recruiter|seller|salesperson|rep|worker|employee|staff|teammate|colleague|coworker|client|customer|user|superintendent|foreman|contractor|dispatcher|clerk|associate|partner|freelancer|creator)\b/i;
// Age/identity cue strongly implies a real person ("late 30s", "40s", "year-old").
const AGE_CUE = /\b(\d{2}s|late \d{2}s|early \d{2}s|mid-?\d{2}s|\d{2}-year-old|aged? \d{2}|in (?:his|her|their) \d{2}s)\b/i;
// Abstract subjects that must NEVER be the scene — the anti-abstraction gate (UNCHANGED, per-scene).
const ABSTRACT =
  /\b(tunnel|corridor|labyrinth|maze|geometric|floating structure|particle void|abstract space|digital realm|black void|kaleidoscope|data sphere|wireframe void)\b/i;
// Affirmative requests for synthetic on-screen text/logos (UNCHANGED, per-scene).
const AFFIRMATIVE_TEXT =
  /\b(text reading|logo|brand name|watermark|label saying|caption reading|ui text|words on screen)\b/i;
// Explicitly NON-real environments. Void-blocklist replaces the brittle env allowlist
// (FM-D): pass any real place, reject only an explicitly abstract void.
const VOID_ENV =
  /\b(void|abstract space|digital realm|nowhere|empty white space|black void|featureless backdrop|limbo|cyberspace|the void)\b/i;

export interface PromptViolation {
  rule: "HumanPresence" | "RealEnvironment" | "NoAbstractSubject" | "NoSyntheticText" | "ProductDemonstration";
  detail: string;
}

/**
 * Validate the protagonist ONCE (FM-A/FM-B fix). The Story Agent injects this
 * string verbatim as slot 3 of every scene, so a human-valid protagonist
 * guarantees a human subject in every scene — HumanPresence is therefore NOT
 * re-checked per scene (that per-scene regex was the false-reject source). A
 * broad role lexicon + age cue lets common roles (CEO/engineer/developer/analyst)
 * pass while still rejecting a non-human "subject".
 */
export function validateProtagonist(protagonist: string): PromptViolation[] {
  const p = (protagonist ?? "").trim();
  const human = p.length > 0 && (HUMAN_PROTAGONIST.test(p) || AGE_CUE.test(p));
  return human
    ? []
    : [{ rule: "HumanPresence", detail: `protagonist "${p.slice(0, 60)}" names no recognizable human` }];
}

/**
 * Validate ONE assembled scene prompt — scene-specific content only (the human is
 * covered by validateProtagonist). `hasScreen` is the Story Agent's flag, so the
 * ProductDemonstration check no longer false-triggers on incidental "screen/board"
 * words (FM-C). RealEnvironment is a void-blocklist (FM-D). NoAbstractSubject is
 * the unchanged anti-abstraction gate.
 */
export function validateScenePrompt(prompt: string, hasScreen = false): PromptViolation[] {
  const v: PromptViolation[] = [];
  const abs = ABSTRACT.exec(prompt);
  if (abs) v.push({ rule: "NoAbstractSubject", detail: `banned subject "${abs[0]}"` });
  const txt = AFFIRMATIVE_TEXT.exec(prompt);
  if (txt) v.push({ rule: "NoSyntheticText", detail: `affirmative text/logo request "${txt[0]}"` });
  const vd = VOID_ENV.exec(prompt);
  if (vd) v.push({ rule: "RealEnvironment", detail: `non-real environment "${vd[0]}"` });
  if (hasScreen && !/no legible text/i.test(prompt)) {
    v.push({ rule: "ProductDemonstration", detail: "screen scene missing no-legible-text guard" });
  }
  return v;
}

/** Validate every scene of a strategy; returns a per-scene violation map. */
export function validateScenes(
  scenes: { prompt: string; hasScreen?: boolean }[],
): Map<number, PromptViolation[]> {
  const out = new Map<number, PromptViolation[]>();
  scenes.forEach((s, i) => {
    const v = validateScenePrompt(s.prompt, s.hasScreen);
    if (v.length) out.set(i, v);
  });
  return out;
}
