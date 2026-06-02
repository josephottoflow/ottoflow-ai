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

export async function generateVideoScript(input: {
  prompt: string;
  style: string;
  musicVibe: string;
  targetSeconds: number;
}): Promise<VideoScript> {
  const prompt = `
Write a tight, scroll-stopping narration for a ${input.targetSeconds}-second
short-form ad video based on this brief.

BRIEF: ${input.prompt}
STYLE: ${input.style}
MUSIC VIBE: ${input.musicVibe}

REQUIREMENTS:
- hook: the first 3-5 seconds — a question, bold claim, or pattern interrupt.
  No "Hey guys" or "Did you know" cliches.
- body: the main message. 60-90 words. Specific, concrete. Should fit the
  remaining time after the hook.
- cta: a single closing line that drives action. ~10-15 words.
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
}): Promise<Storyboard> {
  const prompt = `
Build a ${input.sceneCount}-scene shot list for this short-form ad video.

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
backlight from the left, hand reaching in from frame-right" is a shot.
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
export async function generateHeroFrame(input: {
  prompt: string;
  style: string;
}): Promise<string> {
  const imagePrompt = `${input.style} style, ${input.prompt}, cinematic composition, professional commercial photography, high detail`;

  // Model name caveat: the Gemini v1beta API has shuffled Imagen names a
  // few times. `imagen-3.0-generate-002` returned 404 in production for our
  // tier (smoke test 2026-06-02). `imagen-3.0-fast-generate-001` is the
  // lighter-weight variant typically enabled on AI Studio keys. If your
  // key 404s on both, Imagen isn't enabled — the route falls back
  // gracefully (route.ts catches and skips the hero frame).
  const resp = await callGemini("generateHeroFrame", () =>
    ai().models.generateImages({
      model: "imagen-3.0-fast-generate-001",
      prompt: imagePrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "9:16",
        outputMimeType: "image/jpeg",
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
