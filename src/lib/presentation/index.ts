/**
 * OttoFlow Presentation Engine V4 — public surface (Phase 1 foundation).
 *
 * Foundation only: exported for unit tests + future consumption by
 * ass-captions.ts (Modern profiles). Nothing imports it in the render path yet,
 * so every render stays byte-identical. See docs/PRESENTATION_ENGINE_V4/.
 */
export * from "./types";
export { DEFAULT_PASSES } from "./passes";
export { initModel, runPresentationEngine } from "./engine";
