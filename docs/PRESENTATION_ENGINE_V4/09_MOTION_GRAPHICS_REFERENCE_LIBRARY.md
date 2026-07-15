# OttoFlow Motion Graphics Reference Library

**Status:** PERMANENT research library. **No code.** The pivot: stop building a
Caption Engine, build a **Motion Graphics Engine** on the *frozen* renderer. Design
principles live in [05](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md)/[06](06_CREATIVE_DIRECTION_BIBLE.md)/[07](07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE.md);
this document is the **technical capability map** (what ASS/libass + FFmpeg can
actually reproduce) + a **categorised technique catalogue** + the **implementation
roadmap**. Brands/creators cited are research references only — identity discarded.

---

## PART 0 — THE LOAD-BEARING FINDING

> **We do not need a new renderer. We have been using ~20% of libass.**

Our compose step already burns captions with FFmpeg's `ass=` filter, and **that
filter IS libass** — so *any* ASS we emit is rendered, including tags we've never
used. The gap between "animated subtitles" and "motion graphics" is almost entirely
**ASS tags we aren't generating yet**:

| We use today | We have NOT used (the motion-graphics unlock) |
|---|---|
| `\k/\kf` karaoke, `\fscx/\fscy` scale, `\t` (scale/color/blur), `\fad`, `\fs`, `\fsp`, `\1c`, `\blur`, Alignment 5 (dead-centre) | **`\pos(x,y)`** arbitrary placement · **`\move`** kinetic slide/fly-in · **animated `\clip`** masked wipe reveals · **`\frx/\fry/\frz`** 3D flips/perspective · **`\fax/\fay`** shear · **`\p` vector drawing** (draw bars/cards/underlines/shapes) · **`\org`** pivot/orbit |

Those unused tags ARE the motion-graphics vocabulary. Conclusion for the whole
initiative: **the Motion Graphics Engine is a richer ASS *compiler*, not a new
render engine.** Remotion / Motion Canvas / Lottie / Rive are studied for
*principles only* — adopting them would violate the frozen-renderer rule and is
unnecessary.

---

## PART A — TECHNICAL CAPABILITY MAP

### A1. ASS / libass (primary text + vector layer; rendered by our `ass=` filter)
Sources: libass wiki (ASSv5 Override Tags, Extensions), Aegisub tag reference.

| Tag | Capability | Motion-graphics use | Animatable? |
|---|---|---|---|
| `\pos(x,y)` | absolute line position | **non-centered composition** — hero words placed anywhere, lower-third, offset, corners | static per line |
| `\move(x1,y1,x2,y2,t1,t2)` | animate position over time | slide-in, fly-in, drift, push, parallax of text | yes (built-in) |
| `\clip(x1,y1,x2,y2)` + `\t` | rectangular mask, **animatable** | **masked wipe reveals** (text revealed behind a moving edge — THE signature MG reveal), draw-on underlines, box wipes | yes (rect only) |
| `\iclip` | inverse rect clip, animatable | reveal-from-center, wipe-out | yes (rect) |
| `\frx \fry \frz` | 3D rotation X/Y/Z | flip-in, card-turn, perspective tilt, Z-spin | yes via `\t` |
| `\fax \fay` | shear/skew | italic-lean dynamics, motion smear | yes via `\t` |
| `\p1..` + drawing cmds `m l b` | **vector drawing mode** | draw **bars, cards, underlines, dividers, geometric shapes, backgrounds, light-sweep rects** as ASS primitives — then animate with `\t`/`\move`/`\clip` | shape static; transforms animate |
| `\org(x,y)` | rotation origin | orbit, pivot-swing, hinge reveals |  via `\t` rotations |
| `\t(t1,t2,accel,…)` | tween most tags | scale/rot/color/blur/shear/clip easing; multi-segment for overshoot | core engine |
| `\blur \be` | gaussian / edge blur | **blur-in reveals** (rack focus), glow | yes via `\t` |
| `\1c\2c\3c\4c \alpha \1a…` | per-tag fill/karaoke/outline/shadow colour + alpha | gradient-feel (per-word colour ramps), selective reveals | yes via `\t` |
| `\bord \shad \xbord \ybord` | outline / drop shadow (per-axis) | depth, legibility, offset-shadow "print" look | yes via `\t` |
| `\fad \fade(a1,a2,…)` | simple / complex fades | timed opacity choreography | built-in |
| `\k \kf \ko \kt` | karaoke timing | word-sync reveals (we use) | built-in |

**libass limits (hard):** vector `\clip` can't animate (only rect) · no true
per-pixel shaders / displacement · no motion-blur trails (approximate with
duplicated fading layers) · no real 3D depth/lighting (only affine `\frx/y/z`) ·
gradients only via `\p` shape fills or stacked layers (no native text gradient) ·
one-pass render (no feedback). Everything else in premium 2D kinetic typography is
reproducible.

### A2. FFmpeg (compose-level, full-frame; for what ASS can't do)
| Filter | Capability | Motion-graphics use |
|---|---|---|
| `ass=` | renders our ASS via libass | ALL of A1 |
| `drawtext` (x/y/alpha/fontsize = expr) | per-frame text expressions | rarely needed (ASS is richer) |
| `overlay` (`enable=between`, x/y expr) | animate PNG/asset layers | logo reveal, light-sweep PNG, drawn cards, badge reveals (outro already uses this) |
| `zoompan` | Ken-Burns camera push/zoom | living camera on stills / outro (we use) |
| `gradients`, `geq`, `colorchannelmixer` | procedural gradients / per-pixel | light sweeps, glow blooms, grades |
| `boxblur`/`gblur`, `eq` | blur/grade | defocus backdrops (outro uses), depth |
| `xfade`, `blend` | transitions/compositing | (scene transitions live in FROZEN stitching — out of scope) |
| `format=yuva`, `alphamerge` | alpha compositing | layered element reveals (outro uses) |

**FFmpeg role:** full-frame atmosphere (light, blur, camera, grade) + animated
image layers (logo, sweeps, drawn cards). **Text motion belongs in ASS.** Scene-to-
scene transitions stay in the frozen stitching — not ours.

### A3. Verdict
**Reproducible on our stack:** word reveals (fade/scale/slide/mask-wipe/blur/3D-flip),
number reveals (scale-pop, mask count-up-ish), hero/split/offset/stacked/statistic
**layouts** (`\pos`), underline draw-ons (`\clip` on `\p` bar), light sweeps (moving
`\p` gradient rect or FFmpeg overlay), glow (blur layers / FFmpeg), blur reveals,
camera-inspired push (zoompan/`\move` parallax), text choreography (per-word `\move`
+ `\t` stagger), attention choreography (singular motion via timing). **NOT
reproducible:** true 3D/lighting, per-pixel warps, motion-blur trails, physics sims —
none of which premium 2D commercial typography actually requires.

---

## PART B — MOTION GRAPHICS TECHNIQUE CATALOGUE

Format per entry: **Technique** — why it works / attention / ASS? · FFmpeg? ·
difficulty (1–5) · OttoFlow? (which styles). Grounded in kinetic-typography, broadcast,
and fansub-typesetting practice (references only).

### B1. Word reveals
1. **Fade-rise** — opacity + small `\move` up; calm, legible. ASS✓ FF– · d1 · ALL (base).
2. **Scale-pop + overshoot** — `\fscx` via 2-seg `\t`; energy. ASS✓ · d1 · done.
3. **Mask wipe-in** — text revealed L→R behind animated `\clip` rect; *the* MG reveal, feels "printed on". ASS✓ · d3 · Premium/Editorial/Broadcast. **HIGH PRIORITY.**
4. **Blur-in (rack focus)** — `\blur` N→0 via `\t`; cinematic. ASS✓ · d2 · Premium/Cinematic (done for keyword).
5. **Slide-in** — `\move` from off-anchor; kinetic. ASS✓ · d2 · Impact/Dynamic/Momentum.
6. **3D flip-in** — `\fry` 90→0; broadcast lower-third feel. ASS✓ · d3 · Broadcast/News.
7. **Line-mask push** — whole line wipes up behind a mask as prior line wipes out; continuous rhythm. ASS✓ · d4 · Editorial/Story.
8. **Per-letter cascade** — letters staggered (split to `\N`-less per-char events); expensive, use sparingly. ASS✓ · d4 · Signature accent only.

### B2. Number / statistic reveals
9. **Figure-dominant (large-number)** — number huge, label small; the stat IS the shot. ASS✓ · d2 · Impact/Corporate (done inline). 
10. **Count-up illusion** — sequential k-timed digits / rapid swap of digit events; "ticking" energy. ASS✓ · d4 · Impact/Sports.
11. **Underlined metric card** — drawn `\p` card behind number + draw-on underline. ASS✓ · d3 · Corporate/Broadcast.

### B3. Layouts (composition — the biggest current gap)
12. **Single-word hero** — one giant word, `\pos` centred, held. ASS✓ · d2 · ALL hooks. **HIGH.**
13. **Stacked kicker+headline** — small word `\pos` above big word. ASS✓ · d2 · Premium/Editorial.
14. **Offset / asymmetric** — `\pos` off-centre (lower-left/right), editorial tension. ASS✓ · d3 · Editorial/Story (RF-tune over footage).
15. **Lower-third band** — `\pos` lower area + drawn `\p` bar. ASS✓ · d3 · Broadcast/News/Corporate.
16. **Split (contrast)** — two half-frame blocks (before/after, but/instead). ASS✓ · d3 · Story/Editorial.
17. **Corner-anchored micro** — small label in a corner (`\pos` + `\an`). ASS✓ · d2 · Documentary/Minimal.

### B4. Underlines / dividers / bars / light
18. **Draw-on underline** — animated `\clip` reveals a `\p` bar L→R (our "commit" gesture). ASS✓ · d3 · Premium/Impact endings. **HIGH.**
19. **Light sweep** — a bright translucent `\p`/overlay rect `\move`s across text once. ASS✓ FF✓ · d3 · Premium/Luxury moments.
20. **Glow bloom** — blur layer / FFmpeg radial grows in behind focal. ASS~ FF✓ · d3 · endings (outro has static; animate next).
21. **Divider grow** — `\p` line scales from center. ASS✓ · d2 · Editorial/Corporate.

### B5. Transitions & camera (within our seams only)
22. **Living camera push** — zoompan on stills / `\move` parallax on text vs bg. ASS✓ FF✓ · d2 · endings/holds (outro).
23. **Defocus-continuation backdrop** — last frame blurred behind text. FF✓ · d2 · Final Scene (done).
24. **Fade-through-black micro-dissolve** — into a beat/ending. FF✓/ASS✓ · d1 · endings (done). *(Scene↔scene transitions = FROZEN stitching, excluded.)*

### B6. Text & attention choreography
25. **Singular motion** — only one element animates at a time (support settled). ASS✓ · d2 · ALL (A1 rule).
26. **Follow-through** — focal word lands after support. ASS✓ · d2 · done partial.
27. **Hold / stillness reset** — a beat with no entrance. ASS✓ · d1 · done.
28. **Pattern interrupt** — every 2–3 beats change layout/size/motion. engine · d2 · ALL.
29. **Reading-rhythm cadence** — vary chunk length + duration to a beat grid. engine · d3 · ALL.

### B7. Per-genre motion signatures (→ OttoFlow styles, not brands)
30. **Premium/Luxury** — slow, sparse, mask wipes, light sweeps, huge whitespace, one accent. · Premium/Signature.
31. **Impact/Viral** — fast, big uppercase, scale-pops, count-ups, high density. · Impact/Pulse.
32. **Editorial** — asymmetric `\pos`, kicker+headline, serif-mono contrast, dividers. · Editorial.
33. **Broadcast/News** — lower-third bars, 3D flip-ins, tickers, drawn cards. · Broadcast.
34. **Cinematic/Documentary** — restrained, blur-ins, corner micros, letterbox calm. · Cinematic/Documentary.
35. **Sports/Dynamic** — count-ups, slides, aggressive stagger, motion smear (`\fax`). · Dynamic/Momentum.

### B8. CTA & endings
36. **Emerge-from-scene CTA** — CTA rises inside the final shot (not a card). ASS/FF · d3 · done (Final Scene).
37. **Draw-on underline commit** (B4-18) at CTA. · d3 · **HIGH (endings).**
38. **Quiet brand signature** — logo/name settles last, calm. FF overlay · d3 · ALL endings.
39. **Light-motivated reveal** — glow blooms then CTA appears. FF✓ · d3 · Premium endings.

---

## PART C — OPEN-SOURCE LANDSCAPE (learn principles, do NOT integrate)

| Project | What it is | What we LEARN (never adopt — frozen renderer) |
|---|---|---|
| **libass** (our renderer) | ASS/SSA renderer inside FFmpeg `ass=` | the full tag set in Part A — our actual toolbox |
| **JASSUB / SubtitlesOctopus** | libass compiled to WASM (browser) | proof libass renders complex MG ASS; a future *browser preview* idea, not a renderer change |
| **Aegisub + KFX / NyuFX / karaoke templates** | pro ASS effect authoring (fansub) | that ASS alone produces broadcast-grade motion; template *patterns* for per-word/per-char effects |
| **Remotion / Motion Canvas** | React/TS programmatic video | *authoring model* (declarative scenes, easing, sequencing) — inspiration for our engine's IR, not a renderer |
| **Lottie / Rive** | vector animation runtimes | keyframe/easing vocabulary; state-driven styles → our data-driven StyleFamily idea |
| **GSAP / Motion One / Framer Motion** | web animation easing/orchestration | easing curves, stagger, spring, timeline orchestration → our motion engine's timing model |
| **AE preset / MOGRT collections** | motion-graphics templates | the *catalogue of techniques* above; the "template = config" model → our styles-as-config |

**Takeaway:** every capability these show for 2D commercial typography maps back to
an ASS/libass tag we can emit. We adopt *ideas* (declarative IR, easing vocab,
template-as-config), never code or renderers.

---

## PART D — RECOMMENDED IMPLEMENTATION ROADMAP

The Motion Graphics Engine = the V5 engine emitting the Part-A tags we've ignored.
Ordered by "not-a-subtitle impact per risk", each Modern-opt-in, fail-safe→Legacy,
RF-validated, no renderer change.

1. **Composition Engine (`\pos`)** — biggest leap: place beats deliberately
   (single-word hero, stacked kicker, lower-third, offset) instead of dead-centre.
   Kills the #1 "subtitle" tell. (B3 · #12,13,15) — *start here.*
2. **Kinetic entrances (`\move`)** — words slide/rise/settle into their `\pos` from a
   direction, not just scale-fade. (B1 · #5,1)
3. **Mask-wipe reveals (animated `\clip`)** — the signature MG reveal + draw-on
   underline via a `\p` bar. (B1-3, B4-18) 
4. **Vector elements (`\p`)** — drawn underlines, lower-third bars, metric cards,
   dividers, light-sweep rects. Turns text into *composition*. (B2-11, B4)
5. **Attention choreography** — enforce singular-motion + pattern-interrupt + rhythm
   across beats (engine-level scheduler). (B6)
6. **Final Scene motion** — animate glow bloom + draw-on underline + logo reveal +
   light-motivated CTA. (B8)
7. **Per-genre motion signatures** — encode #30–35 as OttoFlow StyleFamily data
   (Premium/Impact/Editorial/Broadcast/Cinematic/Dynamic/…). Styles = config.
8. **3D / advanced accents (`\frx/y/z`, `\fax`)** — sparingly for Broadcast/Dynamic.
9. **Presentation QA** — advisory scorer over the 17-category card.

**First build when approved:** #1 Composition Engine (`\pos` layouts) — it converts
the current centered subtitle into placed motion-graphics typography, is fully
deterministic, and is exactly what the last RF render proved we need. Validate with
one RF render + re-score; iterate; then #2/#3 layer kinetic motion + mask reveals on
top of real placement.

**Why this finally clears the bar:** the last render looked like subtitles because
every beat was the same size, centered, and only scaled/faded. `\pos` composition +
`\move` kinetic entrances + `\clip` mask reveals + `\p` drawn elements are precisely
the four things that make text read as *designed motion graphics* — all native to the
renderer we already ship. No new engine. No frozen-system risk.

---

## Sources
- libass tags/extensions: [libass wiki — ASSv5 Override Tags](https://github.com/libass/libass/wiki/ASSv5-Override-Tags), [libass — Extensions/Differences from VSFilter (#401)](https://github.com/libass/libass/issues/401), [Aegisub — ASS Override Tags](https://aegisub.org/docs/latest/ass_tags/)
- Advanced ASS typesetting (masks/gradients/motion, fansub practice): [Fansubbing Guide — Typesetting/FAQ](https://fansubbers.miraheze.org/wiki/Guide:Typesetting/Frequently_asked_questions), [unanimated — Typesetting in Aegisub](https://unanimated.github.io/ts/index.htm), [Aegisub — Typesetting Introduction](https://aegisub.org/docs/latest/typesetting/)
- FFmpeg text animation: [Brayden Blackwell — FFmpeg drawtext animations](https://www.braydenblackwell.com/blog/ffmpeg-text-rendering), [OTTVerse — drawtext dynamic overlays](https://ottverse.com/ffmpeg-drawtext-filter-dynamic-overlays-timecode-scrolling-text-credits/)
- Design principles (not re-run here): [05](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md) · [06](06_CREATIVE_DIRECTION_BIBLE.md) · [07](07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE.md)
