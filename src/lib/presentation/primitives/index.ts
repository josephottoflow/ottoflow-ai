/**
 * Motion Graphics Primitives (V5) — the reusable, composable building blocks.
 * Styles select primitives + params; the ASS compiler composes their emitted
 * fragments. Nothing hardcoded in the compiler. See docs 09 (technique catalogue /
 * primitive architecture). Renderer-native (libass) — no engine change.
 */
export * from "./types";
export * as reveal from "./reveal";
export * as layout from "./layout";
export * as decoration from "./decoration";
