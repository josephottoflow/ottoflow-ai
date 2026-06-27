/**
 * Gemini client + research-task helpers (uses @google/genai unified SDK).
 *
 * All helpers are server-side (worker or route handlers). Browser code must
 * never import this file directly.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { addBreadcrumb, captureFallback } from "./observability";
import { industryConstraintBlock } from "./creative/creative-direction";
import type {
  BrandProfile,
  BrandProfileService,
  BrandProfilePersona,
  BrandTopicCategory,
  DbCompetitor,
  DbKeyword,
  DbContentPillar,
  KeywordOverlayBundle,
} from "./types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 90_000);
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5_000;

// ─── Variation entropy (Phase 1A — VIDEO_VARIATION_AUDIT §P1.1 + §P1.2) ─────
// Every Gemini structured-output call gets a fresh seed + jittered temperature
// so identical inputs no longer produce identical outputs. At temp 0.4 (the
// previous hardcoded value) the model collapsed to "median" responses; lifting
// to a 0.65-0.75 band with per-call seeds restores meaningful response variety
// without compromising JSON-schema adherence.
function entropy(): { seed: number; temperature: number } {
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    temperature: 0.65 + Math.random() * 0.1, // 0.65 - 0.75
  };
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  client = new GoogleGenAI({ apiKey });
  return client;
}

// ─── Timeout + retry guardrails (audit H3) ───────────────────────────────────

export class GeminiTimeoutError extends Error {
  constructor(timeoutMs: number, label: string) {
    super(`Gemini call "${label}" timed out after ${timeoutMs}ms`);
    this.name = "GeminiTimeoutError";
  }
}

/** Race a promise against a timeout. Rejects with GeminiTimeoutError on miss. */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new GeminiTimeoutError(timeoutMs, label)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeoutP]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Classify an error as retryable. Conservative: only retry on transient
 * conditions (rate limit, server error, network blip). Client errors and
 * SDK validation errors are NOT retried.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof GeminiTimeoutError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // HTTP status codes — Gemini SDK surfaces these in error.message
  if (/(?:^|[^0-9])(429|500|502|503|504)(?:[^0-9]|$)/.test(msg)) return true;
  // Rate / quota wording variations
  if (/rate.?limit|quota|too many requests|temporarily unavailable/.test(msg)) {
    return true;
  }
  // Network-level
  if (/econnreset|etimedout|enotfound|socket hang up|fetch failed/.test(msg)) {
    return true;
  }
  return false;
}

/** Exponential backoff with cap. attempt is 0-indexed. */
function backoffDelay(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wrap a Gemini call with timeout + bounded retry on transient errors.
 * Returns on first success. Propagates the last error if all attempts fail.
 */
async function callGemini<T>(label: string, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(fn(attempt), TIMEOUT_MS, label);
    } catch (err) {
      lastErr = err;
      const retryable = isRetryable(err);
      // Every attempt — failed or otherwise — drops a breadcrumb so the
      // captured exception below has its full retry history attached.
      addBreadcrumb("gemini.retry", `attempt ${attempt + 1}/${MAX_RETRIES} failed`, {
        label,
        attempt: attempt + 1,
        retryable,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      if (attempt === MAX_RETRIES - 1 || !retryable) break;
      await sleep(backoffDelay(attempt));
    }
  }
  // Terminal failure — capture with rich context so we can spot patterns
  // (which label, which model, did we exhaust retries vs. fail fast).
  captureFallback("gemini.call.exhausted", lastErr, {
    label,
    model: MODEL,
    timeoutMs: TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    finalAttempts: MAX_RETRIES,
  });
  throw lastErr;
}

// ─── JSON schemas (Type-based for strict structured output) ──────────────────

const stringArray: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };

const serviceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
  },
  required: ["name", "description"],
};

const personaSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    role: { type: Type.STRING },
    goals: stringArray,
    pain_points: stringArray,
    channels: stringArray,
  },
  required: ["name", "role", "goals", "pain_points", "channels"],
};

const brandProfileSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    positioning_statement: { type: Type.STRING },
    value_propositions: stringArray,
    services: { type: Type.ARRAY, items: serviceSchema },
    products: { type: Type.ARRAY, items: serviceSchema },
    offers: stringArray,
    brand_voice: {
      type: Type.OBJECT,
      properties: {
        tone: stringArray,
        vocabulary_dos: stringArray,
        vocabulary_donts: stringArray,
        example_phrases: stringArray,
      },
      required: ["tone", "vocabulary_dos", "vocabulary_donts", "example_phrases"],
    },
    audience: {
      type: Type.OBJECT,
      properties: {
        demographics: stringArray,
        psychographics: stringArray,
        geographies: stringArray,
      },
      required: ["demographics", "psychographics", "geographies"],
    },
    icp: {
      type: Type.OBJECT,
      properties: {
        industries: stringArray,
        company_sizes: stringArray,
        roles: stringArray,
        pain_points: stringArray,
      },
      required: ["industries", "company_sizes", "roles", "pain_points"],
    },
    personas: { type: Type.ARRAY, items: personaSchema },
    seed_keywords: stringArray,
    seed_competitors: stringArray,
  },
  required: [
    "summary",
    "positioning_statement",
    "value_propositions",
    "services",
    "products",
    "offers",
    "brand_voice",
    "audience",
    "icp",
    "personas",
    "seed_keywords",
    "seed_competitors",
  ],
};

const competitorSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    website: { type: Type.STRING },
    summary: { type: Type.STRING },
    positioning: { type: Type.STRING },
    strengths: stringArray,
    weaknesses: stringArray,
  },
  required: ["name", "summary", "strengths", "weaknesses"],
};

const competitorListSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    competitors: { type: Type.ARRAY, items: competitorSchema },
  },
  required: ["competitors"],
};

const keywordSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    term: { type: Type.STRING },
    intent: {
      type: Type.STRING,
      enum: ["informational", "commercial", "transactional", "navigational"],
    },
    search_volume: { type: Type.NUMBER },
    competition_score: { type: Type.NUMBER },
    relevance_score: { type: Type.NUMBER },
    opportunity_score: { type: Type.NUMBER },
  },
  required: ["term", "intent", "relevance_score", "opportunity_score"],
};

const pillarSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
    content_types: stringArray,
    example_topics: stringArray,
    priority: { type: Type.NUMBER },
  },
  required: ["name", "description", "content_types", "example_topics", "priority"],
};

const seoBundleSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    keywords: { type: Type.ARRAY, items: keywordSchema },
    content_pillars: { type: Type.ARRAY, items: pillarSchema },
  },
  required: ["keywords", "content_pillars"],
};

// ─── Generic structured-output helper ────────────────────────────────────────

/**
 * Gemini has a hard incompatibility:
 *
 *   "Tool use with a response mime type: 'application/json' is unsupported"
 *
 * You can use responseMimeType:'application/json' + responseSchema (strict
 * structured output), OR you can use tools (urlContext, googleSearch, etc.),
 * but NOT both in the same call.
 *
 * Strategy:
 *  - No tools  → strict mode: send responseMimeType + responseSchema, parse
 *                directly.
 *  - With tools → lenient mode: drop the mime type, append the schema as a
 *                JSON instruction at the end of the prompt, parse text after
 *                stripping ``` code fences. Slightly less reliable but
 *                preserves grounding.
 */

/** Minimal-but-useful JSON-schema description for prompting the model. */
function schemaToHint(schema: Schema): string {
  return JSON.stringify(schema, null, 2);
}

/** Strip ```json … ``` (or plain ```) fences and trim whitespace. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) return fence[1].trim();
  // No fence — return as-is
  return trimmed;
}

// ─── Grounding metadata (V2 Phase 1 — evidence persistence) ─────────────────
// Research calls run with tools (googleSearch / urlContext). The response
// carries WHAT the model actually read: groundingMetadata.groundingChunks
// (search results) + groundingSupports (which output text each chunk backs),
// and urlContextMetadata (which URLs were fetched). Until Phase 1 all of it
// was discarded here — only resp.text survived. generateStructuredFull now
// surfaces it so the worker can persist evidence.

export interface GroundedSource {
  sourceType: "website" | "search_result";
  url: string;
  title?: string;
  /** Concatenated output segments this source backed (search grounding only). */
  snippet?: string;
}

export interface GenerationMeta {
  sources: GroundedSource[];
  tokensInput: number;
  tokensOutput: number;
}

/** Pull grounded sources + token usage off a raw Gemini response. */
function extractMeta(resp: unknown): GenerationMeta {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const r = resp as any;
  const sources: GroundedSource[] = [];

  const cand = r?.candidates?.[0];
  const gm = cand?.groundingMetadata;
  if (gm?.groundingChunks?.length) {
    // Map: chunk index → concatenated supported text segments.
    const snippetByChunk = new Map<number, string[]>();
    for (const sup of gm.groundingSupports ?? []) {
      const text = sup?.segment?.text;
      if (!text) continue;
      for (const idx of sup.groundingChunkIndices ?? []) {
        const arr = snippetByChunk.get(idx) ?? [];
        arr.push(text);
        snippetByChunk.set(idx, arr);
      }
    }
    gm.groundingChunks.forEach((chunk: any, idx: number) => {
      const web = chunk?.web;
      if (!web?.uri) return;
      sources.push({
        sourceType: "search_result",
        url: web.uri,
        title: web.title ?? undefined,
        snippet: snippetByChunk.get(idx)?.join("\n") || undefined,
      });
    });
  }

  // urlContext tool: which URLs Gemini fetched inline. Not in the 0.3 SDK
  // typings, but present on the wire — read defensively.
  const urlMeta =
    cand?.urlContextMetadata?.urlMetadata ?? cand?.url_context_metadata?.url_metadata;
  if (Array.isArray(urlMeta)) {
    for (const m of urlMeta) {
      const url = m?.retrievedUrl ?? m?.retrieved_url;
      if (url) sources.push({ sourceType: "website", url });
    }
  }

  const usage = r?.usageMetadata;
  return {
    sources,
    tokensInput: usage?.promptTokenCount ?? 0,
    tokensOutput: usage?.candidatesTokenCount ?? 0,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

interface StructuredOpts {
  prompt: string;
  schema: Schema;
  tools?: Array<{ urlContext?: object; googleSearch?: object }>;
  systemInstruction?: string;
  label?: string;
  /** Sprint 20 — optional images (base64) for multimodal VISION (e.g. the AI
   * Creative Review looks at the rendered creative). */
  images?: Array<{ mimeType: string; data: string }>;
}

async function generateStructured<T>(opts: StructuredOpts): Promise<T> {
  const { data } = await generateStructuredFull<T>(opts);
  return data;
}

/**
 * Extract the outermost balanced JSON object from a string, ignoring any prose
 * or code fences around it. Respects string literals + escapes so braces inside
 * strings are not counted. Returns null if no balanced object exists (e.g. the
 * output was truncated mid-stream — unrecoverable here).
 */
function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Tolerant JSON parse for Gemini structured output (Sprint 1B reliability).
 * Gemini's JSON mode occasionally emits invalid JSON on large objects (observed
 * in brand-profile extraction: malformed arrays mid-stream). This tries the raw
 * string first (happy path — zero behaviour change for valid JSON), then a small
 * sequence of SAFE repairs: drop trailing commas before `}`/`]`, and/or extract
 * the outermost balanced object to discard stray prose/fences. Throws the
 * ORIGINAL SyntaxError if every attempt fails, so the caller's existing error
 * message and behaviour are preserved as the last resort. The schema and output
 * format are unchanged — this only recovers otherwise-fatal malformed responses.
 */
function parseLenientJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (firstErr) {
    const stripTrailingCommas = (x: string) => x.replace(/,(\s*[}\]])/g, "$1");
    const balanced = extractBalancedJsonObject(raw);
    const candidates = [
      stripTrailingCommas(raw),
      ...(balanced ? [balanced, stripTrailingCommas(balanced)] : []),
    ];
    for (const c of candidates) {
      try {
        return JSON.parse(c) as T;
      } catch {
        /* try the next repair candidate */
      }
    }
    throw firstErr;
  }
}

async function generateStructuredFull<T>(
  opts: StructuredOpts
): Promise<{ data: T; meta: GenerationMeta }> {
  const usingTools = !!opts.tools && opts.tools.length > 0;

  const baseSystem =
    opts.systemInstruction ??
    "You are a senior brand strategist and SEO researcher. Be specific and concrete — never use generic filler.";

  // In tools mode we instruct the model in-band; in strict mode the SDK handles it.
  const promptWithSchemaHint = usingTools
    ? `${opts.prompt}

Return your response as a single JSON object that exactly matches this JSON
Schema (no extra commentary, no markdown fences, just the JSON object):

${schemaToHint(opts.schema)}`
    : opts.prompt;

  const systemInstruction = usingTools
    ? `${baseSystem} Always respond with a single JSON object matching the schema provided in the user message. Do not include explanations or code fences.`
    : `${baseSystem} Always return strictly valid JSON matching the requested schema.`;

  const resp = await callGemini(opts.label ?? "generateStructured", (attempt) => {
    // Phase 1A — temperature + seed jittered per-call (see entropy() above).
    // Phase 1B (P1.5) — each retry draws a FRESH seed and bumps temperature
    // +0.1 per attempt, so a retry explores instead of re-rolling the same
    // flaky answer.
    const { seed, temperature } = entropy();
    // Multimodal when images are supplied (Sprint 20 vision review), else text.
    const contents = opts.images && opts.images.length
      ? [{
          role: "user",
          parts: [
            { text: promptWithSchemaHint },
            ...opts.images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } })),
          ],
        }]
      : promptWithSchemaHint;
    return ai().models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
        // Strict structured output ONLY when no tools — Gemini rejects both together.
        ...(usingTools
          ? { tools: opts.tools }
          : { responseMimeType: "application/json", responseSchema: opts.schema }),
        temperature: Math.min(temperature + 0.1 * attempt, 1.0),
        seed,
      },
    });
  });

  const text = resp.text;
  if (!text) throw new Error("Gemini returned empty response");

  // In tools mode we may get markdown fences around the JSON; strip them.
  const cleaned = usingTools ? unfence(text) : text;

  try {
    return { data: parseLenientJson<T>(cleaned), meta: extractMeta(resp) };
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON output: ${(err as Error).message}\n\nRaw: ${cleaned.slice(0, 500)}`
    );
  }
}

// ─── Embeddings (V2 Phase 1 — vector memory) ─────────────────────────────────
// gemini-embedding-001 (GA; verified available on this key — text-embedding-004
// 404s on v1beta as of 2026-06) truncated to 768 dims via outputDimensionality,
// matching research_documents.embedding vector(768) in migration 010.
// Truncated Gemini embeddings are NOT pre-normalized → we L2-normalize before
// storing (cosine ordering is scale-invariant, but normalized vectors keep
// dot-product use cases open). Batched; failures degrade to null per text
// (evidence rows are stored regardless — embeddings are backfillable).

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;
const EMBED_BATCH = 100; // API max per request

function l2Normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

export async function embedTexts(texts: string[]): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  const out: Array<number[] | null> = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      const resp = await callGemini("embedTexts", () =>
        ai().models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch,
          config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: EMBEDDING_DIMS },
        })
      );
      const embeddings = resp.embeddings ?? [];
      for (let j = 0; j < batch.length; j++) {
        const values = embeddings[j]?.values;
        out.push(
          values && values.length === EMBEDDING_DIMS ? l2Normalize(values) : null
        );
      }
    } catch (err) {
      // Best-effort: evidence persistence must NEVER fail on embedding errors.
      captureFallback("gemini.embed.batch_failed", err, {
        batchStart: i,
        batchSize: batch.length,
      });
      for (let j = 0; j < batch.length; j++) out.push(null);
    }
  }
  return out;
}

// ─── Evidence enrichment (V2 Phase 1.5) ──────────────────────────────────────
// One cheap structured call per captured website source fills the taxonomy
// columns (summary / entities / keywords) at capture time — without this the
// columns stay NULL forever and entity-level features (competitor tracking,
// gap analysis) have nothing to query.

export interface EvidenceEnrichment {
  summary: string;
  entities: {
    organizations: string[];
    people: string[];
    products: string[];
    locations: string[];
  };
  keywords: string[];
}

const evidenceEnrichmentSchema: Schema = {
  type: Type.OBJECT,
  required: ["summary", "entities", "keywords"],
  properties: {
    summary: { type: Type.STRING },
    entities: {
      type: Type.OBJECT,
      required: ["organizations", "people", "products", "locations"],
      properties: {
        organizations: stringArray,
        people: stringArray,
        products: stringArray,
        locations: stringArray,
      },
    },
    keywords: stringArray,
  },
} as Schema;

export async function extractEvidenceEnrichment(input: {
  title: string | null;
  url: string | null;
  content: string;
}): Promise<{ data: EvidenceEnrichment; meta: GenerationMeta }> {
  const prompt = `
Analyze this captured research source and extract structured metadata.

SOURCE: ${input.title ?? "(untitled)"}${input.url ? ` — ${input.url}` : ""}

CONTENT:
${input.content.slice(0, 6000)}

Produce:
- summary: 1-2 sentences. What this source IS and what it claims — written as
  an internal research note, not marketing copy.
- entities: proper nouns actually present in the content (empty arrays are
  fine — do NOT invent).
- keywords: 5-10 short topical keywords/phrases this source is evidence for.
`.trim();

  return generateStructuredFull<EvidenceEnrichment>({
    prompt,
    schema: evidenceEnrichmentSchema,
    label: "extractEvidenceEnrichment",
    systemInstruction:
      "You are a research librarian cataloguing evidence. Be precise and literal — extract only what is present in the content.",
  });
}

// ─── Ask-the-Research (V2 Phase 2A) ──────────────────────────────────────────
// Answers a question STRICTLY from retrieved evidence chunks. Citations are
// numeric indices into the evidence list the caller supplied — the caller
// owns mapping them back to research_documents ids for the source viewer.

export interface EvidenceForAnswer {
  /** 1-based citation number shown to the model and the user. */
  n: number;
  sourceType: string;
  title: string | null;
  domain: string | null;
  capturedAt: string;
  content: string;
}

export interface ResearchAnswer {
  /** Markdown answer with inline [n] citations. */
  answer: string;
  /** Which evidence numbers were actually used. */
  cited: number[];
  /** True when the evidence was insufficient to really answer. */
  insufficient: boolean;
}

const researchAnswerSchema: Schema = {
  type: Type.OBJECT,
  required: ["answer", "cited", "insufficient"],
  properties: {
    answer: { type: Type.STRING },
    cited: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    insufficient: { type: Type.BOOLEAN },
  },
} as Schema;

export async function answerFromEvidence(input: {
  brandName: string;
  industry: string | null;
  question: string;
  evidence: EvidenceForAnswer[];
}): Promise<{ data: ResearchAnswer; meta: GenerationMeta }> {
  const evidenceBlock = input.evidence
    .map(
      (e) =>
        `[${e.n}] (${e.sourceType}${e.domain ? ` · ${e.domain}` : ""}${
          e.title ? ` · "${e.title}"` : ""
        } · captured ${e.capturedAt.slice(0, 10)})\n${e.content}`,
    )
    .join("\n\n---\n\n");

  const prompt = `
You are answering a question about the brand "${input.brandName}"${
    input.industry ? ` (${input.industry})` : ""
  } using ONLY the research evidence below.

QUESTION: ${input.question}

EVIDENCE:
${evidenceBlock}

RULES:
- Ground EVERY claim in the evidence. Cite with [n] immediately after the
  claim it supports. Multiple citations like [1][3] are fine.
- Do NOT use outside knowledge about the brand, market, or competitors.
  General reasoning to connect evidence is fine; invented facts are not.
- If the evidence only partially covers the question, answer what IS
  covered, say plainly what is missing, and set insufficient=true.
- If the evidence doesn't address the question at all, say so in one
  sentence and set insufficient=true. Never fabricate.
- Format: tight markdown. Lead with the direct answer; bullets for lists;
  no preamble, no "based on the evidence provided".
- cited: the list of [n] numbers you actually used.
`.trim();

  return generateStructuredFull<ResearchAnswer>({
    prompt,
    schema: researchAnswerSchema,
    label: "answerFromEvidence",
    systemInstruction:
      "You are a rigorous brand research analyst. You answer only from supplied evidence, cite every claim, and clearly flag gaps. You never invent facts.",
  });
}

// ─── Opportunity mining (V2 Phase 2C — Intelligence → Ideas) ─────────────────
// Mines the evidence corpus for content opportunities through four lenses
// (pain points, repeated themes, competitor gaps, emerging trends). Every
// opportunity MUST cite the evidence digests [n] that support it — the
// caller maps those back to research_documents ids and DROPS any idea
// without valid citations ("grounded ideas only").

export interface EvidenceDigest {
  /** 1-based reference number shown to the model. */
  n: number;
  sourceType: string;
  domain: string | null;
  title: string | null;
  capturedAt: string;
  /** Summary if enriched, else a content excerpt. */
  digest: string;
}

export type OpportunityKind = "pain_point" | "theme" | "competitor_gap" | "trend";

export interface MinedOpportunity {
  title: string;
  description: string;
  category: string;          // existing brand_topics category enum
  opportunity_kind: OpportunityKind;
  hook_angle: string;
  seed_keyword: string;
  /** Why this opportunity exists — written against the cited evidence. */
  rationale: string;
  /** Evidence digest numbers [n] supporting this idea. */
  evidence_refs: number[];
  /** Model's own confidence this is a real, distinct opportunity (0-1). */
  model_confidence: number;
  /** Alignment with the brand's pillars/positioning (0-1). */
  strategic_relevance: number;
}

const minedOpportunitySchema: Schema = {
  type: Type.OBJECT,
  required: ["opportunities"],
  properties: {
    opportunities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: [
          "title",
          "description",
          "category",
          "opportunity_kind",
          "hook_angle",
          "seed_keyword",
          "rationale",
          "evidence_refs",
          "model_confidence",
          "strategic_relevance",
        ],
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          category: { type: Type.STRING },
          opportunity_kind: { type: Type.STRING },
          hook_angle: { type: Type.STRING },
          seed_keyword: { type: Type.STRING },
          rationale: { type: Type.STRING },
          evidence_refs: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          model_confidence: { type: Type.NUMBER },
          strategic_relevance: { type: Type.NUMBER },
        },
      },
    },
  },
} as Schema;

export async function mineOpportunities(input: {
  brandName: string;
  industry: string | null;
  positioning: string | null;
  pillars: string[];
  competitorNames: string[];
  existingTopicTitles: string[];
  evidence: EvidenceDigest[];
  targetCount?: number;
}): Promise<{ data: { opportunities: MinedOpportunity[] }; meta: GenerationMeta }> {
  const target = input.targetCount ?? 10;
  const evidenceBlock = input.evidence
    .map(
      (e) =>
        `[${e.n}] (${e.sourceType}${e.domain ? ` · ${e.domain}` : ""}${
          e.title ? ` · "${e.title}"` : ""
        } · ${e.capturedAt.slice(0, 10)})\n${e.digest}`,
    )
    .join("\n\n");

  const prompt = `
Mine this brand's research evidence for the ${target} strongest CONTENT
OPPORTUNITIES — specific, actionable angles the brand should publish about.

BRAND: ${input.brandName}${input.industry ? ` (${input.industry})` : ""}
${input.positioning ? `POSITIONING: ${input.positioning}` : ""}
${input.pillars.length ? `CONTENT PILLARS: ${input.pillars.join(" · ")}` : ""}
${input.competitorNames.length ? `KNOWN COMPETITORS: ${input.competitorNames.join(", ")}` : ""}

EVIDENCE (each item is one captured research source):
${evidenceBlock}

DETECTION LENSES — classify each opportunity as exactly one opportunity_kind:
- pain_point:     a customer pain/objection/frustration visible in the evidence
- theme:          a message or subject that REPEATS across multiple sources
- competitor_gap: something competitors don't say/cover that this brand can own
- trend:          an emerging shift, change, or rising subject in the evidence

HARD RULES:
- evidence_refs: the [n] numbers that ACTUALLY support the opportunity.
  Minimum 1. An opportunity you cannot ground in the evidence must not be
  emitted at all. Prefer 2-4 refs; never list refs that don't support it.
- rationale: 1-2 sentences explaining WHY this opportunity exists, written
  against the cited evidence ("Three sources mention X…", "Competitors
  emphasize Y but never Z…"). No generic filler.
- model_confidence: how sure you are this is a real, distinct, non-generic
  opportunity (0.0-1.0). Be honest — a weak single-source hunch is ≤0.4.
- strategic_relevance: fit with the brand's positioning + pillars (0.0-1.0).
- category: one of educational | storytelling | ugc | product-demo |
  listicle | problem-solution | founder-story
- title ≤70 chars, creator-usable. hook_angle <20 words, scroll-stopping.
- TITLE VARIETY (hard rule): use the brand name in AT MOST 3 titles total,
  and never start two titles with the same word. Vary structures: questions,
  bold claims, "vs" framings, numbers, second-person.
- LENS DIVERSITY: cover as many of the four lenses as the evidence honestly
  supports — if pain points or trends ARE present in the evidence, include
  at least one of each. Never force a lens the evidence doesn't support,
  and never relabel a competitor_gap as something else to fake variety.
- AVOID duplicating these existing topics: ${
    input.existingTopicTitles.slice(0, 40).join(" | ") || "(none)"
  }
- Quality over quantity: if the evidence only supports 5 strong
  opportunities, return 5.
`.trim();

  return generateStructuredFull<{ opportunities: MinedOpportunity[] }>({
    prompt,
    schema: minedOpportunitySchema,
    label: "mineOpportunities",
    systemInstruction:
      "You are a content strategist who works ONLY from evidence. Every opportunity you surface is grounded in the supplied research, cited precisely, and explained plainly. You never pad the list with generic ideas.",
  });
}

/**
 * Batch enrichment (Hardening v1, P1) — one structured call enriches ALL of a
 * run's search-claim sources (each is short), instead of per-source calls.
 * Items are addressed by [n]; the caller maps n back to stored row ids.
 */
export interface BatchEnrichmentItem {
  n: number;
  domain: string | null;
  title: string | null;
  content: string;
}

const evidenceEnrichmentBatchSchema: Schema = {
  type: Type.OBJECT,
  required: ["enrichments"],
  properties: {
    enrichments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["n", "summary", "entities", "keywords"],
        properties: {
          n: { type: Type.INTEGER },
          summary: { type: Type.STRING },
          entities: {
            type: Type.OBJECT,
            required: ["organizations", "people", "products", "locations"],
            properties: {
              organizations: stringArray,
              people: stringArray,
              products: stringArray,
              locations: stringArray,
            },
          },
          keywords: stringArray,
        },
      },
    },
  },
} as Schema;

export async function extractEvidenceEnrichmentBatch(
  items: BatchEnrichmentItem[],
): Promise<{
  data: { enrichments: Array<EvidenceEnrichment & { n: number }> };
  meta: GenerationMeta;
}> {
  const block = items
    .slice(0, 40)
    .map(
      (it) =>
        `[${it.n}] (${it.domain ?? "unknown"}${it.title ? ` · "${it.title}"` : ""})\n${it.content.slice(0, 800)}`,
    )
    .join("\n\n");

  const prompt = `
Catalogue these research evidence items. For EACH item [n] produce:
- summary: ONE sentence — what this evidence claims, as an internal research
  note (not marketing copy).
- entities: proper nouns actually present in that item's text (empty arrays
  are fine — never invent).
- keywords: 3-6 short topical keywords/phrases the item is evidence for.

ITEMS:
${block}

Return one enrichment per item, same [n] numbering, no items skipped.
`.trim();

  return generateStructuredFull<{
    enrichments: Array<EvidenceEnrichment & { n: number }>;
  }>({
    prompt,
    schema: evidenceEnrichmentBatchSchema,
    label: "extractEvidenceEnrichmentBatch",
    systemInstruction:
      "You are a research librarian cataloguing evidence. Be precise and literal — extract only what is present in each item.",
  });
}

/** Embed a single query for retrieval (RETRIEVAL_QUERY task type). */
export async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const resp = await callGemini("embedQuery", () =>
      ai().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: EMBEDDING_DIMS },
      })
    );
    const values = resp.embeddings?.[0]?.values;
    return values && values.length === EMBEDDING_DIMS ? l2Normalize(values) : null;
  } catch (err) {
    captureFallback("gemini.embed.query_failed", err, {});
    return null;
  }
}

// ─── Brand Research helpers ──────────────────────────────────────────────────

export async function extractBrandProfile(input: {
  name: string;
  website: string;
  industry: string;
}): Promise<BrandProfile> {
  const { data } = await extractBrandProfileFull(input);
  return data;
}

/** Grounded variant — also returns which URLs were read + token usage. */
export async function extractBrandProfileFull(input: {
  name: string;
  website: string;
  industry: string;
}): Promise<{ data: BrandProfile; meta: GenerationMeta }> {
  const prompt = `
Analyze this company and extract a complete brand profile.

Company:  ${input.name}
Website:  ${input.website}
Industry: ${input.industry}

Fetch the homepage and 1-2 supporting pages (About, Services/Products, Pricing) using
the URL context tool. Read carefully — extract real specifics from the site, not
guesses based on the industry alone.

If a section is genuinely not represented on the site, still produce a thoughtful
inferred answer based on the industry + visible positioning, but mark inferred
items by prefacing them with "(inferred) ".

Produce 3-5 personas, 5-10 seed keywords, and 3-6 named competitors you can
identify from the site or its market.
`.trim();

  return generateStructuredFull<BrandProfile>({
    prompt,
    schema: brandProfileSchema,
    // urlContext lets Gemini fetch the website inline
    tools: [{ urlContext: {} }],
  });
}

export async function findCompetitors(input: {
  name: string;
  website: string;
  industry: string;
  seedCompetitors: string[];
  positioning: string;
}): Promise<Array<Omit<DbCompetitor, "id" | "brand_id" | "created_at" | "source">>> {
  const { data } = await findCompetitorsFull(input);
  return data;
}

/** Grounded variant — also returns the Google Search sources + token usage. */
export async function findCompetitorsFull(input: {
  name: string;
  website: string;
  industry: string;
  seedCompetitors: string[];
  positioning: string;
}): Promise<{
  data: Array<Omit<DbCompetitor, "id" | "brand_id" | "created_at" | "source">>;
  meta: GenerationMeta;
}> {
  const prompt = `
You are doing competitor research for "${input.name}" (${input.website}),
which positions itself as: "${input.positioning}"
Industry: ${input.industry}

Find 6-10 of their most relevant competitors. Use Google Search to verify
each one currently exists and is active. Seed list from initial research:
${input.seedCompetitors.join(", ") || "(none)"}.

For each competitor return: name, website, 1-2 sentence summary of what they
do, their positioning vs the focal brand, and 3 strengths + 3 weaknesses
relative to "${input.name}".

Prefer direct competitors over adjacent products. Skip the focal brand itself.
`.trim();

  const { data: result, meta } = await generateStructuredFull<{
    competitors: Array<{
      name: string;
      website?: string;
      summary: string;
      positioning?: string;
      strengths: string[];
      weaknesses: string[];
    }>;
  }>({
    prompt,
    schema: competitorListSchema,
    tools: [{ googleSearch: {} }],
  });

  return {
    data: result.competitors.map((c) => ({
      name: c.name,
      website: c.website ?? null,
      summary: c.summary,
      positioning: c.positioning ?? null,
      strengths: c.strengths ?? [],
      weaknesses: c.weaknesses ?? [],
    })),
    meta,
  };
}

export async function generateSEOBundle(input: {
  name: string;
  industry: string;
  positioning: string;
  audience: string;
  seedKeywords: string[];
  services: BrandProfileService[];
  personas: BrandProfilePersona[];
}): Promise<{
  keywords: Array<Omit<DbKeyword, "id" | "brand_id" | "created_at">>;
  pillars: Array<Omit<DbContentPillar, "id" | "brand_id" | "created_at">>;
}> {
  const { data } = await generateSEOBundleFull(input);
  return data;
}

/** Usage-tracking variant (no tools — meta carries token counts only). */
export async function generateSEOBundleFull(input: {
  name: string;
  industry: string;
  positioning: string;
  audience: string;
  seedKeywords: string[];
  services: BrandProfileService[];
  personas: BrandProfilePersona[];
}): Promise<{
  data: {
    keywords: Array<Omit<DbKeyword, "id" | "brand_id" | "created_at">>;
    pillars: Array<Omit<DbContentPillar, "id" | "brand_id" | "created_at">>;
  };
  meta: GenerationMeta;
}> {
  const prompt = `
Generate an SEO + content foundation for "${input.name}".
Industry: ${input.industry}
Positioning: ${input.positioning}
Audience: ${input.audience}
Services/products: ${input.services.map((s) => s.name).join(", ")}
Personas: ${input.personas.map((p) => p.name + " (" + p.role + ")").join("; ")}
Seed keywords: ${input.seedKeywords.join(", ")}

Produce:

KEYWORDS (15-25 entries) — a mix of search intents (informational, commercial,
transactional, navigational), each scored on:
  - relevance_score   (0.0 - 1.0)  fit to this brand's audience
  - opportunity_score (0.0 - 1.0)  estimated win-rate considering competition

CONTENT PILLARS (4-6 entries) — broad themes the brand should own, each with
3-6 content_types from {blog, reel, short, tiktok, instagram_post, linkedin,
youtube_long, podcast, email, landing_page} and 4-8 example_topics. Set priority
0 for the most strategic, ascending.

Be specific. Pillars should reflect the actual services/personas above, not
generic "Industry Trends" filler.
`.trim();

  const { data: result, meta } = await generateStructuredFull<{
    keywords: Array<{
      term: string;
      intent: string;
      search_volume?: number;
      competition_score?: number;
      relevance_score: number;
      opportunity_score: number;
    }>;
    content_pillars: Array<{
      name: string;
      description: string;
      content_types: string[];
      example_topics: string[];
      priority: number;
    }>;
  }>({
    prompt,
    schema: seoBundleSchema,
  });

  return {
    data: {
      keywords: result.keywords.map((k) => ({
        term: k.term,
        intent: k.intent,
        search_volume: k.search_volume ?? null,
        competition_score: k.competition_score ?? null,
        trend_score: null,
        relevance_score: k.relevance_score,
        opportunity_score: k.opportunity_score,
      })),
      pillars: result.content_pillars.map((p) => ({
        name: p.name,
        description: p.description,
        content_types: p.content_types,
        example_topics: p.example_topics,
        priority: p.priority,
      })),
    },
    meta,
  };
}

// ─── Content Generation ──────────────────────────────────────────────────────

/**
 * Generate a single piece of content for a brand on a specific platform.
 *
 * The model receives:
 *   - The brand profile (positioning, voice, audience) — anchors tone
 *   - Optional content pillar — anchors topic
 *   - Optional user prompt — overrides topic / steering hint
 *
 * Returns title + preview (one-liner) + body. Body length is platform-aware:
 *   linkedin / facebook: 1500-2200 chars (~250-350 words)
 *   instagram / twitter:  600-900 chars
 *   blog:               2500-4000 chars (~500-700 words)
 *   email:              1200-1800 chars
 *
 * The whole call is bounded by withTimeout + withRetry via generateStructured.
 */
export interface GeneratedContent {
  title: string;
  preview: string;   // one-line hook / subhead
  body: string;      // full content
  hashtags?: string[]; // social platforms only
  cta?: string;      // suggested call-to-action
}

const PLATFORM_GUIDANCE: Record<string, string> = {
  linkedin:
    "LinkedIn post for professionals. 1500-2200 chars (~250-350 words). Open with a strong hook. Use short paragraphs (1-3 sentences each). Include 1-2 line breaks between paragraphs. End with a clear CTA. Add 3-5 relevant hashtags.",
  facebook:
    "Facebook post. 1200-1800 chars. Conversational, story-driven. Light emoji use OK. End with a question or CTA. 2-4 hashtags.",
  instagram:
    "Instagram caption. 600-900 chars. Strong visual hook in first line (since most users see only this in feed). Use line breaks generously. 8-15 hashtags listed at the end.",
  twitter:
    "X/Twitter post. 240-280 chars max — DO NOT exceed. Punchy hook. 1-2 hashtags. No emoji walls.",
  blog:
    "Blog article. 2500-4000 chars (~500-700 words). Use h2/h3 markdown headings (## and ###). Open with the problem, deliver value mid-piece, close with a CTA. Lists and short paragraphs preferred. No filler.",
  email:
    "Email body. 1200-1800 chars. Personal tone. Subject-line worthy first line. Single clear CTA at the end. Short paragraphs. No 'Dear Sir' nonsense.",
};

const contentSchema: Schema = {
  type: Type.OBJECT,
  required: ["title", "preview", "body"],
  properties: {
    title: { type: Type.STRING },
    preview: { type: Type.STRING },
    body: { type: Type.STRING },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
    cta: { type: Type.STRING },
  },
} as Schema;

export async function generateContentPiece(input: {
  brand: {
    name: string;
    website?: string | null;
    industry?: string | null;
    profile: BrandProfile;
  };
  platform: string;
  userPrompt?: string | null;
  pillar?: { name: string; description?: string | null; example_topics?: string[] } | null;
}): Promise<GeneratedContent> {
  const guidance = PLATFORM_GUIDANCE[input.platform] ?? PLATFORM_GUIDANCE.blog;
  const p = input.brand.profile;

  // Voice context — falls back gracefully if the brand profile is partial.
  // Real BrandProfile field names (see src/lib/types.ts):
  //   brand_voice.tone[] / vocabulary_dos[] / vocabulary_donts[]
  //   positioning_statement
  //   audience.demographics[] / icp.roles[]
  const voiceTone = p.brand_voice?.tone?.join(", ") || "Professional, clear, modern";
  const voiceDo = p.brand_voice?.vocabulary_dos?.slice(0, 8).join(", ") || "";
  const voiceDont = p.brand_voice?.vocabulary_donts?.slice(0, 6).join(", ") || "";
  const positioning =
    p.positioning_statement ||
    `${input.brand.name} in ${input.brand.industry || "its space"}`;
  const audience =
    p.audience?.demographics?.slice(0, 4).join(", ") ||
    p.icp?.roles?.slice(0, 4).join(", ") ||
    "the brand's target customers";

  const pillarBlock = input.pillar
    ? `\nPRIMARY CONTENT PILLAR: ${input.pillar.name}\n${input.pillar.description ?? ""}\nExample topics: ${(input.pillar.example_topics ?? []).slice(0, 4).join(" · ")}`
    : "";

  const promptBlock = input.userPrompt?.trim()
    ? `\nUSER REQUEST: ${input.userPrompt.trim()}\n(Use this as the topic; everything else above is context.)`
    : "";

  const prompt = `
Write a single piece of marketing content for the brand below.

BRAND: ${input.brand.name}
POSITIONING: ${positioning}
VOICE TONE: ${voiceTone}
${voiceDo ? `VOICE — DO: ${voiceDo}` : ""}
${voiceDont ? `VOICE — DON'T: ${voiceDont}` : ""}
AUDIENCE: ${audience}
${pillarBlock}${promptBlock}

PLATFORM: ${input.platform}
PLATFORM GUIDANCE:
${guidance}

REQUIREMENTS:
- title: a punchy, scroll-stopping headline (max 90 chars)
- preview: a one-line subhead / hook that summarizes the value (max 160 chars)
- body: the full content following the platform guidance above
- hashtags: 0 if blog/email, else 3-15 platform-appropriate hashtags as plain strings without the # symbol
- cta: a single-sentence call to action that fits the platform

Do not include the brand name in every sentence. Be specific. Don't hallucinate
features that aren't in the brand profile. Write in the brand's voice, not
generic marketing speak.
`.trim();

  return generateStructured<GeneratedContent>({
    prompt,
    schema: contentSchema,
    label: "generateContentPiece",
    systemInstruction:
      "You are a senior content strategist who writes scroll-stopping posts. You match brand voice precisely and never use cliches. Be concrete, specific, and human.",
  });
}

// ─── Video Generation Helpers ────────────────────────────────────────────────
//
// Video pipeline produces a narration script and a structured storyboard.
// Both use Gemini Flash for the "brain" — fast, JSON-mode-friendly, and
// already proven by the brand-research + content-generation pipelines.
//
// The actual video render is currently a placeholder URL (see
// /api/generate/route.ts) — the @google/genai SDK v0.3 we have installed
// only exposes generateImages, not generateVideos. When we upgrade the SDK
// or wire a direct REST call to Veo, swap the placeholder for the real call.

export interface VideoScript {
  hook: string;              // first 3-5 seconds, scroll-stopper
  body: string;              // main narration, plain text
  cta: string;               // closing call-to-action line
  estimatedDurationSec: number;
  voiceDirection: string;    // tone hint for TTS (e.g. "energetic, fast-paced")
}

const videoScriptSchema: Schema = {
  type: Type.OBJECT,
  required: ["hook", "body", "cta", "estimatedDurationSec", "voiceDirection"],
  properties: {
    hook: { type: Type.STRING },
    body: { type: Type.STRING },
    cta: { type: Type.STRING },
    estimatedDurationSec: { type: Type.INTEGER },
    voiceDirection: { type: Type.STRING },
  },
} as Schema;

// Phase 1B — VIDEO_VARIATION_AUDIT §P1.7. Without enforced rotation, Gemini
// collapses to the same hook structure on every run (residual Jaccard ~0.5 on
// hooks after Phase 1A — see PHASE_1A_VARIATION_REPORT). One archetype is
// drawn per script so the opening pattern varies across generations.
const HOOK_ARCHETYPES = [
  'negative-charge question ("Why does everyone…")',
  'outrageous claim ("Most X people don\'t know…")',
  'specific-number stat ("73% of … never realize…")',
  'pattern-interrupt scenario ("Picture this:…")',
  'first-person confession ("I used to think… until…")',
] as const;

const CTA_ARCHETYPES = [
  "link-in-bio direct ask",
  "DM / comment-the-keyword prompt",
  "scarcity or time pressure",
  "social proof (\"join the X others who…\")",
  "curiosity gap (tease what they'll find out)",
] as const;

function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function generateVideoScript(input: {
  prompt: string;
  style: string;
  musicVibe: string;
  targetSeconds: number;
}): Promise<VideoScript> {
  const hookArchetype = pick(HOOK_ARCHETYPES);
  const ctaArchetype = pick(CTA_ARCHETYPES);
  const prompt = `
Write a tight, scroll-stopping narration for a ${input.targetSeconds}-second
short-form ad video based on this brief.

BRIEF: ${input.prompt}
STYLE: ${input.style}
MUSIC VIBE: ${input.musicVibe}

REQUIREMENTS:
- hook: the first 3-5 seconds. Use this archetype: ${hookArchetype}.
  Adapt it naturally to the brief — do not copy the example wording.
  No "Hey guys" or "Did you know" cliches.
- body: the main message. 60-90 words. Specific, concrete. Should fit the
  remaining time after the hook.
- cta: a single closing line that drives action. ~10-15 words. Use this
  CTA archetype: ${ctaArchetype} — adapted to fit the brief.
- estimatedDurationSec: your honest estimate of total spoken duration
- voiceDirection: a short hint for TTS — energy, pace, gender-neutral tone

Total spoken duration should land within 2 seconds of ${input.targetSeconds}.
Write for the ear, not the page — short sentences, strong verbs.
`.trim();

  return generateStructured<VideoScript>({
    prompt,
    schema: videoScriptSchema,
    label: "generateVideoScript",
    systemInstruction:
      "You are a senior short-form ad copywriter. You write for TikTok, Reels, and Shorts. Every word earns its place. No filler, no cliches.",
  });
}

export interface StoryboardScene {
  index: number;             // 1-based
  durationSec: number;
  shotType: string;          // "close-up", "wide", "POV", "product hero", etc.
  cameraMove: string;        // "static", "slow push-in", "orbit", etc.
  description: string;       // one sentence visual description
  onScreenText?: string;     // overlay copy (kicker, stat, brand tag)
  voiceLine?: string;        // chunk of the narration this scene plays under
}

export interface Storyboard {
  scenes: StoryboardScene[];
  totalDurationSec: number;
  aestheticNotes: string;    // color palette, lighting, pacing notes
}

const storyboardSchema: Schema = {
  type: Type.OBJECT,
  required: ["scenes", "totalDurationSec", "aestheticNotes"],
  properties: {
    totalDurationSec: { type: Type.INTEGER },
    aestheticNotes: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["index", "durationSec", "shotType", "cameraMove", "description"],
        properties: {
          index: { type: Type.INTEGER },
          durationSec: { type: Type.INTEGER },
          shotType: { type: Type.STRING },
          cameraMove: { type: Type.STRING },
          description: { type: Type.STRING },
          onScreenText: { type: Type.STRING },
          voiceLine: { type: Type.STRING },
        },
      },
    },
  },
} as Schema;

export async function generateVideoStoryboard(input: {
  prompt: string;
  style: string;
  sceneCount: number;
  script: VideoScript;
  // Video Pipeline v2 P1a — structured brand + topic so storyboard
  // descriptions visibly reflect the brand's space, not generic stock
  // aesthetics. Previously industry was buried inside `prompt` as a
  // substring; surfacing it as labeled fields gives Gemini a stronger
  // signal. Both fields optional for backward compat with legacy callers
  // (free-form prompt without a brand/topic record).
  brand?: { name: string; industry?: string | null } | null;
  topic?: { title: string; category?: string | null } | null;
}): Promise<Storyboard> {
  // Build brand/topic header block. Empty when neither was provided so the
  // prompt stays clean for legacy free-form callers.
  const brandLine = input.brand
    ? `BRAND: ${input.brand.name}${input.brand.industry ? ` — operates in ${input.brand.industry}` : ""}`
    : "";
  const topicLine = input.topic
    ? `TOPIC: ${input.topic.title}${input.topic.category ? ` (category: ${input.topic.category})` : ""}`
    : "";
  const industryConstraint = input.brand?.industry
    ? `\n\nIMPORTANT: Every scene's \`description\` must visibly read as the **${input.brand.industry}** space. Generic stock-photo descriptions ("modern desk", "person on laptop", "minimalist studio") don't count — the viewer should be able to tell what industry this video is about from any single frame.`
    : "";

  const prompt = `
Build a ${input.sceneCount}-scene shot list for this short-form ad video.

${brandLine}
${topicLine}
ORIGINAL BRIEF: ${input.prompt}
STYLE: ${input.style}
TARGET DURATION: ${input.script.estimatedDurationSec} seconds

NARRATION HOOK:  ${input.script.hook}
NARRATION BODY:  ${input.script.body}
NARRATION CTA:   ${input.script.cta}

REQUIREMENTS:
- Exactly ${input.sceneCount} scenes. Index them 1..${input.sceneCount}.
- Distribute total duration across scenes; respect the hook getting more
  weight (3-5s minimum).
- Each scene specifies: shotType (close-up / wide / POV / product hero /
  text card / etc.), cameraMove (static / slow push-in / orbit / handheld
  / dolly / whip pan / etc.), description (one concrete visual sentence),
  optional onScreenText (overlay copy), optional voiceLine (which slice
  of the narration plays under it).
- aestheticNotes: 2-3 sentences on lighting, palette, pacing, references.

Be specific. "Product on a desk" is filler. "Walnut desk, golden hour
backlight from the left, hand reaching in from frame-right" is a shot.${industryConstraint}
`.trim();

  return generateStructured<Storyboard>({
    prompt,
    schema: storyboardSchema,
    label: "generateVideoStoryboard",
    systemInstruction:
      "You are a commercial director with a strong eye for short-form video. You write shot lists that DPs can execute. Be specific and visual.",
  });
}

/**
 * Generate a single hero/poster image for the video using Imagen 3.
 * Returns the image as a base64 data URL so the client can render it
 * without a separate storage roundtrip.
 *
 * Throws if Imagen 3 isn't enabled on the API key. Caller should treat
 * this as best-effort and continue without it on failure.
 */
// Phase 1B — VIDEO_VARIATION_AUDIT §P1.8. The old hard-coded "cinematic
// composition, professional commercial photography" suffix gave every hero
// frame the same magazine-stock aesthetic regardless of chosen style. A
// rotated lens + lighting pair lets `style` carry the visual direction.
const LENS_POOL = [
  "35mm film",
  "anamorphic widescreen",
  "iPhone Pro vertical",
  "Hasselblad medium format",
  "Super 16mm grain",
] as const;

const LIGHT_POOL = [
  "golden hour backlight",
  "neon nightscape",
  "soft window light",
  "harsh midday sun",
  "moody chiaroscuro",
] as const;

export async function generateHeroFrame(input: {
  prompt: string;
  style: string;
}): Promise<string> {
  const imagePrompt = `${input.style} style, ${input.prompt}, shot on ${pick(LENS_POOL)}, ${pick(LIGHT_POOL)}`;

  // Model name caveat: the Gemini v1beta API has shuffled Imagen names a
  // few times. `imagen-3.0-generate-002` returned 404 in production for our
  // tier (smoke test 2026-06-02). `imagen-3.0-fast-generate-001` is the
  // lighter-weight variant typically enabled on AI Studio keys. If your
  // key 404s on both, Imagen isn't enabled — the route falls back
  // gracefully (route.ts catches and skips the hero frame).
  // Phase 1A — per-call seed for Imagen too. Same brand+topic now yields
  // visibly different hero frames across runs.
  const { seed: imagenSeed } = entropy();
  const resp = await callGemini("generateHeroFrame", () =>
    ai().models.generateImages({
      model: "imagen-3.0-fast-generate-001",
      prompt: imagePrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "9:16",
        outputMimeType: "image/jpeg",
        seed: imagenSeed,
      },
    }),
  );

  // SDK shape: { generatedImages: [{ image: { imageBytes: string } }] }
  const first = resp.generatedImages?.[0];
  const bytes = first?.image?.imageBytes;
  if (!bytes) {
    throw new Error("Imagen returned no image bytes");
  }
  return `data:image/jpeg;base64,${bytes}`;
}

// ─── Video SEO copy ──────────────────────────────────────────────────────────
//
// Post copy generator for the Video Pipeline — produces a TikTok/Instagram-
// optimized title, description, and hashtag pack from the generated script.
// Users copy this directly into their upload flow on the platform of choice.

export interface VideoSEO {
  title: string;          // <= 80 chars — first line that grabs the algorithm
  description: string;    // 150-250 chars — full caption with hook + CTA
  hashtags: string[];     // 8-15 tags, no '#' prefix, mix of broad + niche
}

const videoSEOSchema: Schema = {
  type: Type.OBJECT,
  required: ["title", "description", "hashtags"],
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    hashtags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
} as Schema;

export async function generateVideoSEO(input: {
  prompt: string;
  script: VideoScript;
}): Promise<VideoSEO> {
  const prompt = `
Write the upload-ready post copy for a short-form video ad based on this
brief and narration.

BRIEF: ${input.prompt}
SCRIPT HOOK: ${input.script.hook}
SCRIPT BODY: ${input.script.body}
SCRIPT CTA: ${input.script.cta}

REQUIREMENTS:
- title: a single line, MAX 80 chars. The first thing TikTok/IG shows.
  Mirror the hook but tighter. Question or bold claim. NO emoji-spam, ONE
  tasteful emoji at most, often none.
- description: 150-250 chars. Opens with a scroll-stopper, mentions the
  product or category, ends with the CTA. Sound like a creator, not a
  brand. Plain text only (no markdown, no HTML).
- hashtags: 8-15 hashtags as plain strings WITHOUT the '#' prefix.
  Mix of:
    * 2-3 BROAD (high-volume, e.g. "tiktokmademebuyit", "viral")
    * 3-5 CATEGORY (mid-volume, niche-specific, e.g. "coffeelover",
      "espresso", "morningroutine")
    * 2-4 PRODUCT/INTENT (specific to this product, e.g.
      "subscriptionbox", "specialtycoffee", "baristalife")
    * 1-2 PLATFORM (e.g. "fyp", "foryoupage")
  No spaces inside a tag. No leading punctuation. Lowercase preferred.
`.trim();

  return generateStructured<VideoSEO>({
    prompt,
    schema: videoSEOSchema,
    label: "generateVideoSEO",
    systemInstruction:
      "You are a TikTok/IG growth specialist who writes upload copy that beats the algorithm. You know which hashtags compound and which dilute reach. Tight, native, on-platform tone — never corporate.",
  });
}

// ─── Brand Topics (Phase 1) ──────────────────────────────────────────────────
//
// Reads the full brand profile + competitors + keywords + pillars context
// and emits a batch of authentic, on-brand content topics the user can
// drive video generation from. Each topic is tagged with a category and
// carries a one-line hook angle so the downstream script generator can use
// it as a starting point.

export interface GeneratedBrandTopic {
  title: string;          // <= 70 chars, scroll-stopping
  description: string;    // 1-2 sentence pitch of what the video would cover
  category: BrandTopicCategory;
  seed_keyword: string;   // primary SEO seed this topic addresses
  hook_angle: string;     // one-line opening hook for the script generator
}

export interface GeneratedBrandTopicBundle {
  topics: GeneratedBrandTopic[];
}

const brandTopicCategoryEnum: Schema = {
  type: Type.STRING,
  enum: [
    "educational",
    "storytelling",
    "ugc",
    "product-demo",
    "listicle",
    "problem-solution",
    "founder-story",
  ],
} as Schema;

const generatedBrandTopicSchema: Schema = {
  type: Type.OBJECT,
  required: ["title", "description", "category", "seed_keyword", "hook_angle"],
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    category: brandTopicCategoryEnum,
    seed_keyword: { type: Type.STRING },
    hook_angle: { type: Type.STRING },
  },
} as Schema;

const generatedBrandTopicBundleSchema: Schema = {
  type: Type.OBJECT,
  required: ["topics"],
  properties: {
    topics: { type: Type.ARRAY, items: generatedBrandTopicSchema },
  },
} as Schema;

export async function generateBrandTopics(input: {
  brand: {
    name: string;
    industry: string | null;
    profile: BrandProfile;
  };
  seedKeywords?: string[];           // from keywords table if available
  competitorNames?: string[];        // from competitors table
  pillarHints?: { name: string; example_topics: string[] }[];
  targetCount?: number;              // default 40 — produces a usable batch
}): Promise<GeneratedBrandTopicBundle> {
  const { data } = await generateBrandTopicsFull(input);
  return data;
}

/** Usage-tracking variant (no tools — meta carries token counts only). */
export async function generateBrandTopicsFull(input: {
  brand: {
    name: string;
    industry: string | null;
    profile: BrandProfile;
  };
  seedKeywords?: string[];
  competitorNames?: string[];
  pillarHints?: { name: string; example_topics: string[] }[];
  targetCount?: number;
}): Promise<{ data: GeneratedBrandTopicBundle; meta: GenerationMeta }> {
  const targetCount = input.targetCount ?? 40;
  const { brand } = input;
  const profile = brand.profile;

  const personasBlock = profile.personas
    .slice(0, 3)
    .map((p) => `- ${p.name} (${p.role}): pains=${p.pain_points.join(", ")}`)
    .join("\n");

  const pillarBlock = (input.pillarHints ?? [])
    .slice(0, 6)
    .map(
      (p) =>
        `- ${p.name}${p.example_topics.length ? ` (e.g. ${p.example_topics.slice(0, 3).join(" / ")})` : ""}`,
    )
    .join("\n");

  const prompt = `
Generate exactly ${targetCount} short-form video content topics for this brand.
Mix categories so the brand has a diverse content slate — aim for at least
4 topics per category across all 7 categories.

BRAND: ${brand.name}
INDUSTRY: ${brand.industry ?? "unspecified"}
POSITIONING: ${profile.positioning_statement}
SUMMARY: ${profile.summary}

VALUE PROPS:
${profile.value_propositions.map((v) => `- ${v}`).join("\n")}

AUDIENCE:
- Demographics: ${profile.audience.demographics.join(", ")}
- Psychographics: ${profile.audience.psychographics.join(", ")}

ICP:
- Roles: ${profile.icp.roles.join(", ")}
- Pain points: ${profile.icp.pain_points.join(", ")}

PERSONAS:
${personasBlock}

${input.seedKeywords?.length ? `SEED KEYWORDS: ${input.seedKeywords.slice(0, 15).join(", ")}` : ""}
${input.competitorNames?.length ? `COMPETITORS: ${input.competitorNames.slice(0, 10).join(", ")}` : ""}
${pillarBlock ? `CONTENT PILLARS:\n${pillarBlock}` : ""}

PER-TOPIC REQUIREMENTS:
- title: max 70 chars. A title a creator would actually use on TikTok / Reels.
  No "Top 10..." cliches unless category is listicle. Scroll-stopping verbs.
- description: 1-2 sentences describing what the video covers. Not marketing
  copy — internal note for the script generator.
- category: one of: educational | storytelling | ugc | product-demo | listicle
  | problem-solution | founder-story
- seed_keyword: a single 1-3 word SEO seed this topic addresses
- hook_angle: one short sentence (under 20 words) — the opening hook the
  narration should start with. Use bold claim / question / pattern interrupt.

DO NOT:
- Repeat topic ideas
- Mention competitor brand names by name (unless founder-story category)
- Write generic "5 Tips for X" titles
- Use the brand name in every title — vary it

Generate ${targetCount} distinct topics now.
`.trim();

  return generateStructuredFull<GeneratedBrandTopicBundle>({
    prompt,
    schema: generatedBrandTopicBundleSchema,
    label: "generateBrandTopics",
    systemInstruction:
      "You are a short-form content strategist who has written for top creator brands. You think in topic clusters, not isolated videos. Every topic you generate is authentic to the brand, distinct from the others, and would score above-average on engagement.",
  });
}

// ─── Important Word Extraction (Phase 3) ─────────────────────────────────────
//
// Pulls the punchiest 1-3 word phrases out of a narration script and assigns
// approximate timing so the FFmpeg overlay renderer can drop them on-screen
// at the right millisecond. Timing is APPROXIMATE — Gemini estimates word
// position from text length. For production-grade timing accuracy, swap in
// ElevenLabs' alignment API or whisper.cpp forced alignment later.
//
// Output style: 6-12 keyword overlays per 30s of narration. NOT full
// captions. Think viral TikTok style: 1 punchy word every 2-4 seconds.

const keywordOverlaySchema: Schema = {
  type: Type.OBJECT,
  required: ["text", "start", "end"],
  properties: {
    text: { type: Type.STRING },
    start: { type: Type.NUMBER },
    end: { type: Type.NUMBER },
    emphasis: {
      type: Type.STRING,
      enum: ["normal", "punch", "highlight"],
    },
  },
} as Schema;

const keywordOverlayBundleSchema: Schema = {
  type: Type.OBJECT,
  required: ["keywords", "estimatedNarrationSec"],
  properties: {
    keywords: { type: Type.ARRAY, items: keywordOverlaySchema },
    estimatedNarrationSec: { type: Type.NUMBER },
  },
} as Schema;

export async function extractImportantWords(input: {
  narration: string;
  estimatedNarrationSec: number;
  density?: "sparse" | "balanced" | "dense"; // overlays per second budget
}): Promise<KeywordOverlayBundle> {
  const density = input.density ?? "balanced";
  // Density target (per 30s narration):
  //   sparse:   4 overlays  (one every 7.5s)
  //   balanced: 8 overlays  (one every 3.75s)
  //   dense:    14 overlays (one every 2.1s)
  const densityHint = {
    sparse: "4-5 keyword overlays per 30 seconds",
    balanced: "7-10 keyword overlays per 30 seconds",
    dense: "12-15 keyword overlays per 30 seconds",
  }[density];

  const prompt = `
You are designing on-screen keyword overlays for a short-form video, in the
viral TikTok / Reels style where ONLY the highest-impact words/phrases appear
on screen — NOT full captions.

NARRATION:
"""
${input.narration}
"""

TOTAL NARRATION DURATION: ${input.estimatedNarrationSec} seconds

YOUR JOB:
Pull out the words/phrases that should appear as bold on-screen text overlays.
Density target: ${densityHint}.

PER-OVERLAY REQUIREMENTS:
- text: 1-3 words, ALL CAPS. Pick punchy nouns + verbs. NEVER pick filler
  ("the", "a", "of", "you", "is").
- start: seconds from video start, the moment this word is spoken
- end: seconds from video start, when this overlay should disappear.
  Each overlay should be on-screen for 0.6 - 1.4 seconds.
- emphasis: 'punch' for the most important words (hook, big claims, CTA)
  | 'highlight' for callouts (numbers, brand names)
  | 'normal' for supporting punctuation words

TIMING ESTIMATION:
- Average speaking pace: ~3 words/second
- Distribute overlays across the full duration evenly (no clustering)
- Hook words land in the first 3 seconds
- CTA words land in the last 5 seconds
- Numbers, brand names, and emotional verbs always get an overlay

DO NOT:
- Caption the entire script (this is overlay-only, not captions)
- Use lowercase
- Include punctuation in the text field
- Overlap timings (each overlay's start must be >= previous overlay's end)

Generate the keyword overlay list now.
`.trim();

  return generateStructured<KeywordOverlayBundle>({
    prompt,
    schema: keywordOverlayBundleSchema,
    label: "extractImportantWords",
    systemInstruction:
      "You are a video editor who has cut clips for top creator brands. You know which words ON SCREEN make viewers stop scrolling. You never overload the frame.",
  });
}

// ─── Per-scene 3-word overlay extraction (Video Pipeline v2 P2) ──────────────
//
// Instead of one flat overlay list spread across the whole video (the
// `extractImportantWords` approach), this generates exactly 3 overlays per
// scene, timed within that scene's window. Pairs with P3 — the worker
// rotates position/style per scene (sceneIndex % 5), so the output reads
// as edited rather than a single drawtext stamp at fixed lower-third.
//
// Offsets are scene-local (0 .. scene.durationSec). The caller converts
// them to absolute timestamps by adding the cumulative scene start.

export interface SceneOverlayWord {
  text: string;        // ALL CAPS, 1-3 words
  offsetSec: number;   // seconds within the scene (0 .. durationSec)
  durationSec: number; // 0.6 .. 1.4 — how long it stays on screen
}

export interface SceneOverlays {
  sceneIndex: number;
  overlays: SceneOverlayWord[]; // exactly 3
}

export interface SceneOverlayBundle {
  scenes: SceneOverlays[];
}

const sceneOverlayWordSchema: Schema = {
  type: Type.OBJECT,
  required: ["text", "offsetSec", "durationSec"],
  properties: {
    text: { type: Type.STRING },
    offsetSec: { type: Type.NUMBER },
    durationSec: { type: Type.NUMBER },
  },
} as Schema;

const sceneOverlaysSchema: Schema = {
  type: Type.OBJECT,
  required: ["sceneIndex", "overlays"],
  properties: {
    sceneIndex: { type: Type.INTEGER },
    overlays: {
      type: Type.ARRAY,
      items: sceneOverlayWordSchema,
      // Note: Gemini's structured-output schema doesn't enforce
      // minItems/maxItems reliably. We sanity-check the count at the
      // call site and truncate/pad if needed. Prompt explicitly asks
      // for exactly 3, which the model honors in practice.
    },
  },
} as Schema;

const sceneOverlayBundleSchema: Schema = {
  type: Type.OBJECT,
  required: ["scenes"],
  properties: {
    scenes: { type: Type.ARRAY, items: sceneOverlaysSchema },
  },
} as Schema;

export async function extractSceneOverlays(input: {
  scenes: Array<{
    index: number;
    durationSec: number;
    description: string;
    voiceLine?: string | null;
  }>;
  // Full narration so Gemini knows the overall thread even when a
  // particular scene's voiceLine is missing or generic.
  narration: { hook: string; body: string; cta: string };
}): Promise<SceneOverlayBundle> {
  const scenesBlock = input.scenes
    .map(
      (s) =>
        `Scene ${s.index} (${s.durationSec}s): ${s.description}` +
        (s.voiceLine ? `\n  voice-over: "${s.voiceLine}"` : ""),
    )
    .join("\n");

  const prompt = `
You are designing on-screen keyword overlays for a short-form vertical video,
in the viral TikTok / Reels style where ONLY the highest-impact words appear
on screen — never full captions.

For EACH scene below, pick exactly 3 keyword overlays. The text of each
overlay must reflect what happens or is said in that specific scene — not
the overall video.

NARRATION HOOK: ${input.narration.hook}
NARRATION BODY: ${input.narration.body}
NARRATION CTA:  ${input.narration.cta}

SCENES:
${scenesBlock}

PER-OVERLAY REQUIREMENTS:
- text: exactly 1-3 words, ALL CAPS. Punchy nouns/verbs. Never filler
  ("the", "a", "of", "you", "is"). Never the brand name unless the scene
  is explicitly about the brand.
- offsetSec: seconds within THIS scene's window (0.0 .. durationSec).
  Distribute the 3 overlays across the scene: early (≤ 25%), middle
  (40-60%), late (≥ 75%). Do not overlap.
- durationSec: 0.6 - 1.4 seconds on screen. Shorter for punchy single
  words, longer for 3-word phrases.

CRITICAL CONSTRAINTS:
- EXACTLY 3 overlays per scene. Not 2. Not 4. Three.
- All 3 overlays for a scene must be DIFFERENT words (no repetition)
- offsetSec + durationSec must be ≤ the scene's durationSec
- The 3 overlays should feel like a beat: setup → reinforcement → payoff

Generate one entry per scene with sceneIndex matching the scene number.
`.trim();

  return generateStructured<SceneOverlayBundle>({
    prompt,
    schema: sceneOverlayBundleSchema,
    label: "extractSceneOverlays",
    systemInstruction:
      "You are a video editor who has cut clips for top creator brands. You design overlays that reinforce — never compete with — what's happening on screen. You think in 3-beat scene rhythms: setup, hit, payoff.",
  });
}

// ─── Creative concept (Brand Creative Orchestrator Phase B) ──────────────────
//
// One structured call composes the REVIEWABLE creative thinking for a chosen
// hierarchy: visual concept, rationale, headline, CTA, and the Imagen
// background prompt. The hierarchy itself is selected in code
// (src/lib/creative/hierarchy.ts) — the model executes the strategy, it
// doesn't pick it. model_confidence is the model's honest self-assessment of
// how well this hierarchy fits the content; it feeds 30% of the blended
// confidence shown at the approval gate.
//
// SAFETY: this call receives asset DESCRIPTIONS (kind + label + dimensions),
// never asset bytes. The background prompt it returns must describe a
// background only — no logos, no readable text, no people/faces (those are
// composited deterministically in Phase C). The caller validates the prompt
// against a forbidden-token list and recomposes on violation.

export interface CreativeConcept {
  /** The core opposition the topic dramatizes, e.g. "Complexity vs Simplicity". */
  visual_tension: string;
  /** Concrete abstract-safe visual that depicts the tension resolving. */
  visual_metaphor: string;
  visual_concept: string;
  visual_rationale: string;
  headline: string;
  subheadline: string;
  cta: string;
  background_prompt: string;
  /** Creative Memory (Sprint 19) — structured art-direction metadata persisted on
   * every creative so future generations can recall recent directions and pick a
   * DIFFERENT valid world for controlled variety. */
  creative_direction: {
    world: string;
    environment: string;
    lighting: string;
    lens: string;
    composition: string;
    mood: string;
    color_grade: string;
    emotional_tone: string;
  };
  /** Model's self-assessed fit of this hierarchy for this content (0-1). */
  model_confidence: number;
}

const creativeConceptSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "visual_tension",
    "visual_metaphor",
    "visual_concept",
    "visual_rationale",
    "headline",
    "subheadline",
    "cta",
    "background_prompt",
    "creative_direction",
    "model_confidence",
  ],
  properties: {
    visual_tension: { type: Type.STRING },
    visual_metaphor: { type: Type.STRING },
    visual_concept: { type: Type.STRING },
    visual_rationale: { type: Type.STRING },
    headline: { type: Type.STRING },
    subheadline: { type: Type.STRING },
    cta: { type: Type.STRING },
    background_prompt: { type: Type.STRING },
    creative_direction: {
      type: Type.OBJECT,
      required: ["world", "environment", "lighting", "lens", "composition", "mood", "color_grade", "emotional_tone"],
      properties: {
        world: { type: Type.STRING },
        environment: { type: Type.STRING },
        lighting: { type: Type.STRING },
        lens: { type: Type.STRING },
        composition: { type: Type.STRING },
        mood: { type: Type.STRING },
        color_grade: { type: Type.STRING },
        emotional_tone: { type: Type.STRING },
      },
    } as Schema,
    model_confidence: { type: Type.NUMBER },
  },
} as Schema;

const HIERARCHY_DIRECTION: Record<string, string> = {
  founder_led:
    "FOUNDER-LED: the founder's (real, composited) headshot is the visual anchor. The background must leave clear space on one side for the portrait. Headline speaks in a personal, first-person-adjacent voice.",
  brand_led:
    "BRAND-LED: the brand identity is the hero — palette-driven background, confident headline in the brand's voice, logo prominently composited. The background is a branded canvas, not a scene.",
  data_led:
    "DATA-LED: one number from the content is the hero. The headline IS the stat (or frames it). Background is abstract and quiet so the figure dominates. Do not put the number in the background prompt — it is rendered as crisp text later.",
  quote_led:
    "QUOTE-LED: a short, punchy quote lifted or distilled from the content is the hero. The headline IS the quote (≤ 80 chars, no surrounding quote marks needed). Background is textural and calm — the words carry the design.",
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Creative Review Engine (Sprint 20) — grades the RENDERED creative (vision)
// across measurable dimensions, compares originality against Creative Memory, and
// returns structured metadata + issues + suggestions + a threshold recommendation.
// ─────────────────────────────────────────────────────────────────────────────
export interface CreativeReview {
  overall_score: number;
  brand_score: number;
  commercial_score: number;
  story_score: number;
  composition_score: number;
  readability_score: number;
  originality_score: number;
  platform_score: number;
  confidence: number;
  /** Threshold-derived (configurable) — what to do with this creative. */
  recommendation: "approve" | "improve" | "reject";
  issues: string[];
  suggestions: string[];
}

const creativeReviewSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "overall_score", "brand_score", "commercial_score", "story_score", "composition_score",
    "readability_score", "originality_score", "platform_score", "confidence", "issues", "suggestions",
  ],
  properties: {
    overall_score: { type: Type.NUMBER },
    brand_score: { type: Type.NUMBER },
    commercial_score: { type: Type.NUMBER },
    story_score: { type: Type.NUMBER },
    composition_score: { type: Type.NUMBER },
    readability_score: { type: Type.NUMBER },
    originality_score: { type: Type.NUMBER },
    platform_score: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
} as Schema;

/** Default quality gate (override with CREATIVE_REVIEW_THRESHOLD). */
function reviewThreshold(): number {
  const n = Number(process.env.CREATIVE_REVIEW_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 85;
}

/**
 * Review a finished creative IMAGE with a vision model. Returns scores + issues +
 * suggestions + a threshold-derived recommendation (approve / improve / reject).
 */
export async function reviewCreativeImage(input: {
  imageBase64: string;
  mimeType?: string;
  brand: { name: string; industry: string | null };
  platform: string;
  headline: string;
  cta: string;
  creativeDirection: Record<string, string> | null;
  recentDirections: string[];
}): Promise<{ data: CreativeReview; meta: GenerationMeta }> {
  const memBlock = input.recentDirections.length
    ? `RECENT CREATIVES for this brand (for the ORIGINALITY score — penalise similarity in world / lighting / composition / environment / mood):\n${input.recentDirections.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`
    : `RECENT CREATIVES: none yet — originality is unconstrained.`;
  const dir = input.creativeDirection
    ? `THIS creative's intended direction: ${[input.creativeDirection.world, input.creativeDirection.environment, input.creativeDirection.lighting, input.creativeDirection.lens].filter(Boolean).join(" · ")}`
    : "";

  const prompt = `You are a SENIOR CREATIVE DIRECTOR doing quality control on a finished
advertising creative for ${input.brand.name}${input.brand.industry ? ` (${input.brand.industry})` : ""},
intended for ${input.platform}. The headline reads "${input.headline}" and the CTA "${input.cta}".
${dir}
${memBlock}

LOOK AT THE ATTACHED IMAGE and score it 0-100 on each dimension. Be honest and specific —
a real creative director, never flattering:
- brand_score: does it feel like this brand? is brand personality visible? are colours used naturally (as light/atmosphere, not flat blocks)?
- commercial_score: does it look like premium advertising? cinematic? does it AVOID AI clichés (plastic skin, warped text/objects, fake bokeh, uncanny artifacts)?
- story_score: is there a clear visual story, an obvious focal point, emotional impact?
- composition_score: camera angle, framing, depth, negative space, subject placement.
- readability_score: will the headline / CTA / logo sit legibly with strong contrast against this background?
- originality_score: how DIFFERENT is this from the recent creatives above? penalise repeated world/lighting/composition/environment/mood.
- platform_score: would this perform well on ${input.platform} specifically?
- overall_score: your holistic verdict (NOT a plain average — weight what matters for premium advertising).
- confidence: how confident you are in this assessment (0-100).
- issues: concrete problems you SEE in the image (empty array if none).
- suggestions: specific, actionable improvements (empty array if none).`.trim();

  const { data, meta } = await generateStructuredFull<Omit<CreativeReview, "recommendation">>({
    prompt,
    schema: creativeReviewSchema,
    images: [{ mimeType: input.mimeType ?? "image/png", data: input.imageBase64 }],
    systemInstruction: "You are a discerning senior creative director doing QC. Be precise, honest and concrete. Never flatter; surface real problems.",
    label: "creativeReview",
  });

  const t = reviewThreshold();
  const recommendation: CreativeReview["recommendation"] =
    data.overall_score >= t ? "approve" : data.overall_score >= t - 15 ? "improve" : "reject";
  return { data: { ...data, recommendation }, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Improvement Planner (Sprint 21) — turns a weak review into a concrete plan:
// what to change, a revised creative direction, and a NEW background-only prompt
// the worker regenerates from. Closes the self-improvement loop (generate →
// review → plan → regenerate) so OttoFlow never just says "this is weak" — it
// knows WHY and fixes it.
// ─────────────────────────────────────────────────────────────────────────────
export interface CreativeImprovementPlan {
  /** Concrete, human-readable changes targeting the weakest dimensions. */
  changes: string[];
  /** The improved art direction (same shape as creative_direction). */
  new_direction: {
    world: string;
    environment: string;
    lighting: string;
    lens: string;
    composition: string;
    mood: string;
    color_grade: string;
    emotional_tone: string;
  };
  /** A NEW background-ONLY cinematic photo prompt that bakes in the changes. */
  revision_prompt: string;
}

const creativeImprovementSchema: Schema = {
  type: Type.OBJECT,
  required: ["changes", "new_direction", "revision_prompt"],
  properties: {
    changes: { type: Type.ARRAY, items: { type: Type.STRING } },
    new_direction: {
      type: Type.OBJECT,
      required: ["world", "environment", "lighting", "lens", "composition", "mood", "color_grade", "emotional_tone"],
      properties: {
        world: { type: Type.STRING },
        environment: { type: Type.STRING },
        lighting: { type: Type.STRING },
        lens: { type: Type.STRING },
        composition: { type: Type.STRING },
        mood: { type: Type.STRING },
        color_grade: { type: Type.STRING },
        emotional_tone: { type: Type.STRING },
      },
    },
    revision_prompt: { type: Type.STRING },
  },
} as Schema;

/**
 * Plan an improvement for a creative the review judged below threshold. Reads
 * the review (which dimensions are weak + why), the campaign context, the
 * current creative direction and the brand's recent directions (Creative
 * Memory), and returns concrete changes + a revised direction + a new
 * background-only prompt to regenerate from.
 */
export async function planCreativeImprovement(input: {
  review: CreativeReview;
  brand: { name: string; industry: string | null };
  platform: string;
  objective: string;
  headline: string;
  cta: string;
  currentDirection: Record<string, string> | null;
  currentBackgroundPrompt: string;
  recentDirections: string[];
}): Promise<{ data: CreativeImprovementPlan; meta: GenerationMeta }> {
  const r = input.review;
  // Rank the dimensions so the planner attacks the weakest first.
  const dims: Array<[string, number]> = [
    ["composition", r.composition_score],
    ["branding", r.brand_score],
    ["originality", r.originality_score],
    ["readability", r.readability_score],
    ["commercial quality", r.commercial_score],
    ["storytelling", r.story_score],
    ["platform fitness", r.platform_score],
  ];
  const weakest = dims.sort((a, b) => a[1] - b[1]).slice(0, 3).map(([n, s]) => `${n} (${s})`).join(", ");
  const memBlock = input.recentDirections.length
    ? `AVOID repeating these recent worlds (originality):\n${input.recentDirections.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`
    : "No recent creatives to avoid.";
  const dir = input.currentDirection
    ? Object.entries(input.currentDirection).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")
    : "(none recorded)";

  const prompt = `You are a SENIOR CREATIVE DIRECTOR giving REVISION NOTES on an ad creative for
${input.brand.name}${input.brand.industry ? ` (${input.brand.industry})` : ""} on ${input.platform}.
Campaign focus: ${input.objective}. Headline "${input.headline}", CTA "${input.cta}".

The AI review scored it ${r.overall_score}/100 — BELOW the quality bar. Weakest dimensions: ${weakest}.
Reviewer issues: ${r.issues.length ? r.issues.map((i) => `"${i}"`).join("; ") : "none stated"}.
Reviewer suggestions: ${r.suggestions.length ? r.suggestions.map((s) => `"${s}"`).join("; ") : "none stated"}.

CURRENT creative direction: ${dir}
CURRENT background prompt: "${input.currentBackgroundPrompt}"
${memBlock}

Produce a concrete revision plan that FIXES the weakest dimensions. Use the right move for each:
- Weak COMPOSITION -> move the subject to rule-of-thirds, increase negative space, reduce clutter, add foreground depth, use a longer focal length, warmer directional light.
- Weak BRANDING -> carry brand colour into reflections / practical lights / materials (never as flat graphics), strengthen a clear focal anchor, increase visual consistency.
- Weak ORIGINALITY -> abandon the overused world (e.g. avoid boardroom / skyline / glass office) and choose a DIFFERENT valid world (e.g. rooftop cafe, industrial warehouse, architectural atrium) that still fits the brand.
- Weak READABILITY -> quieter / less busy background, more empty space where copy lands, stronger tonal contrast behind the headline.

Return:
1) "changes": 3-6 specific, actionable revision notes.
2) "new_direction": a full, improved creative direction (world, environment, lighting, lens, composition, mood, color_grade, emotional_tone) - meaningfully different from the current one where the weakness demands it, still on-brand.
3) "revision_prompt": a single NEW BACKGROUND-ONLY cinematic photograph prompt that bakes in the changes. It describes ONLY a real photographic scene - NO text, letters, words, logos, watermarks, faces, people, or geometric shapes/bars/grids. Brand colour appears only as light within the scene.`.trim();

  return generateStructuredFull<CreativeImprovementPlan>({
    prompt,
    schema: creativeImprovementSchema,
    systemInstruction: "You are a senior creative director writing revision notes. Be concrete and decisive; target the weakest dimensions; never restate the same world that already failed.",
    label: "creativeImprovement",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Strategy Intelligence (Sprint 24) — OttoFlow thinks like a marketing
// strategist BEFORE it designs an image. Given the brand + this post, it decides
// the CAMPAIGN this creative belongs to (objective, audience, awareness stage,
// message, emotion, CTA, funnel position, distribution), records its internal
// reasoning, and recommends a multi-asset package that all reinforces the SAME
// strategy. This frames the creative concept (governing input #1).
// ─────────────────────────────────────────────────────────────────────────────
export const CAMPAIGN_TYPES = [
  "brand_awareness", "lead_generation", "recruitment", "product_launch",
  "thought_leadership", "event_promotion", "customer_education", "retention",
  "upsell", "community", "partnership_announcement", "investor_relations",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export interface CampaignStrategy {
  campaign_type: string;
  primary_objective: string;
  secondary_objective: string;
  audience: string;
  awareness_stage: string; // unaware | problem_aware | solution_aware | product_aware | most_aware
  core_message: string;
  desired_emotion: string;
  primary_cta: string;
  funnel_position: string; // TOFU | MOFU | BOFU
  distribution_strategy: string;
  /** The recommended asset sequence. Each asset advances the NARRATIVE (Sprint
   *  25.1) — phase/narrative_beat/funnel_stage/cta/emotional_beat are optional so
   *  Sprint-24 strategies stay valid; the Brain planner now always fills them. */
  package: Array<{
    role: string;
    format: string;
    angle: string;
    phase?: string;          // Launch | Education | Authority | Proof | Conversion | Follow-up | Retargeting
    narrative_beat?: string; // which story/vision THIS asset advances
    funnel_stage?: string;   // TOFU | MOFU | BOFU
    cta?: string;            // this asset's CTA in the progression (soft → hard)
    emotional_beat?: string; // the feeling this asset should land
    // Campaign Reasoning (Sprint 26) — every asset must justify its existence.
    why_exists?: string;        // why this asset is in the campaign at all
    belief_changed?: string;    // the belief it shifts
    objection_answered?: string;// the objection it addresses (or "—")
    emotional_step?: string;    // the step it creates in the emotional journey
    cta_stage?: string;         // which CTA-progression rung it supports
  }>;

  // ── Campaign Brain (Sprint 25.1) — the strategic messaging architecture that
  //    governs execution. Optional so older strategies remain valid; the evolved
  //    planner always emits them. Stored in campaigns.strategy jsonb (superset). ──
  /** The campaign's through-line ("Great engineers deserve better companies."). */
  narrative?: string;
  /** The single hero story the whole campaign advances. */
  primary_story?: string;
  /** The pillars beneath the narrative (culture, remote, salary, growth, …). */
  supporting_stories?: string[];
  objection_handling?: string[];
  /** Ordered emotional beats across the campaign. */
  emotional_journey?: string[];
  /** CTA rungs from soft to hard (the progression, not one CTA). */
  cta_progression?: string[];

  // ── Campaign Reasoning (Sprint 26) — the CMO thinks people → strategy → story
  //    → structure BEFORE assets. All optional (older Blueprints stay valid). ──
  /** Why this campaign exists at all + the business outcome it must produce. */
  business_objective?: { why_exists: string; expected_outcome: string; success_metric: string };
  /** The audience's CURRENT state, before the campaign touches them. */
  audience_state?: {
    beliefs: string; frustrations: string; objections: string;
    motivations: string; awareness: string; trust_level: string;
  };
  /** The shift the campaign must produce in the audience. */
  desired_transformation?: { believe: string; feel: string; understand: string; want: string; obvious_action: string };
  /** How the campaign earns the right to ask — proof, evidence, never-claims. */
  trust_strategy?: {
    proof_required: string[]; objections_to_answer: string[];
    credibility: string[]; evidence: string[]; never_claim: string[];
  };
  /** First-class campaign ACTS (assets belong to acts, not the reverse). */
  acts?: Array<{ act: string; intent: string }>;
  /** Compact recap of what has worked for this brand (from Performance + Brand
   *  Intelligence) that informed this plan — worker-filled, not model-generated. */
  learning_summary?: string;
  /** Deterministic Blueprint validation — the SOURCE OF TRUTH (Sprint 26). */
  validation?: CampaignValidation;
  /** The Gemini CMO verdict on the campaign as a complete story (advisory). */
  story_review?: CampaignStoryReview;
}

/** Deterministic campaign-blueprint validation (Sprint 26) — source of truth. */
export interface CampaignValidationCheck { name: string; pass: boolean; detail: string }
export interface CampaignValidation {
  checks: CampaignValidationCheck[];
  /** % of checks passed. */
  score: number;
  /** Failed checks that should block "ready for review". */
  blocking_issues: string[];
  /** True when no blocking issue remains. */
  complete: boolean;
}

/** Marketer-level review of the campaign as ONE story (Sprint 25.1). */
export interface CampaignStoryReview {
  momentum_score: number;
  purpose_score: number;
  cta_progression_score: number;
  objection_score: number;
  trust_score: number;
  overall_score: number;
  would_approve: boolean;
  issues: string[];
  suggestions: string[];
}

const STRING_ARRAY: Schema = { type: Type.ARRAY, items: { type: Type.STRING } } as Schema;

const campaignStrategySchema: Schema = {
  type: Type.OBJECT,
  required: [
    "campaign_type", "primary_objective", "secondary_objective", "audience",
    "awareness_stage", "core_message", "desired_emotion", "primary_cta",
    "funnel_position", "distribution_strategy",
    "business_objective", "audience_state", "desired_transformation", "trust_strategy", "acts",
    "narrative", "primary_story", "supporting_stories", "objection_handling",
    "emotional_journey", "cta_progression", "package",
  ],
  properties: {
    campaign_type: { type: Type.STRING },
    primary_objective: { type: Type.STRING },
    secondary_objective: { type: Type.STRING },
    audience: { type: Type.STRING },
    awareness_stage: { type: Type.STRING },
    core_message: { type: Type.STRING },
    desired_emotion: { type: Type.STRING },
    primary_cta: { type: Type.STRING },
    funnel_position: { type: Type.STRING },
    distribution_strategy: { type: Type.STRING },
    // ── Campaign Reasoning (Sprint 26 — people → strategy → story → structure) ─
    business_objective: {
      type: Type.OBJECT,
      required: ["why_exists", "expected_outcome", "success_metric"],
      properties: {
        why_exists: { type: Type.STRING },
        expected_outcome: { type: Type.STRING },
        success_metric: { type: Type.STRING },
      },
    },
    audience_state: {
      type: Type.OBJECT,
      required: ["beliefs", "frustrations", "objections", "motivations", "awareness", "trust_level"],
      properties: {
        beliefs: { type: Type.STRING },
        frustrations: { type: Type.STRING },
        objections: { type: Type.STRING },
        motivations: { type: Type.STRING },
        awareness: { type: Type.STRING },
        trust_level: { type: Type.STRING },
      },
    },
    desired_transformation: {
      type: Type.OBJECT,
      required: ["believe", "feel", "understand", "want", "obvious_action"],
      properties: {
        believe: { type: Type.STRING },
        feel: { type: Type.STRING },
        understand: { type: Type.STRING },
        want: { type: Type.STRING },
        obvious_action: { type: Type.STRING },
      },
    },
    trust_strategy: {
      type: Type.OBJECT,
      required: ["proof_required", "objections_to_answer", "credibility", "evidence", "never_claim"],
      properties: {
        proof_required: STRING_ARRAY,
        objections_to_answer: STRING_ARRAY,
        credibility: STRING_ARRAY,
        evidence: STRING_ARRAY,
        never_claim: STRING_ARRAY,
      },
    },
    acts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["act", "intent"],
        properties: { act: { type: Type.STRING }, intent: { type: Type.STRING } },
      },
    },
    // ── Campaign Brain (narrative + messaging) ──────────────────────────────
    narrative: { type: Type.STRING },
    primary_story: { type: Type.STRING },
    supporting_stories: STRING_ARRAY,
    objection_handling: STRING_ARRAY,
    emotional_journey: STRING_ARRAY,
    cta_progression: STRING_ARRAY,
    package: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: [
          "role", "format", "angle", "phase", "narrative_beat", "funnel_stage", "cta", "emotional_beat",
          "why_exists", "belief_changed", "objection_answered", "emotional_step", "cta_stage",
        ],
        properties: {
          role: { type: Type.STRING },
          format: { type: Type.STRING },
          angle: { type: Type.STRING },
          phase: { type: Type.STRING },
          narrative_beat: { type: Type.STRING },
          funnel_stage: { type: Type.STRING },
          cta: { type: Type.STRING },
          emotional_beat: { type: Type.STRING },
          why_exists: { type: Type.STRING },
          belief_changed: { type: Type.STRING },
          objection_answered: { type: Type.STRING },
          emotional_step: { type: Type.STRING },
          cta_stage: { type: Type.STRING },
        },
      },
    },
  },
} as Schema;

/** Normalize a model-returned campaign_type to the allowed vocabulary. */
export function normalizeCampaignType(raw: string): CampaignType {
  const k = (raw || "").toLowerCase().replace(/[\s-]+/g, "_");
  return (CAMPAIGN_TYPES as readonly string[]).includes(k) ? (k as CampaignType) : "brand_awareness";
}

/**
 * Plan the CAMPAIGN this creative belongs to — the strategist's brief, decided
 * before any image. Campaign Memory (recent strategies) steers it AWAY from
 * repeating messaging / worlds / hooks / CTAs / emotional angles / structures.
 */
export async function planCampaignStrategy(input: {
  brand: { name: string; industry: string | null; positioning: string | null; voiceTone: string };
  content: { title: string; preview: string | null; bodyExcerpt: string; platform: string };
  topic: { title: string; hookAngle: string | null; kind: string | null } | null;
  recentCampaigns: string[];
  /** Sprint 26 — what has worked for this brand (from Performance + Brand
   *  Intelligence). Informs the reasoning; not stored from the model output. */
  learningSummary?: string;
}): Promise<{ data: CampaignStrategy; meta: GenerationMeta }> {
  const memBlock = input.recentCampaigns.length
    ? `CAMPAIGN MEMORY — recent campaigns for THIS brand. Do NOT repeat their narrative, story, emotional arc, CTA progression, supporting messages or campaign type; the brand's campaigns must EVOLVE:\n${input.recentCampaigns.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`
    : `CAMPAIGN MEMORY: none yet — clean slate.`;
  const learnBlock = input.learningSummary && input.learningSummary.trim()
    ? `WHAT HAS WORKED for this brand (let it inform strategy, never override the reasoning):\n${input.learningSummary.trim()}`
    : `WHAT HAS WORKED: no campaign performance learned yet.`;

  const prompt = `You are a SENIOR CMO planning a complete campaign for
${input.brand.name}${input.brand.industry ? ` (${input.brand.industry})` : ""} on ${input.content.platform}.
${input.brand.positioning ? `POSITIONING: ${input.brand.positioning}\n` : ""}VOICE: ${input.brand.voiceTone}

THE REQUEST / SEED:
TITLE: ${input.content.title}
${input.content.preview ? `HOOK: ${input.content.preview}\n` : ""}BODY (excerpt): ${input.content.bodyExcerpt}
${input.topic ? `SOURCE IDEA: ${input.topic.title}${input.topic.kind ? ` (${input.topic.kind})` : ""}${input.topic.hookAngle ? ` — angle: "${input.topic.hookAngle}"` : ""}` : ""}

${memBlock}
${learnBlock}

A campaign exists because it solves a BUSINESS PROBLEM — not because a package
includes assets. REASON IN THIS EXACT ORDER. Do NOT assign any asset until steps
1-8 are done. Think about PEOPLE first, then strategy, then story, then structure.

1. BUSINESS OBJECTIVE (business_objective): why_exists (why this campaign exists), expected_outcome, success_metric (the metric that defines success).
2. AUDIENCE STATE (audience_state) — their CURRENT state before the campaign: beliefs, frustrations, objections, motivations, awareness, trust_level.
3. DESIRED TRANSFORMATION (desired_transformation): after the campaign, what should they believe, feel, understand, want, and which action becomes obvious_action.
4. TRUST STRATEGY (trust_strategy): proof_required, objections_to_answer, credibility (what must be established), evidence (what's needed), never_claim (what must NOT be claimed).
5. EMOTIONAL JOURNEY (emotional_journey): the ordered emotional progression that gets them from their current state to the decision (e.g. curiosity → recognition → understanding → trust → confidence → decision). It changes per campaign.
6. CAMPAIGN NARRATIVE: narrative (through-line, one sentence), primary_story, supporting_stories (4-7 pillars), objection_handling (the real objections + how the campaign answers them).
7. CAMPAIGN ACTS (acts): think in ACTS, not assets — e.g. Awareness → Education → Authority → Trust → Decision → Conversion. Each act has an act name + intent. Assets belong to acts; acts never belong to assets.
8. CTA PROGRESSION (cta_progression): CTAs mature SOFT → HARD (e.g. learn → discover → compare → talk to us → book → apply → buy). Never ask for conversion before enough trust exists.
9. ASSET ASSIGNMENT (package, 4-8 assets) — ONLY NOW assign assets. Every asset must explicitly justify itself: role, format (platform-native), angle, phase (Launch | Education | Authority | Proof | Conversion | Follow-up | Retargeting), narrative_beat (which story it advances), funnel_stage (TOFU/MOFU/BOFU), cta (its rung), emotional_beat, why_exists (why this asset is in the campaign), belief_changed (the belief it shifts), objection_answered (the objection it answers, or "—"), emotional_step (the step it creates), cta_stage (which CTA rung it supports). NO asset may exist just to fill a slot.

Also fill the summary fields consistently with your reasoning above: campaign_type (EXACTLY ONE of: ${CAMPAIGN_TYPES.join(", ")}), primary_objective, secondary_objective, audience, awareness_stage (unaware|problem_aware|solution_aware|product_aware|most_aware), core_message, desired_emotion, primary_cta, funnel_position (TOFU/MOFU/BOFU), distribution_strategy.

Order the package as a CALENDAR (Launch → … → Retargeting): build trust and momentum
BEFORE the conversion ask. Make the narrative, emotional arc and CTA progression
DISTINCT from recent campaigns.`.trim();

  return generateStructuredFull<CampaignStrategy>({
    prompt,
    schema: campaignStrategySchema,
    systemInstruction: "You are a senior marketing strategist. You decide the campaign and its strategy before any creative is designed. Be decisive, specific and honest in your reasoning; make campaigns evolve, never repeat.",
    label: "planCampaignStrategy",
  });
}

const campaignStoryReviewSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "momentum_score", "purpose_score", "cta_progression_score", "objection_score",
    "trust_score", "overall_score", "would_approve", "issues", "suggestions",
  ],
  properties: {
    momentum_score: { type: Type.NUMBER },
    purpose_score: { type: Type.NUMBER },
    cta_progression_score: { type: Type.NUMBER },
    objection_score: { type: Type.NUMBER },
    trust_score: { type: Type.NUMBER },
    overall_score: { type: Type.NUMBER },
    would_approve: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
} as Schema;

/**
 * Review a planned campaign as a COMPLETE STORY (Sprint 25.1) — the marketer's
 * eye, BEFORE any image renders (the verdict is about the narrative + asset
 * assignment, not the pixels). Best-effort; advisory.
 */
export async function reviewCampaignStory(
  strategy: CampaignStrategy,
  validation?: CampaignValidation,
): Promise<{ data: CampaignStoryReview; meta: GenerationMeta }> {
  const assets = (strategy.package ?? [])
    .map((a, i) => `  ${i + 1}. [${a.phase ?? "?"}] ${a.role} → ${a.narrative_beat ?? a.angle} | ${a.funnel_stage ?? "?"} | CTA "${a.cta ?? ""}" | why: ${a.why_exists ?? "?"}`)
    .join("\n");
  const valBlock = validation
    ? `DETERMINISTIC VALIDATION (the SOURCE OF TRUTH — your verdict is advisory and must not contradict a hard failure): score ${validation.score}, ${validation.complete ? "no blocking issues" : `BLOCKING: ${validation.blocking_issues.join("; ")}`}. Checks: ${validation.checks.map((c) => `${c.name}=${c.pass ? "pass" : "FAIL"}`).join(", ")}.`
    : "";
  const prompt = `You are an EXPERIENCED CMO reviewing a planned campaign as ONE STORY,
before any asset is produced. Be honest — would you actually approve this?

BUSINESS OBJECTIVE: ${strategy.business_objective?.why_exists ?? strategy.primary_objective} (success: ${strategy.business_objective?.success_metric ?? "—"})
AUDIENCE NOW: beliefs ${strategy.audience_state?.beliefs ?? "?"}; objections ${strategy.audience_state?.objections ?? "?"}; trust ${strategy.audience_state?.trust_level ?? "?"}
TRANSFORMATION: ${strategy.desired_transformation?.believe ?? "?"} → obvious action: ${strategy.desired_transformation?.obvious_action ?? "?"}
NARRATIVE: ${strategy.narrative ?? strategy.core_message}
EMOTIONAL JOURNEY: ${(strategy.emotional_journey ?? []).join(" → ") || "(none)"}
CTA PROGRESSION: ${(strategy.cta_progression ?? []).join(" → ") || strategy.primary_cta}
OBJECTIONS HANDLED: ${(strategy.objection_handling ?? []).join("; ") || "(none)"}
ACTS: ${(strategy.acts ?? []).map((a) => `${a.act} (${a.intent})`).join(" → ") || "(none)"}
ASSET SEQUENCE:
${assets || "(none)"}
${valBlock}

Score 0-100 and judge:
- momentum_score: does the sequence BUILD momentum (calendar phases in a sensible order)?
- purpose_score: does EVERY asset have a clear purpose that advances the narrative (none filling a slot)?
- cta_progression_score: is the CTA progression logical (soft → hard), not one CTA repeated?
- objection_score: are the audience's real objections answered?
- trust_score: is trust established BEFORE the conversion ask?
- overall_score: holistic — would a marketer ship this campaign?
- would_approve: true only if you'd genuinely approve it.
- issues: concrete problems. suggestions: specific fixes.`.trim();

  return generateStructuredFull<CampaignStoryReview>({
    prompt,
    schema: campaignStoryReviewSchema,
    systemInstruction: "You are a discerning marketing director. Judge the campaign as a complete story; reward narrative coherence and trust-before-conversion; never approve a bag of disconnected assets.",
    label: "reviewCampaignStory",
  });
}

export async function generateCreativeConcept(input: {
  brand: {
    name: string;
    industry: string | null;
    positioning: string | null;
    voiceTone: string;
  };
  hierarchy: string;
  platform: string;
  aspectRatio: string;
  palette: { primary?: string; secondary?: string; accent?: string };
  content: { title: string; preview: string | null; bodyExcerpt: string };
  topic: { title: string; hookAngle: string | null; kind: string | null } | null;
  founderName: string | null;
  assetSummary: string; // e.g. "logo (transparent PNG 800×200), headshot (\"Jane Doe — Founder\", 1200×1200)"
  /** Creative Memory (Sprint 19) — compact summaries of this brand's RECENT creative
   * directions (most-recent first). The model must pick a DIFFERENT valid world for
   * controlled variety unless the brief specifically requires repetition. */
  recentDirections?: string[];
  /** Brand Intelligence (Sprint 22) — a pre-rendered block of what consistently
   * works best for this brand (best worlds/lighting/lens/..., overused worlds to
   * avoid, underused worlds to explore). Priority #4: informs, never overrides the
   * brief. Empty/undefined when nothing has been learned yet. */
  brandIntelligence?: string;
  /** Performance Intelligence (Sprint 23) — a pre-rendered block of REAL audience
   * behavior (winning/losing patterns, top worlds/lighting/mood by engagement,
   * platform differences). Priority #3 — OUTRANKS Brand Intelligence and the review
   * score. Empty/undefined when no real engagement data exists yet. */
  performanceIntelligence?: string;
  /** Campaign Strategy (Sprint 24) — a pre-rendered block describing the CAMPAIGN
   * this creative belongs to (objective, audience, awareness stage, message,
   * emotion, CTA, funnel). The GOVERNING FRAME: every creative choice must
   * reinforce the campaign. Empty/undefined when no strategy was planned. */
  campaignStrategy?: string;
}): Promise<{ data: CreativeConcept; meta: GenerationMeta }> {
  const direction = HIERARCHY_DIRECTION[input.hierarchy] ?? HIERARCHY_DIRECTION.brand_led;
  const pal = input.palette;
  const hasPalette = !!(pal.primary || pal.secondary || pal.accent);
  const paletteBlock = hasPalette
    ? `BRAND COLOURS — express these ONLY as light inside the scene (sunlight, reflections, LEDs, windows, materials, ambient glow). NEVER as a flat colour field, shape, bar or graphic overlay:
- primary: ${pal.primary ?? "(none)"}
- secondary: ${pal.secondary ?? "(none)"}
- accent: ${pal.accent ?? "(none)"}`
    : `BRAND COLOURS: none configured — use the natural light of the chosen scene; restrained and neutral. Do NOT invent a saturated brand colour.`;

  const recentBlock = input.recentDirections && input.recentDirections.length
    ? `CREATIVE MEMORY — recent creatives for THIS brand (most recent first). Do NOT repeat these worlds / environments / lighting / lens; choose a DIFFERENT valid world that still satisfies the brief (controlled variety). Repeat only if the brief specifically demands it:\n${input.recentDirections.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`
    : `CREATIVE MEMORY: no recent creatives for this brand — clean slate; pick the strongest world for the brief.`;

  const intelligenceBlock = input.brandIntelligence && input.brandIntelligence.trim()
    ? input.brandIntelligence.trim()
    : `BRAND INTELLIGENCE: none yet — this brand has no learned track record; rely on the brief and pick the strongest world.`;

  const performanceBlock = input.performanceIntelligence && input.performanceIntelligence.trim()
    ? input.performanceIntelligence.trim()
    : `PERFORMANCE INTELLIGENCE: no real engagement data yet — fall back to Brand Intelligence and the AI review signal until published campaigns report back.`;

  const campaignBlock = input.campaignStrategy && input.campaignStrategy.trim()
    ? input.campaignStrategy.trim()
    : "";

  const prompt = `
Design the creative strategy for a single ${input.platform} image creative
(aspect ratio ${input.aspectRatio}) that accompanies the post below.

${campaignBlock ? `${campaignBlock}\n\nThis creative is ONE asset inside that campaign — EVERY choice below (world, lighting, mood, composition, headline, CTA) must reinforce the campaign objective, speak to its audience at its awareness stage, and carry its core message and desired emotion.\n` : ""}
BRAND: ${input.brand.name}${input.brand.industry ? ` (${input.brand.industry})` : ""}
${input.brand.positioning ? `POSITIONING: ${input.brand.positioning}` : ""}
VOICE: ${input.brand.voiceTone}
${paletteBlock}
${input.founderName ? `FOUNDER: ${input.founderName}` : ""}
AVAILABLE LOCKED ASSETS (composited later, never generated): ${input.assetSummary || "(none)"}

POST TITLE: ${input.content.title}
${input.content.preview ? `POST HOOK: ${input.content.preview}` : ""}
POST BODY (excerpt):
${input.content.bodyExcerpt}

${input.topic ? `SOURCE IDEA: ${input.topic.title}${input.topic.kind ? ` (${input.topic.kind})` : ""}${input.topic.hookAngle ? ` — hook: "${input.topic.hookAngle}"` : ""}` : ""}

CREATIVE HIERARCHY (decided — execute it, don't change it):
${direction}

You are the ART DIRECTOR reading a CLIENT BRIEF — NOT a template engine picking an
industry preset. Design this creative as a CINEMATIC, EDITORIAL PHOTOGRAPH for a
premium agency campaign — a real photographic WORLD, never an abstract graphic,
geometric pattern, template, or decorative overlay.

Work the brief IN THIS ORDER and let it drive everything (this is the source of truth):
  1. CAMPAIGN OBJECTIVE — what must THIS specific creative achieve? (infer from the post + idea)
  2. TARGET AUDIENCE — who is it for?
  3. DESIRED EMOTION — what should the viewer feel in a single glance?
  4. KEY MESSAGE — the one idea to land
  → CREATIVE STRATEGY → PHOTOGRAPHIC WORLD → the final background.

${performanceBlock}

${intelligenceBlock}

${recentBlock}

${industryConstraintBlock(input.brand.industry)}

PRIORITY OF INPUTS (highest first): 0) the CAMPAIGN STRATEGY above is the GOVERNING
FRAME when present — the campaign objective, audience, awareness stage, message and
funnel position dictate what this asset must accomplish; everything below serves it.
1) this Campaign Brief, 2) Brand DNA (voice,
positioning, palette), 3) Performance Intelligence (REAL audience behavior — the
winning patterns; this OUTRANKS internal opinion), 4) Brand Intelligence (what the
AI review consistently rates highest — best dimensions, avoid overused, prefer
underused), 5) Creative Memory (push for variety vs the most recent), 6) Industry
constraint, 7) art direction. Campaigns ALWAYS override history. When Performance
Intelligence and Brand Intelligence DISAGREE, FOLLOW THE PERFORMANCE — real customer
behavior matters more than how the image looked to the reviewer. History INFORMS and
GUIDES, it never overrides the brief. Keep the brand recognizable while maximizing variety.

Now direct ONE specific real PHOTOGRAPH like a cinematographer — the exact environment,
where the light comes from, the lens and depth of field, foreground/background layers,
reflections, texture and mood — ALL dictated by the OBJECTIVE + EMOTION above, NOT by the
industry alone. Two campaigns in the SAME industry but with different objectives MUST
produce COMPLETELY DIFFERENT worlds — e.g. luxury villas → aspirational golden-hour
architecture; property management → clean, trustworthy, professional maintenance; property
investment → executive financial-confidence city imagery. Leave genuine quiet space where
the headline and assets will sit.

Produce these IN ORDER — each builds on the previous:
- visual_tension: the core opposition THIS topic dramatizes, as "X vs Y"
  (e.g. "Complexity vs Simplicity"). Derive it from the ACTUAL post, not generic.
- visual_metaphor: ONE concrete PHOTOGRAPHIC scene that embodies that tension — a
  real environment, moment, and lighting (e.g. "a cluttered workspace dissolving
  into a calm, ordered desk in soft morning light"). Describe place, light, depth,
  and mood — NOT geometry or shapes. No readable text, no synthesized faces.
- visual_concept: 2-3 sentences. The finished creative built ON that scene —
  where the eye lands, where the headline + assets sit. Concrete.
- visual_rationale: 2-3 sentences. WHY this world + scene fit this brand, this
  idea, and ${input.platform}. Reference the actual content.
- headline: the overlay text (≤ 80 chars). Rendered as crisp typography
  later — make every word earn its place.
- subheadline: ONE supporting line under the headline (≤ 120 chars) that adds
  the specific proof/angle from THIS post. Empty string if the headline fully
  stands alone — never padding.
- cta: short action line (≤ 60 chars), platform-appropriate.
- background_prompt: a premium photographic image-generation prompt for the
  BACKGROUND ONLY that renders the visual_metaphor as a CINEMATIC EDITORIAL
  PHOTOGRAPH. Specify the real environment, the lighting (direction + quality),
  the lens and depth of field, the materials, textures, atmosphere and reflections.
  The brand colours must appear ONLY as light within the scene (sunlight,
  reflections, LEDs, windows, materials) — never as a shape, bar, gradient overlay
  or flat colour field. Leave quiet space where the headline + assets land.
  WRITE IT AS POSITIVE DESCRIPTION ONLY — describe what IS in the frame. Do NOT
  write negative phrases, and do NOT use the words text, letters, words, logo,
  sign, person, people, face, human, portrait, geometric, rectangle, bar, grid,
  block, or stripe ANYWHERE in the prompt — those are excluded by design and even
  naming them is disallowed. Describe a clean, real, cinematic scene.
- creative_direction: a STRUCTURED record of the art direction you chose, so future
  creatives can recall it and avoid repeating it. Fill EVERY field concretely:
  world (the photographic world, e.g. "modern glass office" / "golden-hour villa
  exterior" / "executive boardroom"), environment (the specific setting), lighting
  (style + direction), lens (focal length + depth of field), composition, mood,
  color_grade (the grade/tone), emotional_tone. Make these DISTINCT from the
  Creative Memory entries above.
- model_confidence: 0.0-1.0 — your honest assessment of how well THIS
  hierarchy fits THIS content. A mismatch (e.g. quote-led on a stats post)
  should score ≤ 0.5. Don't flatter.
`.trim();

  return generateStructuredFull<CreativeConcept>({
    prompt,
    schema: creativeConceptSchema,
    label: "generateCreativeConcept",
    systemInstruction:
      "You are a senior brand art director. You translate each topic into a distinct visual metaphor and design platform-native creatives whose background communicates the topic before any text is read — never generic AI gradients. You follow asset-safety rules exactly: backgrounds never contain logos, text, or faces.",
  });
}

// ─── Creative background generation + validation (Phase C) ──────────────────
//
// Imagen generates the BACKGROUND ONLY for an approved creative brief.
// Safety, per the orchestrator design:
//  - negative constraints are embedded in the prompt text (the dedicated
//    negativePrompt config field is unsupported/deprecated on newer Imagen
//    models, so in-prompt negatives are the portable mechanism)
//  - the generated image is then VALIDATED by a Gemini multimodal check for
//    text / logos / faces before any compositing; violations are regenerated
//  - locked brand assets never appear here — this call sends only the brief's
//    background prompt, and the validator only ever sees AI-generated pixels

const BACKGROUND_NEGATIVE_SUFFIX =
  " Strictly no text, no letters, no words, no numbers, no logos, no brand marks, " +
  "no watermarks, no signage, no people, no faces, no portraits, no hands.";

export async function generateCreativeBackground(input: {
  prompt: string;
  aspectRatio: string; // "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<Buffer> {
  const resp = await callGemini("generateCreativeBackground", () =>
    ai().models.generateImages({
      // imagen-3.0-* was retired from the Gemini Developer API (404 NOT_FOUND).
      // ListModels on our key (2026-06-16) shows the available predict models
      // are imagen-4.0-{generate,ultra-generate,fast-generate}-001; we use the
      // fast variant (closest equivalent to the old fast-3.0 model).
      model: "imagen-4.0-fast-generate-001",
      prompt: `${input.prompt}.${BACKGROUND_NEGATIVE_SUFFIX}`,
      config: {
        // NOTE: no `seed` — the Imagen endpoint rejects it ("seed parameter
        // is not supported in Gemini API"). Variation comes from each brief's
        // distinct prompt instead.
        numberOfImages: 1,
        aspectRatio: input.aspectRatio,
        outputMimeType: "image/png",
      },
    }),
  );
  const bytes = resp.generatedImages?.[0]?.image?.imageBytes;
  if (!bytes) throw new Error("Imagen returned no image bytes");
  return Buffer.from(bytes, "base64");
}

export interface BackgroundValidation {
  contains_text: boolean;
  contains_logo: boolean;
  contains_face: boolean;
  /** One sentence on what the image shows — logged for diagnostics. */
  description: string;
}

const backgroundValidationSchema: Schema = {
  type: Type.OBJECT,
  required: ["contains_text", "contains_logo", "contains_face", "description"],
  properties: {
    contains_text: { type: Type.BOOLEAN },
    contains_logo: { type: Type.BOOLEAN },
    contains_face: { type: Type.BOOLEAN },
    description: { type: Type.STRING },
  },
} as Schema;

/**
 * Multimodal inspection of a GENERATED background (never a locked asset).
 * Returns flags the worker uses to reject + regenerate before compositing.
 */
export async function validateGeneratedBackground(
  png: Buffer,
): Promise<{ data: BackgroundValidation; meta: GenerationMeta }> {
  const resp = await callGemini("validateGeneratedBackground", () =>
    ai().models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
            {
              text:
                "Inspect this image, which must be a clean abstract/scenic background. Report:\n" +
                "(1) contains_text — true ONLY if a human could actually READ letters, words, or numbers " +
                "(including stylized or partially-formed words). Abstract shapes, gradients, geometric " +
                "forms, blobs, lines, and textures are NOT text — do not flag them.\n" +
                "(2) contains_logo — true for any logo, brand mark, or watermark (strict).\n" +
                "(3) contains_face — true for any human face or person (strict).\n" +
                "Keep logo and face detection strict; for text, flag only genuinely legible characters.",
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: backgroundValidationSchema,
        temperature: 0,
      },
    }),
  );
  const text = resp.text;
  if (!text) throw new Error("Background validation returned empty response");
  return { data: JSON.parse(text) as BackgroundValidation, meta: extractMeta(resp) };
}
