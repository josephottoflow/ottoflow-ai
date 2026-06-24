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
  type PromptViolation,
} from "./prompt-builder";

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
        },
      },
    },
  },
};

function paletteLine(p?: BrandPalette | null): string {
  if (!p) return "a restrained, premium palette";
  return [p.primary && `primary ${p.primary}`, p.accent && `accent ${p.accent}`]
    .filter(Boolean)
    .join(", ") || "a restrained, premium palette";
}

function buildPrompt(input: CommercialStoryInput, fixes?: string): string {
  const [lo, hi] = input.targetDurationSec ?? [30, 48];
  return [
    "You are a commercial film director. Produce a HUMAN-CENTERED 6-scene commercial",
    "video plan — a directed mini-film, NOT abstract B-roll. Benchmark: premium brand",
    "commercials (real protagonist, real environments, a product reveal, a human win).",
    "",
    `Topic: ${input.topic}`,
    input.brandName ? `Brand: ${input.brandName}` : "",
    input.brandIndustry ? `Industry: ${input.brandIndustry}` : "",
    `Brand palette (use ONLY as accent lighting, never as object color): ${paletteLine(input.palette)}`,
    input.visualTension ? `Dramatic subtext (express through a HUMAN situation, do NOT literalize): ${input.visualTension}` : "",
    "",
    "First, define ONE protagonist grounded in the audience for this industry/topic:",
    "`protagonist` = role + age range + wardrobe + one defining trait (e.g. 'a focused",
    "product manager, late 30s, smart-casual, sleeves rolled'). This EXACT person appears",
    "in every scene (continuity).",
    "",
    "Then produce EXACTLY 6 scenes in THIS order/role:",
    "  1. hook            — a striking human moment that stops the scroll",
    "  2. problem         — the protagonist buried in the status-quo pain",
    "  3. visualized_pain — close-up, the pain made visceral (hands, stress)",
    "  4. reveal          — the protagonist turns to the product; it resolves the chaos (LONGEST scene)",
    "  5. outcome         — the human win: confident, decisive, relieved",
    "  6. proof           — scale/reach over a real place; aspirational",
    "",
    "For EACH scene emit these fields (NO full prompt — code assembles it):",
    "- shotType: aerial | wide | establishing | medium | medium close-up | close-up | extreme close-up | over-the-shoulder",
    "- action: what the protagonist DOES this beat (active verb phrase)",
    "- environment: a REAL named place (office, desk, jobsite, home, store, neighborhood…). NEVER 'void/abstract space'.",
    "- emotion: one of overwhelmed|frustrated|tense|curious|hopeful|focused|confident|decisive|relieved|proud",
    "- lighting: cinematic light design for the beat (e.g. 'cool blue window light', 'warm key entering from the screen')",
    "- cameraMotion: slow push-in | aerial descent | slow dolly | handheld (ONLY for visualized_pain) | slow reveal | sweeping aerial | slight slow-motion",
    `- durationSec: integer ${MIN_SEC}–${MAX_SEC}; reveal should be the LONGEST (7–8); total across all 6 ≈ ${lo}–${hi}s`,
    "- caption: a SHORT on-screen line (≤6 words) for this beat (FFmpeg burns it in; do NOT put it in any visual field)",
    "- hasScreen: true if this scene shows a dashboard/screen/map (then keep the protagonist reacting in-frame)",
    "",
    "HARD RULES:",
    "- Every scene MUST contain the human protagonist. No subjectless scenes.",
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

/**
 * Build a human-first commercial VideoStrategy. Validates every assembled scene
 * prompt; on any violation, regenerates with feedback (≤2 repairs) then throws.
 * Pre-spend (called in the route before enqueue) — no Seedance, no render.
 */
export async function buildCommercialStory(input: CommercialStoryInput): Promise<VideoStrategy> {
  const sharedSeed = Math.floor(Math.random() * 2 ** 31);
  let fixes: string | undefined;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const raw = await generate(input, fixes);
    const byRole = new Map(raw.scenes.map((s) => [s.role, s]));

    const assembled = BEATS.map((role, i) => {
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
      return {
        role,
        sceneId: i + 1,
        prompt,
        caption: (s?.caption ?? "").slice(0, 80),
        seed: sharedSeed,
        durationSec: clampDuration(s?.durationSec ?? 5),
      } satisfies VideoStrategyScene;
    });

    // Deterministic validation gate (§E) — before any spend.
    const failures: string[] = [];
    assembled.forEach((sc) => {
      const v: PromptViolation[] = validateScenePrompt(sc.prompt);
      if (v.length) {
        failures.push(`scene ${sc.sceneId} (${sc.role}): ${v.map((x) => `${x.rule}:${x.detail}`).join("; ")}`);
      }
    });

    if (failures.length === 0) {
      return {
        video_concept: (raw.video_concept ?? "").slice(0, 400),
        visual_tension: input.visualTension ?? "",
        visual_metaphor: "", // intentionally empty — commercial_story does NOT use the still-image metaphor
        brand_worldview: (raw.brand_worldview ?? "").slice(0, 400),
        scenes: assembled,
      };
    }
    fixes = failures.join("\n");
  }

  throw new Error(
    `buildCommercialStory: prompt validation failed after 2 repair attempts — ${fixes}`,
  );
}
