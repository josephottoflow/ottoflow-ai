/**
 * Golden-snapshot harness (Phase 1 safety infrastructure).
 *
 * A tiny, dependency-free golden-file utility used to LOCK deterministic render
 * artifacts so future changes cannot silently alter them. At this stage the
 * "golden frame" is the render's deterministic instruction layer — the generated
 * ASS caption string — captured byte-for-byte. Pixel-level frame hashing is a
 * later infrastructure item (it needs a pinned FFmpeg + font toolchain to be
 * reproducible); this harness is structured so such artifacts can be added as
 * more named snapshots without changing the contract.
 *
 * Contract: pure w.r.t. clock/network. Snapshots live next to this file under
 * __snapshots__/ and are COMMITTED, so CI compares against them. Bootstrapping a
 * missing snapshot (or UPDATE_GOLDEN=1) writes it — the standard golden workflow.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, "__snapshots__");

/** Stable SHA-256 of a UTF-8 string. */
export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface GoldenResult {
  /** Snapshot path relative to __snapshots__/. */
  name: string;
  /** True when `actual` equals the committed golden (or was just bootstrapped). */
  matched: boolean;
  /** True when the snapshot was written this run (missing, or UPDATE_GOLDEN=1). */
  bootstrapped: boolean;
  actualSha: string;
  goldenSha?: string;
}

/**
 * Compare `actual` against a committed golden snapshot at __snapshots__/<relPath>.
 *   - Missing snapshot, or UPDATE_GOLDEN=1 → write it and report matched:true,
 *     bootstrapped:true (first-capture / refresh workflow).
 *   - Otherwise → byte-compare and report the result (never throws).
 */
export function matchGolden(relPath: string, actual: string): GoldenResult {
  const file = join(SNAP_DIR, relPath);
  const update = process.env.UPDATE_GOLDEN === "1";
  const actualSha = sha256(actual);
  if (update || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual, "utf8");
    return { name: relPath, matched: true, bootstrapped: true, actualSha };
  }
  const golden = readFileSync(file, "utf8");
  return {
    name: relPath,
    matched: golden === actual,
    bootstrapped: false,
    actualSha,
    goldenSha: sha256(golden),
  };
}
