# MG Technique Reproducibility — from the field (YouTube inventory)

**Status:** Research addendum to [09](09_MOTION_GRAPHICS_REFERENCE_LIBRARY.md). No code.
Source: the real YouTube search `motion graphics text` (titles + summaries **read**,
not watched — I have no video ingestion). Each popular technique is mapped to whether
our **frozen ASS/libass + FFmpeg** renderer can reproduce it and which primitive it
becomes. Extract principles only; never imitate/expose a brand.

## What the field is actually teaching (observed, by view count)
Scaling text reveal · kinetic typography · smooth eased title reveal (+ motion blur) ·
rolling/scrolling titles · 3D text · font-blur reveal · text match-cut · bounce text ·
text-along-path · handwritten stroke-on · **minimal LINE / BALL / CIRCLE motion graphics
(shape + text synced via trim-paths)** · text warp · text explode/scatter · typewriter ·
texturing · secondary motion.

## Reproducibility map (→ OttoFlow primitives)

| Technique | libass? | How (our stack) | Primitive / status |
|---|---|---|---|
| Scaling text reveal | ✅ | `\fscx\fscy` + `\t` | `reveal.scalePop` (have) |
| Kinetic typography (per-word) | ✅ | per-word `\move`/`\t` stagger | have (Motion Engine) |
| Smooth eased title reveal | ✅ | `\t` ease-out + `\fad` | have |
| ↳ its "motion blur" | ⚠️ | not native; approximate `\blur` on fast frames, or FFmpeg `tmix`/`tblend` (heavy) | skip/approx |
| Font-blur reveal | ✅ | `\blur` N→0 `\t` | `reveal.blurIn` (have) |
| Bounce text | ✅ | overshoot 2-seg `\t` | `reveal.scalePop` overshoot (have) |
| Mask / wipe text reveal | ✅ | animated rect `\clip` | `reveal.maskWipe` (built, wire next) |
| Rolling / scrolling title (ticker) | ✅ | `\move` linear (or `\clip` window) | **NEW: `motion.scroll`** |
| Typewriter | ✅ | animated `\clip` L→R over the line (or per-char `\k`/`\alpha`) | **NEW: `reveal.typeOn`** |
| 3D text (flip/rotate — affine only) | ✅ | `\frx \fry \frz` via `\t` (NO real extrude/depth) | **NEW: `reveal.flip3d`** |
| **Minimal LINE / BALL / shape motion graphics** | ✅ | `\p` vector line + animated `\clip` draw-on + a `\p` dot moved via `\move` — synced with placed text | **NEW: `decoration.lineDraw` + `decoration.travelDot`** — high value |
| Text explode / char scatter | ✅ | per-char events with `\move` outward (expensive; sparing) | **NEW: `reveal.scatter`** (accent only) |
| Handwritten stroke-on | ⚠️ | approximate via L→R `\clip` reveal (looks "written", not true stroke) | `reveal.maskWipe` reuse |
| Text warp (per-pixel) | ❌ | libass has no warp; only shear `\fax/\fay` | shear-only approximation |
| Text along a path | ❌ | libass has no text-on-path | not reproducible — skip |
| Text match-cut | ⚠️ | needs sync to a scene cut (FROZEN stitching) | limited |
| Texturing / grain on text | ⚠️ | FFmpeg overlay texture on the caption pass | FFmpeg-only, low priority |
| Secondary motion / follow-through | ✅ | stagger + focal-lands-last | have |

## The high-value finding (not RSVP, not "bigger captions")
The **"minimal line / ball / shape motion graphics"** family (a whole popular niche —
huge view counts) is **fully reproducible** with our `\p` vector drawing + animated
`\clip` + `\move`, and it is the *opposite* of a subtitle: a drawn line sweeps in, a dot
travels it, a small shape frames a placed word — restrained, geometric, unmistakably
"designed". This is a distinctive OttoFlow direction that (a) doesn't depend on caption
brevity, (b) composes the decoration + reveal primitives we already have/plan, and (c)
reads as broadcast/editorial motion graphics. It maps to a **Minimal / Precision / Signature**
philosophy and to the Decoration Engine.

## Additions to the roadmap (primitives to build; all libass-native, deterministic)
- **`decoration.lineDraw`** — a `\p` line/divider that draws on via animated `\clip`.
- **`decoration.travelDot`** — a `\p` dot that `\move`s along a drawn line (sync accent).
- **`reveal.typeOn`** — typewriter via animated `\clip` (a philosophy option).
- **`motion.scroll`** — linear `\move` roll (tickers/lower-thirds/Broadcast).
- **`reveal.flip3d`** — `\frx/\fry/\frz` reveal (Broadcast/News accents, sparing).
- **`reveal.scatter`** — per-char `\move` explode (Impact/Dynamic accent, sparing).
- Reuse `reveal.maskWipe` for wipe/handwritten-style reveals.

These slot into the existing engines (Composition/Motion/Decoration) and give each
OttoFlow philosophy a distinct recipe of the SAME primitives — the goal stated by the
operator (compose like a designer, many philosophies, not one-word RSVP).

## Honest limits confirmed
No text-on-path, no per-pixel warp, no true 3D extrude/lighting, no native motion-blur.
None are needed for premium 2D commercial/broadcast typography; everything else the field
teaches is reproducible on the renderer we already ship.
