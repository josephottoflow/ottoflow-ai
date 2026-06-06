/**
 * Agent 2: Script Writer.
 *
 * Writes a 5-section narration (hook / problem / value / conclusion / cta)
 * for a 30-60s video, conditioned on the strategist's output.
 *
 * Timing approach: we ask Gemini ONLY for the section TEXT (it's bad at
 * emitting precise millisecond timestamps that tile cleanly). We then derive
 * startMs/endMs in code from each section's word count, scaled so the whole
 * script fits targetDurationSec at a natural narration rate. This guarantees
 * the timestamps tile [0, total] with no gaps — which Agent 3 (Scene Planner)
 * and Agent 9 (Timing) both rely on.
 *
 * Falls back to a deterministic skeleton on Gemini error so stage 2 never
 * hard-fails the pipeline.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { captureFallback } from "@/lib/observability";
import type {
  AgentContext,
  ScriptInput,
  ScriptOutput,
  ScriptSection,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;
// Natural narration rate. ElevenLabs Turbo ≈ 2.6-3.0 words/sec; 2.7 is a
// good midpoint for pacing the on-screen timing.
const WORDS_PER_SEC = 2.7;

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
    temperature: 0.7 + Math.random() * 0.1,
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
  required: ["hook", "problem", "value", "conclusion", "cta"],
  properties: {
    hook:       { type: Type.STRING },
    problem:    { type: Type.STRING },
    value:      { type: Type.STRING },
    conclusion: { type: Type.STRING },
    cta:        { type: Type.STRING },
  },
};

interface RawScript {
  hook: string;
  problem: string;
  value: string;
  conclusion: string;
  cta: string;
}

/**
 * Convert 5 section strings → timed ScriptSections that tile
 * [0, targetDurationSec*1000] proportional to each section's word count.
 */
function timeSections(
  raw: RawScript,
  targetDurationSec: number,
): { sections: Record<keyof RawScript, ScriptSection>; totalSec: number; fullText: string } {
  const order: (keyof RawScript)[] = ["hook", "problem", "value", "conclusion", "cta"];
  const wordCounts = order.map((k) => raw[k].trim().split(/\s+/).filter(Boolean).length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;

  // Natural duration from words; clamp to the 30-60s band, then scale the
  // section proportions to fill the chosen total exactly.
  const naturalSec = totalWords / WORDS_PER_SEC;
  const totalSec = Math.max(15, Math.min(60, targetDurationSec || naturalSec));
  const totalMs = Math.round(totalSec * 1000);

  const sections = {} as Record<keyof RawScript, ScriptSection>;
  let cursor = 0;
  order.forEach((k, i) => {
    const isLast = i === order.length - 1;
    const share = wordCounts[i] / totalWords;
    let durMs = Math.round(share * totalMs);
    if (isLast) durMs = totalMs - cursor; // absorb rounding drift
    sections[k] = { text: raw[k].trim(), startMs: cursor, endMs: cursor + durMs };
    cursor += durMs;
  });

  const fullText = order.map((k) => raw[k].trim()).join(" ");
  return { sections, totalSec, fullText };
}

function fallbackRaw(): RawScript {
  return {
    hook: "Stop scrolling — this changes everything you thought you knew.",
    problem: "Most people waste hours every week on work that should take minutes.",
    value: "Here's the system that turns that whole process into a single click.",
    conclusion: "That's how you reclaim your week without burning out.",
    cta: "Follow for more — the full breakdown is in the link in bio.",
  };
}

export async function runScriptWriter(
  input: ScriptInput,
  ctx: AgentContext,
): Promise<ScriptOutput> {
  ctx.log("agent.scriptWriter.start", { targetSec: input.targetDurationSec });
  const { seed, temperature } = entropy();

  let raw: RawScript;
  try {
    const s = input.strategy;
    const prompt = [
      "Write a 5-section narration script for a 30-60s vertical short-form video.",
      "",
      "Strategy to follow:",
      `- Hook approach: ${s.hookStrategy}`,
      `- Narrative structure: ${s.narrativeStrategy}`,
      `- CTA approach: ${s.ctaStrategy}`,
      `- Audience: ${s.audienceProfile}`,
      "",
      "Return 5 sections of spoken narration (what the voiceover says):",
      "- hook: 1-2 sentences. Must stop the scroll instantly.",
      "- problem: name the pain the audience feels.",
      "- value: the core insight / solution / payoff.",
      "- conclusion: the takeaway that lands the point.",
      "- cta: the ask (follow / link / comment). One short line.",
      "",
      "Write for the EAR — short, punchy, spoken-word. No stage directions, no emojis, no hashtags.",
      `Aim for roughly ${Math.round((input.targetDurationSec || 32) * WORDS_PER_SEC)} words total.`,
    ].join("\n");

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
      "scriptWriter",
    );
    const text = resp.text;
    if (!text) throw new Error("scriptWriter: empty Gemini response");
    raw = JSON.parse(text) as RawScript;
    // Guard against any empty section — fall back per-field.
    const fb = fallbackRaw();
    (Object.keys(fb) as (keyof RawScript)[]).forEach((k) => {
      if (!raw[k] || !raw[k].trim()) raw[k] = fb[k];
    });
  } catch (err) {
    captureFallback("agent.scriptWriter.failed", err, { renderJobId: ctx.renderJobId });
    ctx.log("agent.scriptWriter.fallback", {
      reason: err instanceof Error ? err.message : String(err),
    });
    raw = fallbackRaw();
  }

  const { sections, totalSec, fullText } = timeSections(raw, input.targetDurationSec);

  ctx.log("agent.scriptWriter.done", { totalSec, words: fullText.split(/\s+/).length });

  return {
    hook: sections.hook,
    problem: sections.problem,
    value: sections.value,
    conclusion: sections.conclusion,
    cta: sections.cta,
    totalDurationSec: totalSec,
    fullText,
  };
}
