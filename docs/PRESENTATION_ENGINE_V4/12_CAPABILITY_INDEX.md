# 12 · Capability Index — OttoFlow Motion Graphics Knowledge Base

> **Purpose.** This is the living registry of every reusable **capability** (primitive)
> in the Presentation Engine. Per the standing directive we store *capabilities, not
> examples*: every technique discovered in research becomes a pure, composable ASS-emitting
> function here — "hundreds, eventually thousands." A philosophy (style family) is a
> **recipe** that composes these by name; adding a philosophy = a config file, never engine code.
>
> **Invariants for every capability.** Pure function · returns libass-native override
> tags/drawings (no braces unless a full event body) · deterministic · fail-safe · zero
> dependency on the frozen pipeline. Nothing here renders unless a recipe references it, so
> the library grows at **zero production risk** (Legacy stays byte-identical; Modern opt-in).
>
> **How to read the tables.** `Signature` = call shape. `Emits` = the ASS vocabulary it
> uses. `Source` = the research doc/observation it was distilled from. `Recipe key` = the
> string a `StyleRecipe` uses to reference it.

---

## A · Reveal primitives (`src/lib/presentation/primitives/reveal.ts`)

*How an element ENTERS. The motion-graphics entrance vocabulary (doc 09 §B1).*

| Recipe key | Signature | Emits | Reads as | Source |
|---|---|---|---|---|
| `scalePop` | `scalePop(t, from, to, overshoot?, settleMs?)` | `\fscx/\fscy` + 2×`\t` | designed spring (dip→over→settle) | 09 §B1 |
| `blurIn` | `blurIn(t, fromBlur, toBlur?)` | `\blur` + `\t` | rack-focus resolve | 09 §B1 |
| `fadeIn` | `fadeIn(t)` | `\alpha` + `\t` | per-word alpha choreography | 09 §B1 |
| `maskWipe` | `maskWipe(t, box, dir?)` | animated `\clip` (rect) | signature reveal-behind-edge | 09 §B1 |
| `drawOn` | `drawOn(t, box)` | animated `\clip` | decoration "commit" wipe | 09 §B4 |
| `express` | `express(category, t)` | scale/rotate/stretch/`\alpha` | word-as-image (meaning=motion) | 11 |
| `letterCascade` | `letterCascade(word, t, perCharMs)` | per-char `\fscx/\fscy/\alpha` | animated-typeface build-on | 11 |
| `typewriter` | `typewriter(word, t, perCharMs)` | per-char `\alpha` stagger | typed reveal (cheap cascade) | 11 |
| `flipIn` | `flipIn(t, axis?, fromDeg?)` | `\frx`/`\fry` + `\t` | 3D broadcast card flip | 09 §B2 |
| `elastic` | `elastic(t, from, to, amp?)` | 3-seg `\t` spring | springier settle (over→under→rest) | 09 §B1 |
| `trackingExpand` | `trackingExpand(t, fromFsp, toFsp)` | `\fsp` + `\t` | luxury letter-spacing settle | 05 |
| `compress` | `compress(t, fromFsp, toFsp?)` | `\fsp` + `\t` | impact inward snap | 09 §B1 |

## B · Layout / composition primitives (`src/lib/presentation/primitives/layout.ts`)

*WHERE a beat sits. Kills the dead-centre subtitle tell (doc 09 §B3, roadmap #1).*

| Recipe key | Signature | Emits | Reads as | Source |
|---|---|---|---|---|
| `place` | `place(archetype, lineIndex, lineCount, frame, gap?)` | resolves `\an`+`\pos` | deliberate composition per archetype | 09 §B3 |
| `posTag` | `posTag(p)` | `\an\pos` | static hold at placement | 09 §B3 |
| `moveIn` | `moveIn(p, fromDy, durMs)` | `\an\move` | rise-into-place entrance | 09 §B2 |
| `slideIn` | `slideIn(p, dir, distPx, durMs)` | `\an\move` | directional broadcast slide | 09 §B2 |
| `lineWidthPx` | `lineWidthPx(text, fontPx, tracking?)` | (measure) | width for boxes/centering | — |
| `lineBox` | `lineBox(p, widthPx, fontPx)` | (measure) | bbox for maskWipe/decoration | — |

**Archetypes** (consumed by `place`): `centered · single-word-hero · dual-word-hero · stacked · number · lower-third · offset-left · offset-right · split`.

## C · Decoration primitives (`src/lib/presentation/primitives/decoration.ts`)

*Drawn vector elements via `\p` mode — turns text into COMPOSITION (doc 09 §B4). Each is its OWN Dialogue event on a layer under the text. **All render-verified** (probe render, this session).*

| Recipe key | Signature | Emits | Reads as | Source |
|---|---|---|---|---|
| `rect` | `rect(w, h)` | `\p` path | fill primitive (building block) | 09 §B4 |
| `underlineBar` | `underlineBar(cx, y, w, h, col, fadeMs?)` | `\p` + `\fad` | accent underline | 09 §B4 |
| `accentLine` | `accentLine(cx, y, w, h, col, t)` | `\p` + `drawOn` | draw-on minimal accent | 09 §B4 |
| `cardBacking` | `cardBacking(x, y, w, h, col, alpha?)` | `\p` + `\1a` | statistic card backing | 09 §B4 |
| `circle` | `circle(r)` | `\p` bezier (kappa) | round fill building block | 09 §B4 |
| `dot` | `dot(cx, cy, r, col, fadeMs?)` | bezier + `\fad` | ball/bullet accent | 09 §B4 |
| `divider` | `divider(cx, y, w, h, col, t?)` | `\p` + opt `drawOn` | section divider (opt draw-on) | 09 §B4 |
| `cornerBracket` | `cornerBracket(x, y, len, th, col, corner?)` | two `\p` arms | editorial/broadcast framing | 09 §B4 |
| `progressLine` | `progressLine(cx, y, w, h, col, durMs)` | `\p` + whole-beat `\clip` | time-bar / momentum cue | 09 §B4 |

## D · Motion / continuous primitives

*Continuous life during HOLD (not just entrance). Currently expressed inline in the compiler
via `\t` drift/hold; extraction to a `motion.ts` module is the next library task (see Backlog).*

| Recipe key | Status | Reads as | Source |
|---|---|---|---|
| `drift` | inline (compiler) | slow settle-scale during hold | 06 |
| `hold` | inline (compiler) | intentional stillness | 06 |
| `punch` | inline (compiler) | aggressive snap-in | 06 |

---

## Recipe grammar

A `StyleRecipe` (`styles/types.ts`) references the keys above:

```ts
recipe: {
  reveal:     string[],  // A · entrance vocabulary (composed in order)
  motion:     string[],  // D · continuous life during hold
  decoration: string[],  // C · drawn accents (gated per role)
  layout:     string,    // B · archetype family bias
  timing:     string,    // rhythm profile (calm | aggressive | …)
}
```

The compiler (`ass-captions.ts`) is a **pure recipe executor**: it never hardcodes an
animation — it looks up the keys and composes the emitted fragments.

### Current philosophies

| Philosophy | reveal | motion | decoration | layout | timing |
|---|---|---|---|---|---|
| **OttoFlow · Premium** | riseFade, blurResolve | drift, hold | accentLine | editorial | calm |
| **OttoFlow · Impact** | pop, scatter | punch | accentLine | hero | aggressive |

---

## Backlog (next capabilities to distil)

- **Motion module (`motion.ts`)** — extract `drift`/`hold`/`punch` from the compiler into
  named pure primitives; add `float`, `parallaxDrift`, `breathe`, `settleRotate`.
- **Transitions** — `crossPush`, `wipeHandoff`, `maskCarry` (beat→beat continuity).
- **Reveals** — `splitReveal`, `unmaskDown`, `charScramble`, `countUp` (numeric roll).
- **Decoration** — `bracketPair` (auto tl+tr/bl+br), `ticksRule`, `boxDraw`, `highlightSweep`.
- **Layout** — `ruleOfThirds`, `magazineGrid`, `diagonalStack`.
- **Attention** — colour-pop isolation, size-jump hierarchy, negative-space framing.
- Then: migrate reveal+motion **selection** fully onto the recipe, and author config-only
  philosophies (Documentary / Editorial / Broadcast) with **no engine change**.

> Every new capability lands here the moment it exists. This index is the map of the library.
