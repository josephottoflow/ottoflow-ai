/**
 * PRESENTATION INTELLIGENCE — Communication Goal + Attention Strategy + Presentation Feel.
 * The layers between INTENT ("what kind of beat is this?") and the concrete presentation
 * decision. A creative director asks, in order: what is this beat trying to ACHIEVE
 * (communication goal), how should the eye MOVE (attention strategy), and how should it
 * FEEL (presentation feel) — only then composition/motion/decoration. Pure/deterministic.
 */
import type { BeatSignals } from "./signals";
import type { PresentationIntent } from "./decide";

/** What the beat is trying to accomplish. Influences every downstream decision. */
export type CommunicationGoal =
  | "proof" | "persuade" | "authority" | "trust" | "curiosity"
  | "urgency" | "transformation" | "impact" | "educate" | "resolution";

/** How the viewer's eye should move — decided BEFORE animation. */
export type AttentionStrategy =
  | "largeNumber" | "singleFocus" | "negativeSpace" | "maskReveal"
  | "stillness" | "motionBurst" | "splitContrast" | "editorialFrame";

/** How the beat should FEEL. */
export type PresentationFeel =
  | "premium" | "calm" | "authoritative" | "energetic" | "technical" | "emotional" | "editorial";

/** Derive the communication goal from intent + signals. */
export function communicationGoal(s: BeatSignals, intent: PresentationIntent): CommunicationGoal {
  switch (intent) {
    case "statistic": return "proof";
    case "quote": return "trust";
    case "contrast": return "transformation";
    case "cta": return "urgency";
    case "question": return "curiosity";
    case "title": return "impact";
    default:
      if (s.hasPain) return "curiosity";        // problem-agitate → make them lean in
      return "educate";
  }
}

/** Decide how the eye should move (attention strategy) from intent + signals. */
export function attentionStrategy(s: BeatSignals, intent: PresentationIntent): AttentionStrategy {
  switch (intent) {
    case "statistic": return "largeNumber";
    case "contrast": return "splitContrast";
    case "quote": return "editorialFrame";
    case "cta": return "motionBurst";
    case "title": return s.wordCount <= 1 ? "singleFocus" : "maskReveal";
    case "question": return "singleFocus";
    default: return s.lineCount >= 2 ? "editorialFrame" : "singleFocus";
  }
}

/** Derive the FEEL of the beat (a nudge on top of the philosophy's base voice). */
export function presentationFeel(goal: CommunicationGoal): PresentationFeel {
  switch (goal) {
    case "proof": case "authority": return "authoritative";
    case "urgency": case "impact": return "energetic";
    case "trust": case "resolution": return "premium";
    case "transformation": case "persuade": return "editorial";
    case "curiosity": return "emotional";
    default: return "calm";
  }
}

/** Motion bias implied by the attention strategy (does the eye want stillness or a burst?). */
export function motionForAttention(a: AttentionStrategy): "animate" | "settle" | null {
  if (a === "stillness" || a === "largeNumber" || a === "editorialFrame") return "settle";
  if (a === "motionBurst" || a === "maskReveal") return "animate";
  return null; // no strong preference → leave to rhythm/intent
}
