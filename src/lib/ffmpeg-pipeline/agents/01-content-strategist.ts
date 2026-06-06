/**
 * Agent 1: Content Strategist (Release A stub — full impl in Release B).
 *
 * Will call Gemini with the topic + brand industry and return:
 *   - hookStrategy   ("disrupt with stat")
 *   - narrativeStrategy ("problem → agitation → solution")
 *   - ctaStrategy    ("scarcity-driven follow")
 *   - audienceProfile (one paragraph)
 *   - emotionalArc   (5 beats from curious → confident)
 *
 * Release A returns a deterministic skeleton so downstream agents can run
 * end-to-end. Replace the body with a `geminiStructured()` call against the
 * schema below in Release B (file is already wired into orchestrator.ts).
 */
import type {
  AgentContext,
  StrategistInput,
  StrategistOutput,
} from "../types";

export async function runContentStrategist(
  input: StrategistInput,
  ctx: AgentContext,
): Promise<StrategistOutput> {
  ctx.log("agent.strategist.start", { topic: input.topic });

  // RELEASE A: deterministic skeleton, no LLM call.
  const industry = input.brandIndustry ?? "general";
  return {
    hookStrategy: `Lead with a counter-intuitive stat that challenges what a ${industry} viewer believes about "${input.topic}"`,
    narrativeStrategy: "problem → agitation → reveal → proof → CTA",
    ctaStrategy: "low-friction follow + soft mention of brand handle",
    audienceProfile: `Mobile-first viewers interested in ${industry}; scroll past anything that doesn't grab in 1.5 s`,
    emotionalArc: [
      { startPct: 0.0, emotion: "curious",  intensity: 0.7 },
      { startPct: 0.2, emotion: "anxious",  intensity: 0.6 },
      { startPct: 0.5, emotion: "hopeful",  intensity: 0.75 },
      { startPct: 0.75, emotion: "confident", intensity: 0.85 },
      { startPct: 0.95, emotion: "energetic", intensity: 0.8 },
    ],
  };
}
