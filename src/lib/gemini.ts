/**
 * Gemini client + research-task helpers (uses @google/genai unified SDK).
 *
 * All helpers are server-side (worker or route handlers). Browser code must
 * never import this file directly.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { addBreadcrumb, captureFallback } from "./observability";
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
}

async function generateStructured<T>(opts: StructuredOpts): Promise<T> {
  const { data } = await generateStructuredFull<T>(opts);
  return data;
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
    return ai().models.generateContent({
      model: MODEL,
      contents: promptWithSchemaHint,
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
    return { data: JSON.parse(cleaned) as T, meta: extractMeta(resp) };
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
