/**
 * Gemini client + research-task helpers (uses @google/genai unified SDK).
 *
 * All helpers are server-side (worker or route handlers). Browser code must
 * never import this file directly.
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type {
  BrandProfile,
  BrandProfileService,
  BrandProfilePersona,
  DbCompetitor,
  DbKeyword,
  DbContentPillar,
} from "./types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 90_000);
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5_000;

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
async function callGemini<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(fn(), TIMEOUT_MS, label);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES - 1 || !isRetryable(err)) break;
      await sleep(backoffDelay(attempt));
    }
  }
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

async function generateStructured<T>(opts: {
  prompt: string;
  schema: Schema;
  tools?: Array<{ urlContext?: object; googleSearch?: object }>;
  systemInstruction?: string;
  label?: string;
}): Promise<T> {
  const resp = await callGemini(opts.label ?? "generateStructured", () =>
    ai().models.generateContent({
      model: MODEL,
      contents: opts.prompt,
      config: {
        systemInstruction:
          opts.systemInstruction ??
          "You are a senior brand strategist and SEO researcher. Always return strictly valid JSON matching the requested schema. Be specific and concrete — never use generic filler.",
        responseMimeType: "application/json",
        responseSchema: opts.schema,
        tools: opts.tools,
        // Lower temperature for structured output stability
        temperature: 0.4,
      },
    })
  );

  const text = resp.text;
  if (!text) throw new Error("Gemini returned empty response");

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON output: ${(err as Error).message}\n\nRaw: ${text.slice(0, 500)}`
    );
  }
}

// ─── Brand Research helpers ──────────────────────────────────────────────────

export async function extractBrandProfile(input: {
  name: string;
  website: string;
  industry: string;
}): Promise<BrandProfile> {
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

  return generateStructured<BrandProfile>({
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

  const result = await generateStructured<{
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

  return result.competitors.map((c) => ({
    name: c.name,
    website: c.website ?? null,
    summary: c.summary,
    positioning: c.positioning ?? null,
    strengths: c.strengths ?? [],
    weaknesses: c.weaknesses ?? [],
  }));
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

  const result = await generateStructured<{
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
  };
}
