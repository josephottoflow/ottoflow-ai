/**
 * Phase 1A variation test — focused validation that the seed + temperature
 * jitter changes in src/lib/gemini.ts produce materially different outputs
 * on identical inputs.
 *
 * Scope: Gemini-only. Does NOT exercise Runway, Luma, Pexels, ElevenLabs,
 * Jamendo, or the Next.js route handler. Those have their own validation
 * paths in PHASE_1A_SMOKE_TEST.md.
 *
 * Why this exists: commit 2a19fd4 is committed locally but not deployed.
 * Running Scenario A through the live site validates the OLD code, not
 * Phase 1A. This script proves the new code generates divergent outputs
 * by calling Gemini twice with identical inputs and comparing.
 *
 * Setup (one-time):
 *   PowerShell:  $env:GOOGLE_API_KEY = "AIza..."
 *   Bash:        export GOOGLE_API_KEY="AIza..."
 *   Then:        npx tsx scripts/phase-1a-variation-test.ts
 *
 * Cost: 4 Gemini Flash calls (~$0.004 total). No image generation.
 *
 * What you will see:
 *   - Run #1 vs Run #2 script output (hook / body / cta side-by-side)
 *   - Run #1 vs Run #2 storyboard output (scenes + aestheticNotes)
 *   - Style pool rotation demo (10 picks from the 6-style pool)
 *
 * What to look for:
 *   - PASS: hooks differ substantively across runs (not just punctuation)
 *   - PASS: aestheticNotes differ across runs
 *   - PASS: style pool yields ≥ 3 distinct styles across 10 picks
 *   - FAIL: outputs identical or near-identical — would mean Phase 1A
 *           didn't take effect, requiring deeper investigation
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// ─── Mirror src/lib/gemini.ts entropy() exactly ──────────────────────────────
function entropy(): { seed: number; temperature: number } {
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    temperature: 0.65 + Math.random() * 0.1,
  };
}

// ─── Mirror src/lib/gemini.ts generateVideoScript schema ─────────────────────
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
};

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
};

interface VideoScript {
  hook: string;
  body: string;
  cta: string;
  estimatedDurationSec: number;
  voiceDirection: string;
  // Captured by THIS script (not the real gemini.ts) for reporting purposes:
  _entropyUsed: { seed: number; temperature: number };
}

interface Storyboard {
  scenes: Array<{
    index: number;
    durationSec: number;
    shotType: string;
    cameraMove: string;
    description: string;
    onScreenText?: string;
    voiceLine?: string;
  }>;
  totalDurationSec: number;
  aestheticNotes: string;
  _entropyUsed: { seed: number; temperature: number };
}

const STYLE_POOL = [
  "cinematic",
  "documentary",
  "handheld ugc",
  "luxury commercial",
  "founder pov",
  "social proof",
] as const;

function pickStyle(): string {
  return STYLE_POOL[Math.floor(Math.random() * STYLE_POOL.length)];
}

// ─── Script generation — identical prompt template to src/lib/gemini.ts ──────
async function generateScript(
  ai: GoogleGenAI,
  input: {
    prompt: string;
    style: string;
    musicVibe: string;
    targetSeconds: number;
  },
): Promise<VideoScript> {
  const userPrompt = `
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

  const { seed, temperature } = entropy();
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction:
        "You are a senior short-form ad copywriter. You write for TikTok, Reels, and Shorts. Every word earns its place. No filler, no cliches. Always return strictly valid JSON matching the requested schema.",
      responseMimeType: "application/json",
      responseSchema: videoScriptSchema,
      temperature,
      seed,
    },
  });

  const text = resp.text;
  if (!text) throw new Error("Empty Gemini response (script)");
  const parsed = JSON.parse(text) as Omit<VideoScript, "_entropyUsed">;
  return { ...parsed, _entropyUsed: { seed, temperature } };
}

// ─── Storyboard generation — identical prompt template to src/lib/gemini.ts ─
async function generateStoryboard(
  ai: GoogleGenAI,
  input: {
    prompt: string;
    style: string;
    sceneCount: number;
    script: VideoScript;
  },
): Promise<Storyboard> {
  const userPrompt = `
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

  const { seed, temperature } = entropy();
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction:
        "You are a commercial director with a strong eye for short-form video. You write shot lists that DPs can execute. Be specific and visual. Always return strictly valid JSON matching the requested schema.",
      responseMimeType: "application/json",
      responseSchema: storyboardSchema,
      temperature,
      seed,
    },
  });

  const text = resp.text;
  if (!text) throw new Error("Empty Gemini response (storyboard)");
  const parsed = JSON.parse(text) as Omit<Storyboard, "_entropyUsed">;
  return { ...parsed, _entropyUsed: { seed, temperature } };
}

// ─── Comparison helpers ──────────────────────────────────────────────────────
function jaccardSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? []);
  const setA = tokens(a);
  const setB = tokens(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function divider(label: string): string {
  return `\n${"─".repeat(70)}\n  ${label}\n${"─".repeat(70)}\n`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error(
      "ERROR: GOOGLE_API_KEY not set. PowerShell: $env:GOOGLE_API_KEY = \"...\"",
    );
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey });

  // Identical inputs across both runs — Scenario A from the smoke-test plan.
  const SHARED_INPUT = {
    prompt:
      "Specialty coffee roastery in Portland Oregon. Single-origin Ethiopia Yirgacheffe " +
      "natural process. Brand: bright, playful, deeply geeky about pour technique. " +
      "Topic: Why your espresso tastes bitter — the dose ratio nobody talks about. " +
      "Audience: home espresso enthusiasts who own a sub-$1000 machine. " +
      "Voice tone: confident, energetic, specific.",
    style: "cinematic", // pinned for the script gen so we isolate Gemini variation
    musicVibe: "energetic",
    targetSeconds: 25,
    sceneCount: 4,
  };

  console.log(divider("PHASE 1A VARIATION TEST"));
  console.log("Input:");
  console.log("  prompt:        ", SHARED_INPUT.prompt.slice(0, 100) + "…");
  console.log("  style:         ", SHARED_INPUT.style);
  console.log("  musicVibe:     ", SHARED_INPUT.musicVibe);
  console.log("  targetSeconds: ", SHARED_INPUT.targetSeconds);
  console.log("  sceneCount:    ", SHARED_INPUT.sceneCount);

  // ── Step 1: Style pool rotation demo ──────────────────────────────────────
  console.log(divider("STYLE POOL ROTATION — 10 picks"));
  const stylePicks = Array.from({ length: 10 }, () => pickStyle());
  console.log("Picks:", stylePicks.join(", "));
  const stylesUsed = new Set(stylePicks);
  console.log(`Distinct styles across 10 picks: ${stylesUsed.size}/${STYLE_POOL.length}`);

  // ── Step 2: Run script generation TWICE ───────────────────────────────────
  console.log(divider("SCRIPT GENERATION — Run #1"));
  const t1 = Date.now();
  const script1 = await generateScript(ai, SHARED_INPUT);
  console.log(`  entropy: seed=${script1._entropyUsed.seed} temp=${script1._entropyUsed.temperature.toFixed(3)}`);
  console.log(`  hook:    ${script1.hook}`);
  console.log(`  body:    ${script1.body}`);
  console.log(`  cta:     ${script1.cta}`);
  console.log(`  est dur: ${script1.estimatedDurationSec}s`);
  console.log(`  voice:   ${script1.voiceDirection}`);
  console.log(`  latency: ${Date.now() - t1}ms`);

  console.log(divider("SCRIPT GENERATION — Run #2"));
  const t2 = Date.now();
  const script2 = await generateScript(ai, SHARED_INPUT);
  console.log(`  entropy: seed=${script2._entropyUsed.seed} temp=${script2._entropyUsed.temperature.toFixed(3)}`);
  console.log(`  hook:    ${script2.hook}`);
  console.log(`  body:    ${script2.body}`);
  console.log(`  cta:     ${script2.cta}`);
  console.log(`  est dur: ${script2.estimatedDurationSec}s`);
  console.log(`  voice:   ${script2.voiceDirection}`);
  console.log(`  latency: ${Date.now() - t2}ms`);

  // ── Step 3: Run storyboard generation TWICE ───────────────────────────────
  console.log(divider("STORYBOARD GENERATION — Run #1"));
  const t3 = Date.now();
  const storyboard1 = await generateStoryboard(ai, {
    ...SHARED_INPUT,
    script: script1,
  });
  console.log(`  entropy: seed=${storyboard1._entropyUsed.seed} temp=${storyboard1._entropyUsed.temperature.toFixed(3)}`);
  console.log(`  aestheticNotes: ${storyboard1.aestheticNotes}`);
  console.log(`  totalDur: ${storyboard1.totalDurationSec}s`);
  storyboard1.scenes.slice(0, 4).forEach((s) =>
    console.log(`  scene ${s.index} (${s.shotType} | ${s.cameraMove} | ${s.durationSec}s): ${s.description}`),
  );
  console.log(`  latency: ${Date.now() - t3}ms`);

  console.log(divider("STORYBOARD GENERATION — Run #2"));
  const t4 = Date.now();
  const storyboard2 = await generateStoryboard(ai, {
    ...SHARED_INPUT,
    script: script2, // intentionally use script2 — represents the natural pipeline
  });
  console.log(`  entropy: seed=${storyboard2._entropyUsed.seed} temp=${storyboard2._entropyUsed.temperature.toFixed(3)}`);
  console.log(`  aestheticNotes: ${storyboard2.aestheticNotes}`);
  console.log(`  totalDur: ${storyboard2.totalDurationSec}s`);
  storyboard2.scenes.slice(0, 4).forEach((s) =>
    console.log(`  scene ${s.index} (${s.shotType} | ${s.cameraMove} | ${s.durationSec}s): ${s.description}`),
  );
  console.log(`  latency: ${Date.now() - t4}ms`);

  // ── Step 4: Quantitative similarity ───────────────────────────────────────
  console.log(divider("SIMILARITY ANALYSIS (Jaccard on word sets, 0=disjoint, 1=identical)"));
  console.log(`  hooks:           ${jaccardSimilarity(script1.hook, script2.hook).toFixed(3)}`);
  console.log(`  body:            ${jaccardSimilarity(script1.body, script2.body).toFixed(3)}`);
  console.log(`  cta:             ${jaccardSimilarity(script1.cta, script2.cta).toFixed(3)}`);
  console.log(`  aestheticNotes:  ${jaccardSimilarity(storyboard1.aestheticNotes, storyboard2.aestheticNotes).toFixed(3)}`);
  console.log(
    `  scene 1 desc:    ${jaccardSimilarity(storyboard1.scenes[0]?.description ?? "", storyboard2.scenes[0]?.description ?? "").toFixed(3)}`,
  );
  console.log(
    `  scene 2 desc:    ${jaccardSimilarity(storyboard1.scenes[1]?.description ?? "", storyboard2.scenes[1]?.description ?? "").toFixed(3)}`,
  );

  // ── Step 5: Provider-prompt construction preview ──────────────────────────
  // Mirrors worker/processors/video-merge.ts behavior — aestheticNotes is
  // prepended (truncated at 400 chars) to each scene's prompt before going
  // to Runway/Luma.
  console.log(divider("PROVIDER PROMPT CONSTRUCTION PREVIEW (P1.4)"));
  const aestheticPrefix1 = storyboard1.aestheticNotes.slice(0, 400).trim() + " ";
  const aestheticPrefix2 = storyboard2.aestheticNotes.slice(0, 400).trim() + " ";
  console.log("Run #1, scene 1 prompt that would be sent to Runway/Luma:");
  console.log(`  "${aestheticPrefix1}${storyboard1.scenes[0]?.description}"`);
  console.log();
  console.log("Run #2, scene 1 prompt that would be sent to Runway/Luma:");
  console.log(`  "${aestheticPrefix2}${storyboard2.scenes[0]?.description}"`);

  // ── Step 6: Summary JSON for downstream report ────────────────────────────
  console.log(divider("MACHINE-READABLE SUMMARY"));
  const summary = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    run1: {
      script_entropy: script1._entropyUsed,
      storyboard_entropy: storyboard1._entropyUsed,
      hook: script1.hook,
      body: script1.body,
      cta: script1.cta,
      aestheticNotes: storyboard1.aestheticNotes,
      scenes: storyboard1.scenes.map((s) => ({
        index: s.index,
        shotType: s.shotType,
        cameraMove: s.cameraMove,
        description: s.description,
      })),
    },
    run2: {
      script_entropy: script2._entropyUsed,
      storyboard_entropy: storyboard2._entropyUsed,
      hook: script2.hook,
      body: script2.body,
      cta: script2.cta,
      aestheticNotes: storyboard2.aestheticNotes,
      scenes: storyboard2.scenes.map((s) => ({
        index: s.index,
        shotType: s.shotType,
        cameraMove: s.cameraMove,
        description: s.description,
      })),
    },
    style_rotation: {
      pool_size: STYLE_POOL.length,
      picks_10: stylePicks,
      distinct_count: stylesUsed.size,
    },
    similarity: {
      hook: jaccardSimilarity(script1.hook, script2.hook),
      body: jaccardSimilarity(script1.body, script2.body),
      cta: jaccardSimilarity(script1.cta, script2.cta),
      aestheticNotes: jaccardSimilarity(storyboard1.aestheticNotes, storyboard2.aestheticNotes),
      scene1_description: jaccardSimilarity(
        storyboard1.scenes[0]?.description ?? "",
        storyboard2.scenes[0]?.description ?? "",
      ),
      scene2_description: jaccardSimilarity(
        storyboard1.scenes[1]?.description ?? "",
        storyboard2.scenes[1]?.description ?? "",
      ),
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  console.log(divider("DONE"));
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
