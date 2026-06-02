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

async function generateStructured<T>(opts: {
  prompt: string;
  schema: Schema;
  tools?: Array<{ urlContext?: object; googleSearch?: object }>;
  systemInstruction?: string;
  label?: string;
}): Promise<T> {
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

  const resp = await callGemini(opts.label ?? "generateStructured", () =>
    ai().models.generateContent({
      model: MODEL,
      contents: promptWithSchemaHint,
      config: {
        systemInstruction,
        // Strict structured output ONLY when no tools — Gemini rejects both together.
        ...(usingTools
          ? { tools: opts.tools }
          : { responseMimeType: "application/json", responseSchema: opts.schema }),
        // Lower temperature for structured output stability
        temperature: 0.4,
      },
    })
  );

  const text = resp.text;
  if (!text) throw new Error("Gemini returned empty response");

  // In tools mode we may get markdown fences around the JSON; strip them.
  const cleaned = usingTools ? unfence(text) : text;

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON output: ${(err as Error).message}\n\nRaw: ${cleaned.slice(0, 500)}`
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
  const voiceTone = p.brand_voice?.tone?.join(", ") || "Professional, clear, modern";
  const voiceDo = p.brand_voice?.do_words?.slice(0, 8).join(", ") || "";
  const voiceDont = p.brand_voice?.dont_words?.slice(0, 6).join(", ") || "";
  const positioning = p.positioning || `${input.brand.name} in ${input.brand.industry || "its space"}`;
  const audience =
    p.audience_icp?.demographics?.slice(0, 4).join(", ") ||
    p.audience_icp?.icp_roles?.slice(0, 4).join(", ") ||
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
