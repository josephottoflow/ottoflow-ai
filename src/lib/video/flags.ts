/**
 * Video V1 render feature flags (pre-production hardening).
 *
 * Server-only, lazy (read on use; NOT in env.ts/worker-env.ts) so production
 * with the flags unset behaves exactly as before — the entire AI-render path is
 * dark by default. All flags FAIL CLOSED: anything other than the literal
 * string "true" → disabled.
 *
 * Gates:
 *   isVideoRenderEnabled()  — POST /api/video/generate, POST /api/generate, and
 *                             the scene-generation worker registration. When
 *                             false, no render is reachable and no Seedance
 *                             credit can be spent.
 *   isRunwayEnabled()/isLumaEnabled() — opt-in paid fallbacks. Off by default,
 *                             so a Seedance miss falls straight to free Pexels
 *                             instead of silently spending on Runway/Luma.
 */
export function isVideoRenderEnabled(): boolean {
  return process.env.VIDEO_RENDER_ENABLED === "true";
}

/** Paid Runway fallback — opt-in only (default off). */
export function isRunwayEnabled(): boolean {
  return process.env.VIDEO_ENABLE_RUNWAY === "true";
}

/** Paid Luma fallback — opt-in only (default off). */
export function isLumaEnabled(): boolean {
  return process.env.VIDEO_ENABLE_LUMA === "true";
}
