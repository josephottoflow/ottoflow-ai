/**
 * Storyboard quality scorer (Sprint 6, Priority 8).
 *
 * PURE, deterministic, NO network. Scores an assembled commercial_story storyboard
 * 0–100 across 8 commercial dimensions BEFORE any spend. buildCommercialStory uses
 * it to regenerate ONCE when the first valid storyboard scores below threshold,
 * then keeps the better one. Internal only — not surfaced in the API.
 */

export interface ScorableScene {
  role: string;
  shotType: string;
  action: string;
  environment: string;
  emotion: string;
  cameraMotion: string;
  durationSec: number;
  caption: string;
  hasScreen: boolean;
}

export interface StoryboardScoreInput {
  scenes: ScorableScene[];
  protagonist: string;
  hasBrandPalette: boolean;
  hasCta: boolean;
  targetDurationSec: [number, number];
}

export interface StoryboardScore {
  score: number; // 0–100
  breakdown: Record<string, number>;
  reasons: string[];
}

const REQUIRED_ROLES = ["hook", "problem", "visualized_pain", "reveal", "outcome", "proof"];
const HOOK_EMOTIONS = /\b(overwhelmed|frustrated|tense|curious|anxious|surprised|shocked)\b/i;
const ACTIVE_VERB = /^(?:a |an |the )?\w*(?:ing|s)?\b/; // loose: action should read as a verb phrase
const MOTION_CUE = /\b(walk|stride|gestur|reach|turn|lean|point|type|swipe|tap|hand|nod|glance|look|step|move|grip|hold)\b/i;

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

/** Distinct count helper. */
function distinct(values: string[]): number {
  return new Set(values.map((v) => (v ?? "").trim().toLowerCase()).filter(Boolean)).size;
}

export function scoreStoryboard(input: StoryboardScoreInput): StoryboardScore {
  const s = input.scenes;
  const reasons: string[] = [];
  const b: Record<string, number> = {};

  // Hook (0–15): a hook beat exists, with an attention-grabbing emotion + dynamic motion.
  const hook = s.find((x) => x.role === "hook");
  let hookScore = 0;
  if (hook) {
    hookScore += 6;
    if (HOOK_EMOTIONS.test(hook.emotion)) hookScore += 5; else reasons.push("hook emotion is not attention-grabbing");
    if (hook.cameraMotion && hook.cameraMotion.length > 3) hookScore += 4;
  } else reasons.push("no hook scene");
  b.hook = clamp(hookScore, 15);

  // Story (0–15): all 6 beats present.
  const roles = new Set(s.map((x) => x.role));
  const covered = REQUIRED_ROLES.filter((r) => roles.has(r)).length;
  b.story = clamp(Math.round((covered / REQUIRED_ROLES.length) * 15), 15);
  if (covered < REQUIRED_ROLES.length) reasons.push(`missing beats (${covered}/6)`);

  // Branding (0–10): brand palette available + a CTA assigned.
  b.branding = (input.hasBrandPalette ? 6 : 0) + (input.hasCta ? 4 : 0);
  if (!input.hasBrandPalette) reasons.push("no brand palette");

  // Visual variety (0–15): distinct shot types + distinct environments.
  const shotVar = distinct(s.map((x) => x.shotType));
  const envVar = distinct(s.map((x) => x.environment));
  b.visualVariety = clamp(Math.round((shotVar / 4) * 8) + Math.round((envVar / 4) * 7), 15);
  if (shotVar < 3) reasons.push("low shot-type variety");

  // CTA (0–10): a platform CTA is present.
  b.cta = input.hasCta ? 10 : 0;

  // Product visibility (0–15): at least one product/screen demonstration scene.
  const screens = s.filter((x) => x.hasScreen).length;
  b.productVisibility = clamp(screens >= 1 ? 12 + Math.min(3, screens) : 0, 15);
  if (screens === 0) reasons.push("no product demonstration scene");

  // Platform fit (0–10): total duration within the platform target window (±20%).
  const total = s.reduce((a, x) => a + (Number.isFinite(x.durationSec) ? x.durationSec : 0), 0);
  const [lo, hi] = input.targetDurationSec;
  const fit = total >= lo * 0.8 && total <= hi * 1.2;
  b.platformFit = fit ? 10 : 4;
  if (!fit) reasons.push(`duration ${total}s outside ${lo}–${hi}s window`);

  // Commercial quality (0–10): captions present + concise + human motion in actions.
  const captionsOk = s.filter((x) => {
    const w = (x.caption ?? "").trim().split(/\s+/).filter(Boolean).length;
    return w >= 2 && w <= 12;
  }).length;
  const motion = s.filter((x) => MOTION_CUE.test(x.action) || ACTIVE_VERB.test(x.action)).length;
  b.commercialQuality = clamp(Math.round((captionsOk / s.length) * 6) + Math.round((motion / s.length) * 4), 10);
  if (captionsOk < s.length) reasons.push("some captions missing/too long");

  const score = Object.values(b).reduce((a, n) => a + n, 0);
  return { score, breakdown: b, reasons };
}

/** Storyboards below this auto-trigger one regeneration (Priority 8). */
export const STORYBOARD_SCORE_THRESHOLD = 72;
