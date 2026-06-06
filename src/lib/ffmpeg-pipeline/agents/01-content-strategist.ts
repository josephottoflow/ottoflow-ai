/**
 * Agent 1: Content Strategist.
 *
 * Turns a raw topic (+ optional brand industry) into a viral strategy:
 *   - hookStrategy      — how to stop the scroll in the first 1.5s
 *   - narrativeStrategy — the rhetorical structure (PAS / BAB / listicle …)
 *   - ctaStrategy       — what to ask for and how
 *   - audienceProfile   — who this is for, in one tight paragraph
 *   - emotionalArc      — 4-6 beats mapping video position → emotion
 *
 * Gemini structured output. Falls back to a sensible deterministic skeleton
 * if the model errors so the pipeline never hard-fails at stage 1.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { captureFallback } from "@/lib/observability";
import type {
  AgentContext,
  StrategistInput,
  StrategistOutput,
  Emotion,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;

const EMOTIONS: Emotion[] = [
  "curious", "anxious", "hopeful", "confident", "energetic", "calm", "urgent",
];

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

function entropy(): { seed: number; temperature: number } {
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    temperature: 0.7 + Math.random() * 0.1, // 0.7 - 0.8 — strategy benefits from variety
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "hookStrategy", "narrativeStrategy", "ctaStrategy",
    "audienceProfile", "emotionalArc",
  ],
  properties: {
    hookStrategy:      { type: Type.STRING },
    narrativeStrategy: { type: Type.STRING },
    ctaStrategy:       { type: Type.STRING },
    audienceProfile:   { type: Type.STRING },
    emotionalArc: {
      type: Type.ARRAY,
      minItems: "4",
      maxItems: "6",
      items: {
        type: Type.OBJECT,
        required: ["startPct", "emotion", "intensity"],
        properties: {
          startPct:  { type: Type.NUMBER },                       // 0-1
          emotion:   { type: Type.STRING, enum: EMOTIONS as string[] },
          intensity: { type: Type.NUMBER },                       // 0-1
        },
      },
    },
  },
};

function fallback(input: StrategistInput): StrategistOutput {
  const industry = input.brandIndustry ?? "general";
  return {
    hookStrategy: `Lead with a counter-intuitive claim about "${input.topic}" that a ${industry} viewer won't expect`,
    narrativeStrategy: "problem → agitation → reveal → proof → CTA",
    ctaStrategy: "low-friction follow + soft brand mention",
    audienceProfile: `Mobile-first ${industry} viewers who scroll past anything that doesn't grab in 1.5s`,
    emotionalArc: [
      { startPct: 0.0,  emotion: "curious",   intensity: 0.7 },
      { startPct: 0.25, emotion: "anxious",   intensity: 0.6 },
      { startPct: 0.55, emotion: "hopeful",   intensity: 0.75 },
      { startPct: 0.8,  emotion: "confident", intensity: 0.85 },
    ],
  };
}

export async function runContentStrategist(
  input: StrategistInput,
  ctx: AgentContext,
): Promise<StrategistOutput> {
  ctx.log("agent.strategist.start", { topic: input.topic });
  const { seed, temperature } = entropy();

  try {
    const prompt = [
      "You are a viral short-form video strategist (TikTok / Reels / Shorts).",
      `Topic: "${input.topic}"`,
      input.brandIndustry ? `Brand industry: ${input.brandIndustry}` : "",
      "",
      "Produce a strategy for a 30-60s vertical video:",
      "- hookStrategy: how to stop the scroll in the first 1.5 seconds (specific, not generic).",
      "- narrativeStrategy: the rhetorical structure (e.g. problem-agitate-solve, before-after-bridge, listicle, myth-bust).",
      "- ctaStrategy: what action to drive and how to phrase the ask.",
      "- audienceProfile: one tight paragraph on who this is for and what they care about.",
      "- emotionalArc: 4-6 beats, each with startPct (0-1 position in the video), emotion, and intensity (0-1). Should build toward a confident/energetic finish.",
    ]
      .filter(Boolean)
      .join("\n");

    const resp = await withTimeout(
      client().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature,
          seed,
        },
      }),
      TIMEOUT_MS,
      "contentStrategist",
    );
    const raw = resp.text;
    if (!raw) throw new Error("strategist: empty Gemini response");
    const parsed = JSON.parse(raw) as StrategistOutput;
    // Defensive: ensure the arc is sorted + clamped.
    parsed.emotionalArc = (parsed.emotionalArc ?? [])
      .map((b) => ({
        startPct: Math.max(0, Math.min(1, b.startPct)),
        emotion: b.emotion,
        intensity: Math.max(0, Math.min(1, b.intensity)),
      }))
      .sort((a, b) => a.startPct - b.startPct);
    if (parsed.emotionalArc.length === 0) parsed.emotionalArc = fallback(input).emotionalArc;
    ctx.log("agent.strategist.done", { arcBeats: parsed.emotionalArc.length });
    return parsed;
  } catch (err) {
    captureFallback("agent.strategist.failed", err, { renderJobId: ctx.renderJobId });
    ctx.log("agent.strategist.fallback", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fallback(input);
  }
}
