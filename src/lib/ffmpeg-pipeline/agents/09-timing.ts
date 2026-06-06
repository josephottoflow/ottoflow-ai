/**
 * Agent 9: Timing.
 *
 * The scene plan's startMs/endMs were derived from the SCRIPT's estimated
 * timing. The ACTUAL narration (ElevenLabs) is rarely exactly that length.
 * This agent re-bases every scene's window onto the real narration duration
 * so there's no dead air at the end and no scene gets cut off mid-sentence.
 *
 * Approach: preserve each scene's PROPORTION of the original plan, then scale
 * to the real narration duration. Assign symmetric transition padding and a
 * Ken Burns sweep that fills the whole scene.
 *
 * No LLM — pure arithmetic.
 */
import type {
  AgentContext,
  TimingInput,
  TimingOutput,
  TimingPlan,
} from "../types";

const TRANSITION_MS = 400;

export async function runTiming(
  input: TimingInput,
  ctx: AgentContext,
): Promise<TimingOutput> {
  const { scenes, narrationDurationSec } = input;
  ctx.log("agent.timing.start", {
    scenes: scenes.length,
    narrationSec: narrationDurationSec,
  });

  const realTotalMs = Math.max(1000, Math.round(narrationDurationSec * 1000));
  const planTotalMs =
    scenes[scenes.length - 1].endMs - scenes[0].startMs || realTotalMs;
  const scale = realTotalMs / planTotalMs;

  const perScene: TimingPlan[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const planDur = s.endMs - s.startMs;
    let dur = Math.round(planDur * scale);
    // Last scene absorbs rounding drift so the timeline ends exactly at
    // realTotalMs (no dead air, no overrun).
    if (i === scenes.length - 1) {
      dur = realTotalMs - cursor;
    }
    const start = cursor;
    const end = cursor + dur;
    perScene.push({
      sceneId: s.sceneId,
      videoStartMs: start,
      videoEndMs: end,
      transitionInMs: i === 0 ? 0 : TRANSITION_MS,
      transitionOutMs: i === scenes.length - 1 ? 0 : TRANSITION_MS,
      kenBurnsMs: dur,
    });
    cursor = end;
  }

  ctx.log("agent.timing.done", {
    totalMs: realTotalMs,
    perScene: perScene.map((p) => p.videoEndMs - p.videoStartMs),
  });

  return { perScene, totalDurationMs: realTotalMs };
}
