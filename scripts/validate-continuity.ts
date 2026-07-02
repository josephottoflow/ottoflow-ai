/**
 * Sprint 47 (Protagonist Continuity) — deterministic validation, no network.
 *
 * Exercises the shipped applyShotContinuity guard:
 *   A. First person-led scene (the anchor) keeps its query.
 *   B. Later person-led queries are demoted to their planned subject-neutral
 *      framing (the "woman scene 1 / man scene 4" defect class).
 *   C. Already-neutral queries are untouched.
 *   D. Demotion respects the planned subjectVisibility idiom.
 *
 *   npx tsx scripts/validate-continuity.ts
 */
import { applyShotContinuity } from "@/lib/ffmpeg-pipeline/story-agent";

const scenes = [
  { searchQuery: "woman working home desk", subjectVisibility: "face" },        // anchor
  { searchQuery: "hands typing keyboard", subjectVisibility: "hands" },         // already neutral
  { searchQuery: "man rubbing temples desk", subjectVisibility: "hands" },      // person-led → demote
  { searchQuery: "man using tablet app", subjectVisibility: "over-shoulder" },  // person-led → demote
  { searchQuery: "silhouette office window", subjectVisibility: "silhouette" }, // neutral
  { searchQuery: "woman walking park phone", subjectVisibility: "back" },       // person-led → demote
];
applyShotContinuity(scenes);

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failed++;
}

check("A anchor kept", scenes[0].searchQuery === "woman working home desk", scenes[0].searchQuery!);
check("C neutral untouched", scenes[1].searchQuery === "hands typing keyboard" && scenes[4].searchQuery === "silhouette office window", `${scenes[1].searchQuery} / ${scenes[4].searchQuery}`);
check("B1 demoted (hands)", scenes[2].searchQuery === "hands rubbing temples desk", scenes[2].searchQuery!);
check("B2 demoted (over-shoulder)", scenes[3].searchQuery === "over shoulder using tablet app", scenes[3].searchQuery!);
check("B3 demoted (back)", scenes[5].searchQuery === "back view walking park phone", scenes[5].searchQuery!);
check("D no person words after pass", scenes.slice(1).every((s) => !/^(woman|man|person)\b/.test(s.searchQuery!)), scenes.map((s) => s.searchQuery).join(" | "));

// eslint-disable-next-line no-console
console.log(failed === 0 ? "\nALL CONTINUITY CHECKS PASSED" : `\n${failed} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
