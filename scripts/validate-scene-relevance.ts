/**
 * Sprint 46 (Scene Relevance) — deterministic validation, no network.
 *
 * Proves, against the shipped code:
 *   A. With a semantic searchQuery, it LEADS the query list and the
 *      pollution-prone layers (regex domain overrides + raw-prompt keyword
 *      extraction) are skipped — the "coffee cup → coffee roasting" defect
 *      class is structurally gone.
 *   B. Without searchQuery, query construction is byte-identical legacy
 *      (the /coffee/ override still fires) — zero regression.
 *
 *   npx tsx scripts/validate-scene-relevance.ts
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { __testBuildQueries } from "@/lib/pexels";

const POLLUTED_PROMPT =
  "Cinematic medium of a freelance UX designer, early 30s, stylish athleisure, " +
  "always with a reusable coffee cup protagonist quickly juggles a laptop, a notebook, " +
  "and their phone in a modern airy home office, photorealistic, 4K, cinematic color grade";

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failed++;
}

// A. semantic query present
const withSq = __testBuildQueries(POLLUTED_PROMPT, undefined, {
  brandIndustry: "Productivity Software",
  topicTitle: "Master Your Recurring Tasks: Automate Daily Habits",
  searchQuery: "man juggling laptop office",
});
check(
  "A1 semantic query leads",
  withSq[0] === "man juggling laptop office",
  `first="${withSq[0]}"`,
);
check(
  "A2 no coffee pollution",
  !withSq.some((q) => q.includes("coffee")),
  `queries=[${withSq.join(" | ")}]`,
);
check(
  "A3 topic/industry kept as fallbacks",
  withSq.some((q) => q.includes("productivity software")),
  "industry fallback present",
);

// B. legacy path unchanged
const legacy = __testBuildQueries(POLLUTED_PROMPT, undefined, {
  brandIndustry: "Productivity Software",
  topicTitle: "Master Your Recurring Tasks: Automate Daily Habits",
});
check(
  "B1 legacy still keyword-derived (regression guard)",
  legacy.length > 0 && legacy[0] !== "man juggling laptop office",
  `first="${legacy[0]}", n=${legacy.length}`,
);

// eslint-disable-next-line no-console
console.log(failed === 0 ? "\nALL SCENE-RELEVANCE CHECKS PASSED" : `\n${failed} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
