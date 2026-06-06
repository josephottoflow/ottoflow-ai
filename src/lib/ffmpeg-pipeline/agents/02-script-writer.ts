/**
 * Agent 2: Script Writer (Release A stub).
 *
 * Will call Gemini with the strategy + duration target and return 5
 * timestamped sections totalling 30-60 s. Each section's text is what
 * ElevenLabs will narrate; the timestamps feed Agent 9 (Timing) so scene
 * boundaries line up with rhetorical beats.
 *
 * Release A returns a 32 s skeleton script so the orchestrator can produce
 * a valid CompositionPlan end-to-end.
 */
import type {
  AgentContext,
  ScriptInput,
  ScriptOutput,
} from "../types";

export async function runScriptWriter(
  input: ScriptInput,
  ctx: AgentContext,
): Promise<ScriptOutput> {
  ctx.log("agent.scriptWriter.start", {
    targetSec: input.targetDurationSec,
  });

  // Release A skeleton — 32 s, five sections.
  const hook = {
    text: "Stop scrolling — this changes everything you thought you knew.",
    startMs: 0,
    endMs: 5500,
  };
  const problem = {
    text: "Most people waste hours every week on tasks that should take minutes.",
    startMs: 5500,
    endMs: 13000,
  };
  const value = {
    text: "Here's the system that turns that whole process into one click.",
    startMs: 13000,
    endMs: 22000,
  };
  const conclusion = {
    text: "That's how you reclaim your week — without burning out.",
    startMs: 22000,
    endMs: 28500,
  };
  const cta = {
    text: "Follow for more — link in bio for the full breakdown.",
    startMs: 28500,
    endMs: 32000,
  };

  return {
    hook,
    problem,
    value,
    conclusion,
    cta,
    totalDurationSec: 32,
    fullText: [hook, problem, value, conclusion, cta]
      .map((s) => s.text)
      .join(" "),
  };
}
