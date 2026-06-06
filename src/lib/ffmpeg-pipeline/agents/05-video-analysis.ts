/**
 * Agent 5: Video Analysis.
 *
 * Scores each candidate 0-10 on relevance / quality / framing / motion.
 *
 * Two modes:
 *   - Heuristic (always runs, free): resolution, duration fit to scene,
 *     aspect-ratio suitability for a 1080x1920 vertical crop.
 *   - Vision (optional, gated by useVision + budget): batches the top-K
 *     heuristic candidates' thumbnails into ONE Gemini multimodal call that
 *     returns a relevance score per image against the scene's visualGoal.
 *     Blended into the final score. Any failure falls back to heuristic-only.
 *
 * The vision call is intentionally ONE request for K images (not K requests)
 * to keep cost at the ADR-002 budget (~$0.002/job). K defaults to 8.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type {
  AgentContext,
  AnalyzedCandidate,
  ClipCandidate,
  VideoAnalysisInput,
  VideoAnalysisOutput,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const VISION_TOP_K = 8;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

// ─── Heuristic scoring ──────────────────────────────────────────────────────

/**
 * quality: resolution proxy. 1080p+ → 1.0, scales down below.
 */
function scoreQuality(c: ClipCandidate): number {
  const minDim = Math.min(c.width, c.height);
  if (minDim >= 1080) return 1.0;
  if (minDim >= 720) return 0.8;
  if (minDim >= 480) return 0.55;
  return 0.3;
}

/**
 * framing: vertical-crop suitability. Portrait or square sources crop to
 * 1080x1920 with minimal loss; very wide landscape loses the sides.
 */
function scoreFraming(c: ClipCandidate): number {
  const ar = c.width / c.height; // >1 landscape, <1 portrait
  if (ar <= 0.6) return 1.0;      // tall portrait — ideal
  if (ar <= 1.0) return 0.9;      // portrait-ish / square
  if (ar <= 1.4) return 0.7;      // mild landscape
  if (ar <= 1.9) return 0.5;      // 16:9 — significant side crop
  return 0.3;                     // ultra-wide — heavy crop
}

/**
 * motion: we can't measure optical flow without decoding, so use duration
 * as a weak proxy plus source heuristics. Coverr/Mixkit skew slow-cinematic;
 * Pexels/Pixabay are mixed. 5-15s clips are ideal for a 5-8s scene slot.
 */
function scoreMotion(c: ClipCandidate): number {
  const d = c.durationSec;
  if (d >= 5 && d <= 15) return 0.85;
  if (d > 15 && d <= 30) return 0.7;
  if (d < 5) return 0.5;          // too short — may need looping
  return 0.55;                    // long clips: fine but we only use a slice
}

/**
 * relevance heuristic (pre-vision): keyword overlap between the candidate's
 * query/attribution/tags and the scene keywords. Cheap lexical signal.
 */
function scoreRelevanceHeuristic(
  c: ClipCandidate,
  sceneKeywords: string[],
): number {
  const hay = [
    c.query,
    c.attribution,
    ...(Array.isArray((c.metadata as { tags?: string[] })?.tags)
      ? ((c.metadata as { tags?: string[] }).tags as string[])
      : typeof (c.metadata as { tags?: string })?.tags === "string"
        ? ((c.metadata as { tags?: string }).tags as string).split(/[,\s]+/)
        : []),
  ]
    .join(" ")
    .toLowerCase();
  if (!sceneKeywords.length) return 0.5;
  const hits = sceneKeywords.filter((k) =>
    hay.includes(k.toLowerCase()),
  ).length;
  return Math.min(1, 0.4 + (hits / sceneKeywords.length) * 0.6);
}

function heuristicScore(
  c: ClipCandidate,
  sceneKeywords: string[],
): AnalyzedCandidate {
  const quality = scoreQuality(c);
  const framing = scoreFraming(c);
  const motion = scoreMotion(c);
  const relevance = scoreRelevanceHeuristic(c, sceneKeywords);
  // Weighted blend → 0-10. Relevance dominates; framing matters for vertical.
  const score10 =
    (relevance * 0.45 + quality * 0.2 + framing * 0.25 + motion * 0.1) * 10;
  return {
    ...c,
    score: round1(score10),
    reason: `heuristic: rel=${relevance.toFixed(2)} q=${quality.toFixed(2)} frame=${framing.toFixed(2)} motion=${motion.toFixed(2)}`,
    relevance,
    quality,
    framing,
    motion,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Vision pass ────────────────────────────────────────────────────────────

const VISION_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["scores"],
  properties: {
    scores: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["index", "relevance", "reason"],
        properties: {
          index:     { type: Type.INTEGER },  // matches the image order we sent
          relevance: { type: Type.NUMBER },   // 0-1
          reason:    { type: Type.STRING },
        },
      },
    },
  },
};

async function fetchThumbBase64(
  url: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Cap at ~512KB to keep the request small.
    if (buf.byteLength > 512 * 1024) return null;
    return { data: buf.toString("base64"), mimeType: ct };
  } catch {
    return null;
  }
}

/**
 * Blend vision relevance into the heuristic scores for the top-K candidates.
 * Mutates+returns a new array; non-vision candidates keep heuristic score.
 */
async function visionRescore(
  scene: VideoAnalysisInput["scene"],
  scored: AnalyzedCandidate[],
  ctx: AgentContext,
): Promise<AnalyzedCandidate[]> {
  const topK = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, VISION_TOP_K)
    .filter((c) => c.thumbnailUrl);

  if (topK.length === 0) return scored;

  // Fetch thumbnails in parallel.
  const thumbs = await Promise.all(
    topK.map((c) => fetchThumbBase64(c.thumbnailUrl as string)),
  );
  const usable = topK
    .map((c, i) => ({ c, thumb: thumbs[i] }))
    .filter((x) => x.thumb !== null) as {
      c: AnalyzedCandidate;
      thumb: { data: string; mimeType: string };
    }[];

  if (usable.length === 0) return scored;

  const parts: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [
    {
      text: [
        "You are a video editor judging stock-footage thumbnails for a scene.",
        `Scene goal: "${scene.visualGoal}"`,
        `Emotion: ${scene.emotion}. Style: ${scene.visualStyle}.`,
        "",
        `For each of the ${usable.length} images below (in order, 0-indexed), return a relevance score 0-1`,
        "for how well it matches the scene goal, plus a one-line reason.",
      ].join("\n"),
    },
  ];
  usable.forEach((u) => parts.push({ inlineData: u.thumb }));

  try {
    const resp = await client().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: VISION_SCHEMA,
        temperature: 0.2,
      },
    });
    const raw = resp.text;
    if (!raw) return scored;
    const parsed = JSON.parse(raw) as {
      scores: { index: number; relevance: number; reason: string }[];
    };
    const byIndex = new Map(parsed.scores.map((s) => [s.index, s]));

    // Re-blend: vision relevance replaces heuristic relevance at 70% weight.
    const idToVision = new Map<string, { relevance: number; reason: string }>();
    usable.forEach((u, i) => {
      const v = byIndex.get(i);
      if (v) idToVision.set(`${u.c.source}:${u.c.sourceId}`, v);
    });

    return scored.map((c) => {
      const v = idToVision.get(`${c.source}:${c.sourceId}`);
      if (!v) return c;
      const blendedRel = c.relevance * 0.3 + clamp01(v.relevance) * 0.7;
      const score10 =
        (blendedRel * 0.45 +
          c.quality * 0.2 +
          c.framing * 0.25 +
          c.motion * 0.1) *
        10;
      return {
        ...c,
        relevance: blendedRel,
        score: round1(score10),
        reason: `vision: ${v.reason.slice(0, 120)}`,
      };
    });
  } catch (err) {
    ctx.log("agent.videoAnalysis.vision_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return scored; // heuristic-only fallback
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function runVideoAnalysis(
  input: VideoAnalysisInput,
  ctx: AgentContext,
): Promise<VideoAnalysisOutput> {
  const { scene, candidates, useVision } = input;
  ctx.log("agent.videoAnalysis.start", {
    sceneId: scene.sceneId,
    candidates: candidates.length,
    useVision,
  });

  let scored = candidates.map((c) => heuristicScore(c, scene.keywords));

  if (useVision) {
    scored = await visionRescore(scene, scored, ctx);
  }

  scored.sort((a, b) => b.score - a.score);

  ctx.log("agent.videoAnalysis.done", {
    sceneId: scene.sceneId,
    top: scored.slice(0, 3).map((c) => ({ src: c.source, score: c.score })),
  });

  return { sceneId: scene.sceneId, scored };
}
