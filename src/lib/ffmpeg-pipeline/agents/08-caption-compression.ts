/**
 * Agent 8: Caption Compression.
 *
 * Converts each scene's narration into a retention-optimised on-screen
 * caption obeying the spec's hard limits:
 *   - ≤ 2 lines
 *   - ≤ 22 characters per line
 *   - ≤ 8 words total
 *   - preserves meaning
 *
 * Gemini does the semantic compression (it's good at this — "AI agents are
 * transforming how businesses automate repetitive tasks" → "AI Agents
 * Transform Business"). We then HARD-ENFORCE the limits in code because LLMs
 * routinely overshoot character budgets: truncate words, re-wrap lines, and
 * never emit a 3rd line. Timing comes straight from the scene window.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type {
  AgentContext,
  CaptionInput,
  CaptionOutput,
  TimedCaption,
  ScenePlan,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const MAX_LINE_CHARS = 22;
const MAX_WORDS = 8;
const MAX_LINES = 2;

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
  required: ["captions"],
  properties: {
    captions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["sceneId", "caption"],
        properties: {
          sceneId: { type: Type.INTEGER },
          caption: { type: Type.STRING },
        },
      },
    },
  },
};

/**
 * Wrap a phrase into ≤ MAX_LINES lines of ≤ MAX_LINE_CHARS chars.
 * Greedy word packing. Truncates if it would need a 3rd line.
 */
function wrap(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    // A single word longer than the line budget gets hard-cut.
    const word = w.length > MAX_LINE_CHARS ? w.slice(0, MAX_LINE_CHARS) : w;
    const probe = cur ? `${cur} ${word}` : word;
    if (probe.length <= MAX_LINE_CHARS) {
      cur = probe;
    } else {
      if (cur) lines.push(cur);
      cur = word;
      if (lines.length === MAX_LINES) {
        // Already have max lines + an overflow word → stop, drop the rest.
        cur = "";
        break;
      }
    }
  }
  if (cur && lines.length < MAX_LINES) lines.push(cur);
  return lines.slice(0, MAX_LINES);
}

/**
 * Enforce ALL hard limits on a candidate caption string. Returns the final
 * line array + the flattened text.
 */
function enforce(raw: string): { text: string; lineBreaks: string[] } {
  // Strip punctuation noise that wastes character budget, uppercase for punch.
  let s = raw
    .replace(/["""'']/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .toUpperCase();
  // Cap word count first.
  const words = s.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  s = words.join(" ");
  const lineBreaks = wrap(s);
  return { text: lineBreaks.join(" "), lineBreaks };
}

function fallbackCaption(scene: ScenePlan): { text: string; lineBreaks: string[] } {
  // First MAX_WORDS words of the narration, enforced.
  const words = scene.narration.trim().split(/\s+/).slice(0, MAX_WORDS).join(" ");
  return enforce(words);
}

export async function runCaptionCompression(
  input: CaptionInput,
  ctx: AgentContext,
): Promise<CaptionOutput> {
  ctx.log("agent.captionCompression.start", { scenes: input.scenes.length });

  // Ask Gemini for all captions in one call.
  let llmByScene = new Map<number, string>();
  try {
    const prompt = [
      "Compress each scene's narration into a punchy on-screen caption.",
      "",
      "Hard rules per caption:",
      `- At most ${MAX_WORDS} words.`,
      `- Will be wrapped to 2 lines of ${MAX_LINE_CHARS} characters — keep it SHORT.`,
      "- Capture the core idea, not the full sentence.",
      "- No quotes, no trailing punctuation.",
      "- Title-case or punchy phrasing. It will be uppercased.",
      "",
      "Example:",
      'Narration: "Artificial intelligence agents are transforming how businesses automate repetitive tasks."',
      'Caption: "AI Agents Transform Business"',
      "",
      "Scenes:",
      ...input.scenes.map(
        (s) => `Scene ${s.sceneId}: ${s.narration}`,
      ),
    ].join("\n");

    const resp = await client().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.6,
      },
    });
    const raw = resp.text;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        captions: { sceneId: number; caption: string }[];
      };
      llmByScene = new Map(parsed.captions.map((c) => [c.sceneId, c.caption]));
    }
  } catch (err) {
    ctx.log("agent.captionCompression.llm_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    // fall through to per-scene fallback below
  }

  const captions: TimedCaption[] = input.scenes.map((scene) => {
    const llm = llmByScene.get(scene.sceneId);
    const { text, lineBreaks } = llm ? enforce(llm) : fallbackCaption(scene);
    return {
      sceneId: scene.sceneId,
      text,
      lineBreaks,
      startMs: scene.startMs,
      endMs: scene.endMs,
    };
  });

  ctx.log("agent.captionCompression.done", {
    captions: captions.map((c) => ({
      id: c.sceneId,
      lines: c.lineBreaks.length,
      chars: c.lineBreaks.map((l) => l.length),
    })),
  });

  return { captions };
}
