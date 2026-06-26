/**
 * Creative Direction engine (Sprint 18c — brief-driven art direction).
 *
 * The PRIMARY driver of a creative's look is the Creative Brief — the campaign
 * objective, target audience, desired emotion and key message — exactly how a
 * human art director reads a client brief. INDUSTRY is only a soft CONSTRAINT
 * on which photographic worlds are plausible; it never fixes the look. So three
 * brands in the same industry with different objectives (luxury villas vs.
 * property management vs. property investment) render as three completely
 * different photographic worlds.
 *
 * This file therefore offers a RANGE of plausible worlds per industry (a
 * constraint), not a single preset. The concept model chooses/compose the
 * specific world from the brief. A deterministic fallback (used only when the
 * model fails, where there is no brief to read) picks a sensible default.
 */
export interface IndustryConstraint {
  /** A RANGE of plausible real-world settings — the brief picks/combines one. */
  worlds: string;
  /** Characteristic materials, textures and light the industry can draw on. */
  palette: string;
}

const CONSTRAINTS: { match: RegExp; c: IndustryConstraint }[] = [
  {
    match: /tech|software|saas|\bai\b|data|cloud|cyber|developer|platform|app|digital|automation|analytics/,
    c: {
      worlds: "modern glass offices, data-center corridors, product close-ups on clean desks, hands using a device in context, urban tech skylines, futuristic interiors",
      palette: "glass, brushed metal, screens and LED light, reflections, volumetric haze",
    },
  },
  {
    match: /health|medical|clinic|hospital|\bcare\b|pharma|wellness|\bbio|dental|therapy|mental|fitness/,
    c: {
      worlds: "calm clinical rooms, sunlit recovery spaces, natural wellness environments, bright homes, hands-and-care moments, serene outdoor calm",
      palette: "soft white surfaces, natural daylight, organic materials, glass, gentle reflections",
    },
  },
  {
    match: /real estate|property|realty|architect|interior|residential|housing|villa|rental|landlord/,
    c: {
      worlds: "luxury villa interiors, golden-hour exteriors, urban developments, suburban family homes, executive property offices, key-handover moments, well-maintained communal spaces",
      palette: "stone, timber, glass, window light, golden hour, architectural materials",
    },
  },
  {
    match: /restaurant|food|cafe|culinary|dining|beverage|coffee|hospitality|bakery|kitchen/,
    c: {
      worlds: "plated dishes, intimate dining rooms, busy open kitchens, market-fresh ingredients, warm cafe corners, hands-and-food moments",
      palette: "warm practical light, ceramics, timber tables, steam, ingredient textures",
    },
  },
  {
    match: /construction|build|contractor|engineering|industrial|manufactur|infrastructure|materials|machinery|trades?/,
    c: {
      worlds: "active build sites, raw materials up close, machinery in sunlight, finished structures, plans reviewed on site, a site's before-and-after",
      palette: "steel, concrete, timber, dust in sunlight, hi-vis accents, real shadows",
    },
  },
  {
    match: /finance|bank|invest|capital|fintech|wealth|insurance|account|fund|trading|equity|advisory/,
    c: {
      worlds: "executive interiors, modern city views, refined boardrooms, premium materials up close, considered home offices, calm professional spaces",
      palette: "polished stone, glass, controlled light, premium textures, restrained reflections",
    },
  },
];

const DEFAULT_CONSTRAINT: IndustryConstraint = {
  worlds: "any premium real-world editorial environment that fits the brand and this campaign",
  palette: "natural light, real materials, reflections and atmospheric depth",
};

export function industryConstraint(industry: string | null): IndustryConstraint {
  const i = (industry ?? "").toLowerCase();
  return CONSTRAINTS.find((x) => x.match.test(i))?.c ?? DEFAULT_CONSTRAINT;
}

/** Constraint block for the concept prompt — a RANGE the brief chooses from. */
export function industryConstraintBlock(industry: string | null): string {
  const c = industryConstraint(industry);
  return (
    `INDUSTRY CONSTRAINT (it only narrows what's plausible — it does NOT fix the look):\n` +
    `- Plausible worlds to choose from or combine: ${c.worlds}\n` +
    `- Characteristic light & materials available: ${c.palette}\n` +
    `The CAMPAIGN OBJECTIVE + DESIRED EMOTION decide WHICH world, and the lighting, lens, mood and composition.`
  );
}

/** Deterministic fallback (last resort — no brief to read; picks a sensible default). */
export function fallbackWorldPrompt(industry: string | null, colorClause: string, metaphor?: string): string {
  const c = industryConstraint(industry);
  const firstWorld = c.worlds.split(",")[0].trim();
  const scene = metaphor && metaphor.trim() ? metaphor.trim() : `a premium real-world environment (${firstWorld})`;
  return (
    `Cinematic premium commercial photograph: ${scene}. Natural directional light, ${c.palette}, ` +
    `shallow depth of field, realistic textures and atmospheric depth, editorial composition with generous ` +
    `negative space. Brand colour appears only as light within the scene${colorClause}. ` +
    `No geometric shapes, no bars, no graphic overlays — a real photographic scene.`
  );
}
