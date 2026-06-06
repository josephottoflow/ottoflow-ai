/**
 * Agent 3: Scene Planner.
 *
 * Splits a 5-section script into exactly 4 scenes (per spec). Each scene
 * carries the narration substring that plays during it + the search-intent
 * an editor would have in mind for the visual — NOT raw keywords. Agent 4
 * is responsible for expanding the intent into 6-10 query variations.
 *
 * Why not just "scene per section"? Because the 5 script sections (hook,
 * problem, value, conclusion, cta) aren't always 1:1 with what works as a
 * visual scene. The hook is often 2-3 visuals; the value section can be one
 * tight beat. Gemini decides the split, the orchestrator validates the
 * timestamps cover [0, totalDurationSec] with no gaps or overlaps.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { captureFallback } from "@/lib/observability";
import type {
  AgentContext,
  ScenePlanInput,
  ScenePlanOutput,
  ScenePlan,
  Emotion,
  VisualStyle,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

// ─── Structured-output schema ──────────────────────────────────────────────

const EMOTIONS: Emotion[] = [
  "curious", "anxious", "hopeful", "confident", "energetic", "calm", "urgent",
];
const VISUAL_STYLES: VisualStyle[] = [
  "cinematic", "ugc", "minimal", "documentary", "vibrant", "moody",
];

const SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["scenes"],
  properties: {
    scenes: {
      type: Type.ARRAY,
      minItems: "4",
      maxItems: "4",
      items: {
        type: Type.OBJECT,
        required: [
          "sceneId", "narration", "visualGoal", "emotion",
          "searchIntent", "visualStyle", "keywords",
          "startMs", "endMs",
        ],
        properties: {
          sceneId:      { type: Type.INTEGER },
          narration:    { type: Type.STRING  },
          visualGoal:   { type: Type.STRING  },
          emotion:      { type: Type.STRING, enum: EMOTIONS as string[] },
          searchIntent: { type: Type.STRING  },
          visualStyle:  { type: Type.STRING, enum: VISUAL_STYLES as string[] },
          keywords:     {
            type: Type.ARRAY,
            minItems: "3",
            maxItems: "8",
            items: { type: Type.STRING },
          },
          startMs:      { type: Type.INTEGER },
          endMs:        { type: Type.INTEGER },
        },
      },
    },
  },
};

// ─── Variation entropy (matches the project convention from gemini.ts) ─────

function entropy(): { seed: number; temperature: number } {
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    temperature: 0.65 + Math.random() * 0.1,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, t]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function runScenePlanner(
  input: ScenePlanInput,
  ctx: AgentContext,
): Promise<ScenePlanOutput> {
  ctx.log("agent.scenePlanner.start", {
    sections: 5,
    totalSec: input.script.totalDurationSec,
  });

  const { seed, temperature } = entropy();

  const prompt = buildPrompt(input);

  let parsed: { scenes: ScenePlan[] };
  try {
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
      "scenePlanner",
    );
    const raw = resp.text;
    if (!raw) throw new Error("scenePlanner: Gemini returned empty text");
    parsed = JSON.parse(raw) as { scenes: ScenePlan[] };
  } catch (err) {
    captureFallback("agent.scenePlanner.failed", err, {
      renderJobId: ctx.renderJobId,
    });
    throw err;
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  // The schema guarantees shape, but we still check semantic invariants:
  //   1. exactly 4 scenes
  //   2. sceneId 1..4 in order
  //   3. timestamps tile [0, script.totalDurationSec * 1000] with no gaps
  const total = Math.round(input.script.totalDurationSec * 1000);
  const scenes = parsed.scenes
    .slice(0, 4)
    .sort((a, b) => a.sceneId - b.sceneId);

  if (scenes.length !== 4) {
    throw new Error(
      `scenePlanner: expected 4 scenes, got ${scenes.length}`,
    );
  }
  for (let i = 0; i < 4; i++) {
    scenes[i].sceneId = i + 1;
    // First scene must start at 0; last must end at totalMs; consecutive
    // scenes must touch. Clamp deviations rather than failing the whole job.
    if (i === 0) scenes[i].startMs = 0;
    if (i === 3) scenes[i].endMs = total;
    if (i > 0) scenes[i].startMs = scenes[i - 1].endMs;
    if (scenes[i].endMs <= scenes[i].startMs) {
      // Gemini sometimes emits a zero-length scene. Carve out an equal share.
      scenes[i].endMs = scenes[i].startMs + Math.max(1500, total / 4);
    }
  }

  ctx.log("agent.scenePlanner.parsed", {
    perScene: scenes.map((s) => ({
      id: s.sceneId,
      durMs: s.endMs - s.startMs,
      emotion: s.emotion,
      keywords: s.keywords.length,
    })),
  });

  return { scenes };
}

function buildPrompt(input: ScenePlanInput): string {
  const arc = input.emotionalArc
    .map((b) => `  - ${(b.startPct * 100).toFixed(0)}%: ${b.emotion} (intensity ${b.intensity})`)
    .join("\n");
  return [
    "You are a professional short-form video editor splitting a script into exactly 4 scenes.",
    "",
    "## Script sections (ms timestamps)",
    `1. HOOK (${input.script.hook.startMs}-${input.script.hook.endMs}ms): ${input.script.hook.text}`,
    `2. PROBLEM (${input.script.problem.startMs}-${input.script.problem.endMs}ms): ${input.script.problem.text}`,
    `3. VALUE (${input.script.value.startMs}-${input.script.value.endMs}ms): ${input.script.value.text}`,
    `4. CONCLUSION (${input.script.conclusion.startMs}-${input.script.conclusion.endMs}ms): ${input.script.conclusion.text}`,
    `5. CTA (${input.script.cta.startMs}-${input.script.cta.endMs}ms): ${input.script.cta.text}`,
    "",
    "## Target emotional arc",
    arc,
    "",
    "## Instructions",
    `- Output exactly 4 scenes. Their startMs/endMs must tile the full ${Math.round(input.script.totalDurationSec * 1000)}ms with no gaps and no overlaps.`,
    "- `narration` is the substring of the script that plays during this scene. Concatenated, all 4 narrations should equal the full script.",
    "- `visualGoal` is what a viewer SHOULD SEE during this scene — describe the action, subject, and setting like a shot list, not a keyword list.",
    "- `searchIntent` is a one-sentence semantic intent (NOT keywords). Example: \"the moment of frustration when someone realises their day has been eaten by busywork\".",
    "- `keywords` is 3-8 short stock-footage search terms. Generic enough to surface results, specific enough to be on-brief.",
    "- `emotion` and `visualStyle` should align with the emotional arc above.",
    "- Think like an editor. Avoid generic phrases (\"business person\", \"office\"). Be specific.",
  ].join("\n");
}
