/**
 * Video Strategy (Ottoflow Video V1).
 *
 * Turns a content item's EXISTING visual_tension + visual_metaphor (the same
 * fields the still-creative brief already carries — NO second creative engine)
 * into a 4-beat video arc and one abstract-safe Seedance prompt per scene:
 *
 *   Scene 1 Problem  → the negative pole of the tension
 *   Scene 2 Tension  → the collision the metaphor dramatizes
 *   Scene 3 Solution → the metaphor resolving
 *   Scene 4 Outcome  → the positive pole + brand worldview
 *
 * Brand logo/headshot/CTA are NEVER described to Seedance — branding stays
 * deterministic in FFmpeg. Prompts describe geometry/composition/motion/color
 * only (palette-seeded), echoing the still-creative background discipline.
 *
 * One Gemini structured-output call produces video_concept, brand_worldview,
 * and the 4 scene prompts. No live call is made unless GOOGLE_API_KEY is set.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { VideoStrategy, VideoStrategyScene, SceneRole } from "./types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;
const ROLES: SceneRole[] = ["problem", "tension", "solution", "outcome"];

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

export interface BrandPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  neutral?: string | null;
}

export interface VideoStrategyInput {
  topic: string;
  /** REUSED from the content creative brief — not re-derived. */
  visualTension: string;
  visualMetaphor: string;
  brandIndustry?: string | null;
  palette?: BrandPalette | null;
  /** Total video length; split evenly across 4 scenes. Default 20s (4×5s). */
  totalDurationSec?: number;
}

const SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["video_concept", "brand_worldview", "scenes"],
  properties: {
    video_concept: { type: Type.STRING },
    brand_worldview: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      minItems: "4",
      maxItems: "4",
      items: {
        type: Type.OBJECT,
        required: ["role", "prompt", "caption"],
        properties: {
          role: { type: Type.STRING, enum: ROLES as string[] },
          prompt: { type: Type.STRING },
          caption: { type: Type.STRING },
        },
      },
    },
  },
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function paletteLine(p?: BrandPalette | null): string {
  if (!p) return "neutral, restrained palette";
  const parts = [
    p.primary && `primary ${p.primary}`,
    p.secondary && `secondary ${p.secondary}`,
    p.accent && `accent ${p.accent}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "neutral, restrained palette";
}

function buildPrompt(input: VideoStrategyInput): string {
  return [
    "You are a brand video director. Produce a 4-scene vertical (9:16) AI-video plan.",
    "",
    `Topic: ${input.topic}`,
    `Visual tension (REUSE, do not change): ${input.visualTension}`,
    `Visual metaphor (REUSE, do not change): ${input.visualMetaphor}`,
    input.brandIndustry ? `Brand industry: ${input.brandIndustry}` : "",
    `Brand palette: ${paletteLine(input.palette)}`,
    "",
    "Produce:",
    "- video_concept: one-line creative thesis for the whole video.",
    "- brand_worldview: the brand's recurring visual stance (e.g. calm, structured, human).",
    "- scenes: EXACTLY 4, in this order and role:",
    "  1. problem  — dramatize the NEGATIVE pole of the tension.",
    "  2. tension  — the collision/strain the metaphor dramatizes.",
    "  3. solution — the metaphor RESOLVING.",
    "  4. outcome  — the POSITIVE pole + brand worldview.",
    "",
    "Each scene `prompt` is an abstract-safe Seedance text-to-video prompt:",
    "- Describe geometry, composition, structure, motion, and COLOR (use the palette) ONLY.",
    "- NO people, faces, text, letters, logos, words, or branded objects.",
    "- Vertical 9:16. Coherent across all 4 so they read as one video.",
    "- The metaphor must be visually recognizable before any caption is added.",
    "Each scene `caption` is a SHORT on-screen line (≤ 6 words) for this beat —",
    "punchy, plain language; FFmpeg burns it in (do NOT put it in the prompt).",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build a VideoStrategy. The 4 scenes are assigned sceneId 1..4, even
 * durations, and a deterministic-ish per-scene seed (caller may override).
 */
export async function buildVideoStrategy(
  input: VideoStrategyInput,
): Promise<VideoStrategy> {
  const totalSec = input.totalDurationSec ?? 20;
  const perScene = Math.max(4, Math.round(totalSec / 4));

  const resp = await withTimeout(
    client().models.generateContent({
      model: MODEL,
      contents: buildPrompt(input),
      config: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.7,
      },
    }),
    TIMEOUT_MS,
    "videoStrategy",
  );
  const raw = resp.text;
  if (!raw) throw new Error("videoStrategy: Gemini returned empty text");
  const parsed = JSON.parse(raw) as {
    video_concept: string;
    brand_worldview: string;
    scenes: { role: SceneRole; prompt: string; caption: string }[];
  };

  // Order by the canonical role sequence so sceneId 1..4 == problem..outcome
  // even if the model emits them out of order.
  const byRole = new Map(parsed.scenes.map((s) => [s.role, s]));
  const scenes: VideoStrategyScene[] = ROLES.map((role, i) => {
    const s = byRole.get(role);
    return {
      role,
      sceneId: i + 1,
      prompt: (s?.prompt ?? `${role}: ${input.visualMetaphor}`).slice(0, 1000),
      caption: (s?.caption ?? "").slice(0, 80),
      seed: Math.floor(Math.random() * 2 ** 31),
      durationSec: perScene,
    };
  });

  return {
    video_concept: parsed.video_concept.slice(0, 400),
    visual_tension: input.visualTension,
    visual_metaphor: input.visualMetaphor,
    brand_worldview: parsed.brand_worldview.slice(0, 400),
    scenes,
  };
}
