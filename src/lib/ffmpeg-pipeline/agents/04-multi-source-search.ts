/**
 * Agent 4: Multi-Source Search.
 *
 * Steps per scene:
 *   1. Expand the scene's `searchIntent` + `keywords` into 6-10 semantic
 *      query variations via Gemini (cheap, structured-output JSON).
 *   2. Fan out across Pexels / Pixabay / Mixkit / Coverr in parallel. When
 *      ctx.includeAiScenes is true, ALSO call the existing video-providers
 *      registry for one Runway/Luma generation as the "5th source".
 *   3. Concatenate, dedupe by (source, sourceId), keep ≤ perSourceLimit * 4
 *      candidates.
 *   4. Persist every candidate to scene_candidates with was_selected = false
 *      so the audit trail exists even if downstream agents reject the lot.
 *
 * Output is fed to Agent 5 (Video Analysis) which scores and ranks.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { searchPixabay } from "@/lib/video-providers/pixabay";
import { searchMixkit  } from "@/lib/video-providers/mixkit";
import { searchCoverr  } from "@/lib/video-providers/coverr";
import { findStockVideoByPrompt } from "@/lib/pexels";
import { generateScene as registryGenerate } from "@/lib/video-providers/registry";
import { createAdminClient } from "@/lib/supabase";
import { captureFallback } from "@/lib/observability";
import type {
  AgentContext,
  ClipCandidate,
  MultiSourceSearchInput,
  MultiSourceSearchOutput,
  SourceName,
} from "../types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

const QUERY_EXPANSION_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["queries"],
  properties: {
    queries: {
      type: Type.ARRAY,
      minItems: "6",
      maxItems: "10",
      items: { type: Type.STRING },
    },
  },
};

// ─── Query expansion ────────────────────────────────────────────────────────
// Per the spec example:
//   intent: "Business owners wasting time"
//   queries: ["office stress", "employee overwhelmed", "paperwork",
//             "repetitive work", "administrative tasks", "busy office",
//             "deadline pressure", "productivity issues"]
//
// We ask Gemini for 6-10 variations because (a) some sources return no hits
// for narrow queries, and (b) parallel breadth is cheap on rate-limited
// providers (Pexels 200/h, Pixabay 100/min).

async function expandQueries(
  intent: string,
  keywords: string[],
  ctx: AgentContext,
): Promise<string[]> {
  try {
    const prompt = [
      "Generate 6-10 stock-footage search query variations for this scene.",
      "",
      `Scene intent: "${intent}"`,
      `Seed keywords: ${keywords.join(", ")}`,
      "",
      "Rules:",
      "- Each query is 1-4 words.",
      "- Cover literal interpretations AND adjacent visual metaphors.",
      "- Avoid duplicates.",
      "- Avoid generic single-word queries like 'business' or 'people' unless the keyword list demands it.",
      "- Mix specific (\"deadline stress\") and abstract (\"chaos symbolism\").",
    ].join("\n");
    const resp = await client().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: QUERY_EXPANSION_SCHEMA,
        temperature: 0.7,
      },
    });
    const raw = resp.text;
    if (!raw) return [intent, ...keywords].slice(0, 8);
    const parsed = JSON.parse(raw) as { queries: string[] };
    // Dedupe, lowercase, trim.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of parsed.queries) {
      const norm = q.trim().toLowerCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
    return out.slice(0, 10);
  } catch (err) {
    ctx.log("agent.multiSourceSearch.expandQueries.failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    // Graceful fallback — use intent + keywords directly. The agent must
    // not fail the whole job just because Gemini blipped.
    return [intent, ...keywords].slice(0, 8);
  }
}

// ─── Per-source caller (catches per-source failures so a single down
// provider can't take the agent down) ──────────────────────────────────────

type SourceFn = (q: string) => Promise<ClipCandidate[]>;

async function callSource(
  name: SourceName,
  fn: SourceFn,
  query: string,
  ctx: AgentContext,
): Promise<ClipCandidate[]> {
  try {
    return await fn(query);
  } catch (err) {
    ctx.log("agent.multiSourceSearch.source_failed", {
      source: name,
      query,
      reason: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── Pexels adapter — wraps findStockVideoByPrompt into a candidate shape ──
// findStockVideoByPrompt returns the SINGLE best match; we still want it in
// the candidate pool. Other sources return arrays.

async function searchPexelsAdapter(query: string): Promise<ClipCandidate[]> {
  const clip = await findStockVideoByPrompt({
    prompt: query,
    targetSeconds: 5,
    brandIndustry: null,
    topicTitle: null,
    shotType: null,
  });
  if (!clip) return [];
  return [
    {
      source: "pexels",
      sourceId: String(clip.pexelsPageUrl?.match(/(\d+)$/)?.[1] ?? query),
      url: clip.url,
      previewUrl: clip.url,
      width: clip.width,
      height: clip.height,
      durationSec: clip.durationSec,
      query,
      attribution: `${clip.photographer} via Pexels`,
      metadata: { pexelsPageUrl: clip.pexelsPageUrl },
    },
  ];
}

// ─── AI scene generation (optional 5th source) ─────────────────────────────
// One Runway/Luma generation per scene, only when ctx.includeAiScenes is on.
// Reuses the existing video-providers registry so we don't duplicate provider
// auth / cost-tracking logic.

async function callAiScene(
  scene: MultiSourceSearchInput["scene"],
  ctx: AgentContext,
): Promise<ClipCandidate[]> {
  if (!ctx.includeAiScenes) return [];
  try {
    const result = await registryGenerate({
      prompt: scene.visualGoal,
      durationSec: 5,
      aspectRatio: "9:16",
      brandIndustry: ctx.brandIndustry ?? null,
      topicTitle: ctx.topic,
      shotType: null,
    });
    return [
      {
        source: result.provider as SourceName,
        sourceId: `${result.provider}-${ctx.renderJobId}-${scene.sceneId}`,
        url: result.url,
        width: result.width,
        height: result.height,
        durationSec: result.durationSec,
        query: scene.searchIntent,
        attribution: result.attribution ?? `via ${result.provider}`,
        metadata: result.metadata ?? {},
      },
    ];
  } catch (err) {
    ctx.log("agent.multiSourceSearch.ai_scene_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────
// Audit insert. Worker may insert the SAME (renderJobId, sourceId) pair
// twice if a query expansion produced duplicates that survived dedup; we
// just upsert based on the audit table's NOT-uniquely-keyed shape (each
// row is independent — the index on render_id+scene_number is non-unique).

async function persistCandidates(
  renderJobId: string,
  sceneNumber: number,
  candidates: ClipCandidate[],
  ctx: AgentContext,
): Promise<void> {
  if (candidates.length === 0) return;
  try {
    const admin = createAdminClient();
    const rows = candidates.map((c) => ({
      render_job_id: renderJobId,
      scene_number: sceneNumber,
      source: c.source,
      source_id: c.sourceId,
      url: c.url,
      preview_url: c.previewUrl ?? null,
      width: c.width,
      height: c.height,
      duration_sec: c.durationSec,
      query: c.query,
      was_selected: false,
      metadata: c.metadata ?? null,
    }));
    await admin.from("scene_candidates").insert(rows);
  } catch (err) {
    // Persistence failures shouldn't block the pipeline — log + continue.
    captureFallback("agent.multiSourceSearch.persist_failed", err, {
      renderJobId,
      sceneNumber,
      count: candidates.length,
    });
  }
}

// ─── Dedupe ────────────────────────────────────────────────────────────────

function dedupe(in_: ClipCandidate[]): ClipCandidate[] {
  const seen = new Set<string>();
  const out: ClipCandidate[] = [];
  for (const c of in_) {
    const key = `${c.source}:${c.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function runMultiSourceSearch(
  input: MultiSourceSearchInput,
  ctx: AgentContext,
): Promise<MultiSourceSearchOutput> {
  const { scene, perSourceLimit } = input;
  ctx.log("agent.multiSourceSearch.start", { sceneId: scene.sceneId });

  // 1. Expand queries
  const queries = await expandQueries(scene.searchIntent, scene.keywords, ctx);

  // 2. Fan out — 4 stock sources × top 3 queries each. Keep the cross-product
  // small enough that we don't hammer rate limits: 4 sources × 3 queries = 12
  // round-trips per scene. 4 scenes = 48 round-trips per video.
  const topQueries = queries.slice(0, 3);

  const allBatches = await Promise.all(
    topQueries.flatMap((q) => [
      callSource("pexels",  searchPexelsAdapter, q, ctx),
      callSource("pixabay", (qq) => searchPixabay(qq, { perPage: perSourceLimit, orientation: "all" }), q, ctx),
      callSource("mixkit",  (qq) => searchMixkit(qq,  { limit: perSourceLimit }), q, ctx),
      callSource("coverr",  (qq) => searchCoverr(qq,  { limit: perSourceLimit }), q, ctx),
    ]),
  );

  // Optional 5th source — fires once per scene, not per query.
  const aiBatch = await callAiScene(scene, ctx);

  const flat = [...allBatches.flat(), ...aiBatch];
  const deduped = dedupe(flat);

  // 3. Persist audit trail
  await persistCandidates(ctx.renderJobId, scene.sceneId, deduped, ctx);

  ctx.log("agent.multiSourceSearch.done", {
    sceneId: scene.sceneId,
    queriesUsed: topQueries.length,
    totalCandidates: deduped.length,
    perSource: Object.fromEntries(
      (["pexels", "pixabay", "mixkit", "coverr", "runway", "luma"] as SourceName[]).map(
        (s) => [s, deduped.filter((c) => c.source === s).length],
      ),
    ),
  });

  return {
    sceneId: scene.sceneId,
    candidates: deduped,
    expandedQueries: queries,
  };
}
