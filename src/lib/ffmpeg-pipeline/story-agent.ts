/**
 * Story Agent (Video V1.1 — commercial_story mode).
 *
 * Produces a HUMAN-FIRST commercial video plan: a recurring protagonist in real
 * environments across the 6-beat Cardinal arc (Hook · Problem · Visualized Pain ·
 * Reveal · Outcome · Proof). The CTA is the EXISTING deterministic FFmpeg endcard
 * — never a generated scene.
 *
 * It returns the SAME `VideoStrategy` shape the certified path emits, so the
 * unchanged scene-generation → Seedance → ffmpeg-compose pipeline consumes it
 * verbatim. The Creative Brief is CONTEXT ONLY (brand voice, tension as emotional
 * subtext); `visual_metaphor` is NOT consumed — that decoupling is the whole point.
 *
 * One Gemini structured call (like buildVideoStrategy) derives the protagonist
 * persona AND the 6 beats; code then assembles each scene's 10-slot prompt via the
 * Prompt Builder and runs the deterministic validator (≤2 repair attempts, then
 * fail) BEFORE the route enqueues anything — pre-spend, pre-Seedance.
 *
 * Source of truth: docs/VIDEO_V1.1_PROMPT_BUILDER_SPEC.md.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { VideoStrategy, VideoStrategyScene, SceneRole } from "./types";
import type { BrandPalette } from "./video-strategy";
import {
  assembleScenePrompt,
  validateScenePrompt,
  validateProtagonist,
  type PromptViolation,
} from "./prompt-builder";
import { getPlatformProfile, type PlatformProfile } from "@/lib/platform/profiles";
import { scoreStoryboard, STORYBOARD_SCORE_THRESHOLD, type ScorableScene } from "./storyboard-score";

/** Sprint 6 — translate a platform's profile into director language so each
 * platform VISIBLY differs (pacing, hook intensity, cut rhythm, tone). */
function platformDirection(p: PlatformProfile): string {
  const pace =
    p.story.pacing === "fast"
      ? "fast cutting, high energy, quick beats and visible motion in every shot"
      : p.story.pacing === "slow"
        ? "slower, composed pacing with longer holds and deliberate, premium camera moves"
        : "moderate pacing with confident, smooth camera moves";
  const tone =
    p.story.conversionStyle === "authority"
      ? "professional, clean, corporate, credible — an authority tone"
      : p.story.conversionStyle === "direct"
        ? "punchy, direct and modern"
        : "warm, aspirational, lifestyle-forward";
  const hook =
    p.story.hookIntensity === "high"
      ? `a HARD pattern-interrupt hook that lands by ${p.story.hookBySec}s`
      : `a clear, confident hook by ${p.story.hookBySec}s`;
  return [
    `Platform: ${p.label}.`,
    `Direction: ${tone}; ${pace}.`,
    `Open with ${hook}.`,
    `Scene complexity: ${p.story.sceneComplexity}. Keep on-screen captions large and legible for ${p.label}.`,
  ].join(" ");
}

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;

/** The 6 generated beats, in canonical order. CTA is the FFmpeg endcard (not here). */
const BEATS: SceneRole[] = ["hook", "problem", "visualized_pain", "reveal", "outcome", "proof"];

/** Per-beat duration ceiling/floor (spec Beat Matrix; ≤8s hard rule). */
const MIN_SEC = 3;
const MAX_SEC = 8;

export interface CommercialStoryInput {
  topic: string;
  /** Brief tension — used as emotional SUBTEXT only (never literalized). */
  visualTension?: string | null;
  brandIndustry?: string | null;
  brandName?: string | null;
  palette?: BrandPalette | null;
  /** Platform target window (seconds); the arc is paced to fit. Default LinkedIn 30–48. */
  targetDurationSec?: [number, number];
  /** Sprint 6 — destination platform id; drives platform-specific direction. */
  platform?: string | null;
}

interface RawScene {
  role: SceneRole;
  shotType: string;
  action: string;
  environment: string;
  emotion: string;
  lighting: string;
  cameraMotion: string;
  durationSec: number;
  caption: string;
  hasScreen: boolean;
  /** Sprint 46 — literal stock-library search phrase for the shot. */
  stockQuery?: string;
  /** Sprint 47 (Protagonist Continuity) — shot planning fields. */
  cameraAngle?: string;
  subjectVisibility?: string;
  continuityRole?: string;
}
interface RawStory {
  protagonist: string;
  video_concept: string;
  brand_worldview: string;
  scenes: RawScene[];
}

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

const SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["protagonist", "video_concept", "brand_worldview", "scenes"],
  properties: {
    protagonist: { type: Type.STRING },
    video_concept: { type: Type.STRING },
    brand_worldview: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      minItems: "6",
      maxItems: "6",
      items: {
        type: Type.OBJECT,
        required: [
          "role", "shotType", "action", "environment", "emotion",
          "lighting", "cameraMotion", "durationSec", "caption", "hasScreen",
          "stockQuery", "cameraAngle", "subjectVisibility", "continuityRole",
        ],
        properties: {
          role: { type: Type.STRING, enum: BEATS as string[] },
          shotType: { type: Type.STRING },
          action: { type: Type.STRING },
          environment: { type: Type.STRING },
          emotion: { type: Type.STRING },
          lighting: { type: Type.STRING },
          cameraMotion: { type: Type.STRING },
          durationSec: { type: Type.NUMBER },
          caption: { type: Type.STRING },
          hasScreen: { type: Type.BOOLEAN },
          stockQuery: { type: Type.STRING },
          cameraAngle: { type: Type.STRING },
          subjectVisibility: { type: Type.STRING },
          continuityRole: { type: Type.STRING },
        },
      },
    },
  },
};

// ─── Sprint 46 (Scene Relevance): stock-search phrase helpers ────────────────

/** Clean the model-emitted stockQuery to a 2-5 word plain phrase, or null. */
function sanitizeStockQuery(q: string | undefined): string | undefined {
  if (!q) return undefined;
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5);
  return words.length >= 2 ? words.join(" ") : undefined;
}

const STOCK_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "with", "for",
  "their", "his", "her", "its", "into", "from", "over", "under", "as", "is",
  "are", "then", "while", "protagonist", "scene", "camera", "cinematic",
  "toward", "focal", "point", "slowly", "quickly",
]);

/** Deterministic fallback: top content words of the structured action +
 *  environment fields (never the flattened cinematic prompt). */
function deriveStockQuery(
  action: string | undefined,
  environment: string | undefined,
): string | undefined {
  const pick = (text: string | undefined, n: number): string[] =>
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOCK_STOPWORDS.has(w))
      .slice(0, n);
  const words = [...pick(action, 3), ...pick(environment, 2)];
  return words.length >= 2 ? words.join(" ") : undefined;
}

// ─── Sprint 47 (Protagonist Continuity): composition-level continuity guard ──

const PERSON_LEAD =
  /^(woman|man|person|people|businesswoman|businessman|business woman|business man|professional|entrepreneur|freelancer|worker|guy|girl|lady|male|female|adult|designer|manager|student)\b\s*/i;

const VIS_IDIOM: Record<string, string> = {
  "over-shoulder": "over shoulder",
  hands: "hands",
  back: "back view",
  silhouette: "silhouette",
  detail: "close up",
  environment: "",
};

/** Sprint 49 (Subject-Count Consistency) — deterministic derivation of the
 *  composition fields from the planned subject visibility. The commercial
 *  story arc is single-protagonist BY CONSTRUCTION, so person-led framings
 *  imply exactly one subject and environment/detail shots imply none. Pure —
 *  exported for the local validator. */
export function deriveSubject(subjectVisibility?: string): {
  subjectCount: 0 | 1;
  dominantSubject: string;
} {
  const vis = (subjectVisibility ?? "").toLowerCase().trim();
  switch (vis) {
    case "hands":
      return { subjectCount: 1, dominantSubject: "hands" };
    case "detail":
      return { subjectCount: 0, dominantSubject: "object" };
    case "environment":
      return { subjectCount: 0, dominantSubject: "environment" };
    case "face":
    case "over-shoulder":
    case "back":
    case "silhouette":
      return { subjectCount: 1, dominantSubject: "single person" };
    default:
      // Unknown/missing plan → human-centered arc default: one person.
      return { subjectCount: 1, dominantSubject: "single person" };
  }
}

/** Enforce the one-anchor rule deterministically: the FIRST face/person-led
 *  scene keeps its person-led query (the anchor); every LATER person-led query
 *  is rewritten to a subject-neutral phrasing matching its planned visibility,
 *  so cuts never read as obviously different actors even when the model
 *  ignores the continuity instructions. Pure + in-place — exported for the
 *  local validator. */
export function applyShotContinuity(
  scenes: { searchQuery?: string; subjectVisibility?: string }[],
): void {
  let anchorUsed = false;
  for (const s of scenes) {
    const q = s.searchQuery;
    if (!q) continue;
    const vis = (s.subjectVisibility ?? "").toLowerCase().trim();
    const personLed = PERSON_LEAD.test(q);
    if (vis !== "face" && !personLed) continue; // already subject-neutral
    if (!anchorUsed) {
      anchorUsed = true; // the single face-revealing anchor keeps its query
      continue;
    }
    const stripped = q.replace(PERSON_LEAD, "").trim();
    const idiom = VIS_IDIOM[vis] ?? "over shoulder";
    // Sprint 53 (P2, prod 5b7e30e3): don't prepend the idiom when the stripped
    // query ALREADY starts with it — "woman over shoulder messy desk" became
    // "over shoulder over shoulder messy" (doubled idiom + the 5-word cap
    // chopped the real subject), which Pexels matched as over-the-shoulder
    // GLANCE portraits → a second face broke the one-anchor rule, and Replace
    // candidates (same query) were equally wrong.
    const base = idiom && stripped.toLowerCase().startsWith(idiom) ? stripped : `${idiom} ${stripped}`;
    const rewritten = base.trim().split(/\s+/).slice(0, 5).join(" ");
    if (rewritten.split(/\s+/).filter(Boolean).length >= 2) s.searchQuery = rewritten;
  }
}

function paletteLine(p?: BrandPalette | null): string {
  if (!p) return "a restrained, premium palette";
  return [p.primary && `primary ${p.primary}`, p.accent && `accent ${p.accent}`]
    .filter(Boolean)
    .join(", ") || "a restrained, premium palette";
}

function buildPrompt(input: CommercialStoryInput, fixes?: string): string {
  const [lo, hi] = input.targetDurationSec ?? [30, 48];
  const profile = getPlatformProfile(input.platform);
  return [
    "You are an award-winning commercial film director shooting a premium brand spot.",
    "Produce a HUMAN-CENTERED 6-scene commercial video plan — a directed mini-film with",
    "the polish of a professionally edited AI commercial, NOT abstract B-roll and NOT",
    "generic stock office footage. Benchmark: Apple / Linear / Notion brand films.",
    "",
    `Topic: ${input.topic}`,
    input.brandName ? `Brand: ${input.brandName}` : "",
    input.brandIndustry ? `Industry: ${input.brandIndustry}` : "",
    `Brand palette (use ONLY as accent lighting, never as object color): ${paletteLine(input.palette)}`,
    input.visualTension ? `Dramatic subtext (express through a HUMAN situation, do NOT literalize): ${input.visualTension}` : "",
    "",
    `PLATFORM OPTIMIZATION — make this feel made for the platform: ${platformDirection(profile)}`,
    "",
    "First, define ONE protagonist grounded in the audience for this industry/topic:",
    "`protagonist` = role + age range + wardrobe + one defining trait (e.g. 'a focused",
    "product manager, late 30s, smart-casual, sleeves rolled'). This EXACT person appears",
    "in every scene (continuity of face, wardrobe and lighting).",
    "",
    "Then produce EXACTLY 6 scenes — a complete commercial arc with a clear PURPOSE per beat:",
    "  1. hook            — first 3s: a striking human moment that stops the scroll",
    "  2. problem         — the protagonist buried in the status-quo pain (clear problem)",
    "  3. visualized_pain — close-up, the emotional tension made visceral (hands, stress)",
    "  4. reveal          — the protagonist USES the product; it resolves the chaos; show the BENEFIT (LONGEST scene)",
    "  5. outcome         — the human win + benefit landing: confident, decisive, relieved",
    "  6. proof           — social proof / scale / aspirational reach over a real place",
    "",
    "For EACH scene emit these fields (NO full prompt — code assembles it). Make every",
    "field richly cinematic so the footage looks like a premium commercial:",
    "- shotType: aerial | wide | establishing | medium | medium close-up | close-up | extreme close-up | over-the-shoulder",
    "- action: what the protagonist DOES — an ACTIVE, natural human motion (walking, a hand gesture,",
    "    eye contact to lens or screen, leaning in, reaching for / interacting with a real object/device).",
    "    Never a static, frozen figure. Bake subject positioning + a motion cue into the phrase.",
    "- environment: a REAL named place (office, desk, jobsite, home, store, neighborhood…). NEVER 'void/abstract space'.",
    "- emotion: one of overwhelmed|frustrated|tense|curious|anxious|hopeful|focused|confident|decisive|relieved|proud",
    "- lighting: cinematic light design + lens character for the beat (e.g. 'soft warm key + shallow depth of field,",
    "    85mm look', 'cool blue window light, anamorphic flare'). Imply depth of field + lens style.",
    "- cameraMotion: slow push-in | aerial descent | slow dolly | handheld (ONLY for visualized_pain) | slow reveal |",
    "    sweeping aerial | rack focus | slight slow-motion — match the platform pace above (faster cuts for fast platforms).",
    `- durationSec: integer ${MIN_SEC}–${MAX_SEC}; reveal should be the LONGEST (7–8); total across all 6 ≈ ${lo}–${hi}s`,
    "- caption: an on-screen line of 6–12 words, punchy and easy to read; FFmpeg burns it high-contrast and never",
    "    over the subject's face. Do NOT put it in any visual field.",
    "- hasScreen: true if this scene shows the product as a real device/dashboard/app the protagonist actively USES",
    "- stockQuery: a LITERAL 2-5 word stock-footage search phrase for this exact shot — subject + action + setting",
    "    in plain generic words a stock library indexes (e.g. 'woman working laptop office', 'hands typing keyboard',",
    "    'man walking city morning'). NO brand names, NO wardrobe/prop details, NO camera or lighting terms,",
    "    NO adjectives like cinematic. Each scene's stockQuery must differ from the others (visual variety).",
    "- cameraAngle: eye-level | low | high | top-down | over-shoulder",
    "- subjectVisibility: face | over-shoulder | hands | back | silhouette | detail | environment",
    "- continuityRole: anchor | continuation | insert | payoff",
    "",
    "CINEMATIC CONTINUITY — stock footage CANNOT repeat the same actor across clips, so imply ONE continuous",
    "protagonist through COMPOSITION, the way commercials cut around casting:",
    "- EXACTLY ONE scene — the hook — is the `anchor` with subjectVisibility 'face' (establishes the protagonist).",
    "- EVERY other scene MUST use a subject-neutral subjectVisibility (over-shoulder | hands | back | silhouette |",
    "    detail | environment) so consecutive shots read as the SAME person, never as obviously different actors.",
    "- Each stockQuery MUST match its scene's subjectVisibility: neutral scenes describe the shot WITHOUT gendered",
    "    person words (e.g. 'hands typing keyboard', 'over shoulder laptop screen', 'silhouette office window',",
    "    'tidy desk workspace morning') — ONLY the anchor scene may name a person (e.g. 'woman working desk').",
    "- Keep every environment inside ONE coherent visual world (same home/office/commute reality, consistent time",
    "    of day progression) so the cuts feel like one continuous story, not a montage of strangers.",
    "",
    "PRODUCT DEMONSTRATION — if the brand is software/SaaS/has a UI, dashboard, app or website, AT LEAST the reveal",
    "and one more scene MUST show the protagonist REALISTICALLY using the product on a real device (hands on keyboard/",
    "trackpad, eyes on a clean screen, a confident interaction). Show the product working — not generic office b-roll.",
    "",
    "HARD RULES:",
    "- Every scene MUST contain the human protagonist in natural motion. No subjectless or static scenes.",
    "- NO abstract metaphors, tunnels, corridors, floating structures, particle fields, geometric shapes, or 'data spheres'.",
    "- Products appear as data-viz / a real device the protagonist uses — NEVER fabricate readable UI text or logos.",
    "- Do NOT write a CTA scene — the call-to-action is a separate branded end card.",
    fixes ? `\nFIX THESE VALIDATION FAILURES from the previous attempt:\n${fixes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generate(input: CommercialStoryInput, fixes?: string): Promise<RawStory> {
  const resp = await Promise.race([
    client().models.generateContent({
      model: MODEL,
      contents: buildPrompt(input, fixes),
      config: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.7 },
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("commercialStory timed out")), TIMEOUT_MS)),
  ]);
  const raw = (resp as { text?: string }).text;
  if (!raw) throw new Error("commercialStory: Gemini returned empty text");
  return JSON.parse(raw) as RawStory;
}

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(n)));
}

interface ScoredStrategy {
  strategy: VideoStrategy;
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
}

/**
 * Generate ONE validated commercial storyboard (validate-repair ≤2) and score it.
 * Pre-spend — no Seedance, no render. Throws if it can't produce a valid board.
 */
async function buildValidatedStory(input: CommercialStoryInput): Promise<ScoredStrategy> {
  const sharedSeed = Math.floor(Math.random() * 2 ** 31);
  let fixes: string | undefined;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const raw = await generate(input, fixes);
    const byRole = new Map(raw.scenes.map((s) => [s.role, s]));

    // Deterministic validation gate (§E) — before any spend.
    // HumanPresence is validated ONCE on the protagonist (FM-A/FM-B): it is
    // injected verbatim as slot 3 of every scene, so a human-valid protagonist
    // guarantees a human in every scene. Per-scene checks cover scene-specific
    // content only (abstraction / synthetic-text / void-env / screen guard).
    const failures: string[] = [];
    const protoV: PromptViolation[] = validateProtagonist(raw.protagonist);
    if (protoV.length) {
      failures.push(`protagonist: ${protoV.map((x) => `${x.rule}:${x.detail}`).join("; ")}`);
    }

    const assembled: VideoStrategyScene[] = BEATS.map((role, i) => {
      const s = byRole.get(role);
      const slots = {
        shotType: s?.shotType ?? "medium",
        subject: raw.protagonist,
        action: s?.action ?? "present in the scene",
        environment: s?.environment ?? "a modern office",
        emotion: s?.emotion ?? "focused",
        lighting: s?.lighting ?? "cinematic key light",
        cameraMotion: s?.cameraMotion ?? "slow push-in",
        palette: input.palette ?? null,
        hasScreen: !!s?.hasScreen,
      };
      const prompt = assembleScenePrompt(slots);
      const v: PromptViolation[] = validateScenePrompt(prompt, slots.hasScreen);
      if (v.length) {
        failures.push(`scene ${i + 1} (${role}): ${v.map((x) => `${x.rule}:${x.detail}`).join("; ")}`);
      }
      return {
        role,
        sceneId: i + 1,
        prompt,
        caption: (s?.caption ?? "").slice(0, 80),
        seed: sharedSeed,
        durationSec: clampDuration(s?.durationSec ?? 5),
        // Sprint 46 (Scene Relevance) — the model's literal search phrase for
        // THIS shot; falls back to a deterministic derivation from the
        // structured action + environment (never from the cinematic prompt,
        // whose wardrobe/lighting tokens polluted stock search).
        searchQuery:
          sanitizeStockQuery(s?.stockQuery) ??
          deriveStockQuery(s?.action, s?.environment),
      } satisfies VideoStrategyScene;
    });

    // Sprint 47 (Protagonist Continuity) — one face-revealing anchor max; every
    // other person-led query is demoted to its planned subject-neutral framing
    // (over-shoulder/hands/back/silhouette/detail) so consecutive stock clips
    // read as ONE continuous protagonist.
    const contViews = assembled.map((sc, i) => ({
      searchQuery: sc.searchQuery,
      subjectVisibility: byRole.get(BEATS[i])?.subjectVisibility,
    }));
    applyShotContinuity(contViews);
    contViews.forEach((c, i) => {
      assembled[i] = { ...assembled[i], searchQuery: c.searchQuery };
    });

    // Sprint 49 (Subject-Count Consistency) — expose the shot plan on each
    // strategy scene + derive the deterministic composition fields (no extra
    // AI call). Stock selection uses subjectCount to soft-reject couples/
    // groups/crowds for this single-protagonist arc.
    assembled.forEach((sc, i) => {
      const shot = byRole.get(BEATS[i]);
      const d = deriveSubject(shot?.subjectVisibility);
      assembled[i] = {
        ...sc,
        subjectCount: d.subjectCount,
        dominantSubject: d.dominantSubject,
        shotType: shot?.shotType,
        cameraAngle: shot?.cameraAngle,
        subjectVisibility: shot?.subjectVisibility,
        continuityRole: shot?.continuityRole,
      };
    });

    if (failures.length === 0) {
      // Score the storyboard (Priority 8) on the raw scene direction.
      const scorable: ScorableScene[] = BEATS.map((role) => {
        const s = byRole.get(role);
        return {
          role,
          shotType: s?.shotType ?? "medium",
          action: s?.action ?? "",
          environment: s?.environment ?? "",
          emotion: s?.emotion ?? "",
          cameraMotion: s?.cameraMotion ?? "",
          durationSec: clampDuration(s?.durationSec ?? 5),
          caption: s?.caption ?? "",
          hasScreen: !!s?.hasScreen,
        };
      });
      const sc = scoreStoryboard({
        scenes: scorable,
        protagonist: raw.protagonist,
        hasBrandPalette: !!(input.palette && (input.palette.primary || input.palette.accent)),
        hasCta: true, // a platform CTA is assigned to the end card downstream
        targetDurationSec: input.targetDurationSec ?? [30, 48],
      });
      return {
        strategy: {
          video_concept: (raw.video_concept ?? "").slice(0, 400),
          visual_tension: input.visualTension ?? "",
          visual_metaphor: "", // intentionally empty — commercial_story does NOT use the still-image metaphor
          brand_worldview: (raw.brand_worldview ?? "").slice(0, 400),
          scenes: assembled,
        },
        score: sc.score,
        breakdown: sc.breakdown,
        reasons: sc.reasons,
      };
    }
    fixes = failures.join("\n");
  }

  throw new Error(
    `buildCommercialStory: prompt validation failed after 2 repair attempts — ${fixes}`,
  );
}

/**
 * Build a human-first commercial VideoStrategy (Sprint 6). Validates every scene
 * (≤2 repairs), scores the storyboard, and — per Priority 8 — regenerates ONCE
 * when the first valid board scores below threshold, keeping the better one.
 * Pre-spend; return type unchanged so the route/pipeline are untouched.
 */
export async function buildCommercialStory(input: CommercialStoryInput): Promise<VideoStrategy> {
  const first = await buildValidatedStory(input);
  let best = first;
  if (first.score < STORYBOARD_SCORE_THRESHOLD) {
    try {
      const second = await buildValidatedStory(input);
      if (second.score > best.score) best = second;
    } catch {
      // Retry failed validation — keep the first valid storyboard.
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      scope: "story-agent",
      event: "storyboard.scored",
      score: best.score,
      threshold: STORYBOARD_SCORE_THRESHOLD,
      regenerated: best !== first,
      breakdown: best.breakdown,
      reasons: best.reasons.slice(0, 6),
    }),
  );
  return best.strategy;
}
