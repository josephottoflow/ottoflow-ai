# OttoFlow Presentation Engine — Creative Direction Bible

**Status:** PERMANENT design bible. Research + deterministic rules. **No code here.**
Supersedes ad-hoc styling decisions; governs all future Presentation-Engine work.
Constraints unchanged: inside the existing Presentation Engine + FFmpeg/libass only;
Legacy byte-identical; Modern opt-in; no new workers/providers/LLMs/render engine.

**Companion research:** [01_RESEARCH](01_RESEARCH.md) · [03_STYLE_GUIDE_V2](03_STYLE_GUIDE_V2.md) · [05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md)

> **Honesty note on the "reference library" (Part II).** I did not stream 240
> specific videos. What follows is a catalogue of **recurring PATTERN ARCHETYPES**
> synthesised from (a) the cited attention/typography/motion research and (b) the
> publicly known house styles of the named brands. Each entry is expressed as a
> *deterministic principle we can encode*, never a look to copy. That is the useful,
> honest form of the deliverable the brief asks for.

---

# PART 0 — THE ONE LAW

Everything in this bible serves a single law:

> **THE ATTENTION CONTRACT — at every instant, the frame must answer "where do I
> look?" with exactly ONE answer.**

Amateur video breaks this by offering many answers at once (three animating things,
every word coloured, text competing with busy footage) so the eye thrashes and the
viewer disengages. Premium video is the disciplined enforcement of a single focal
point that **moves on purpose** from beat to beat. Retention is the by-product of a
viewer who never has to work out where to look.

Three corollaries (each is a hard rule below):
- **ONE thing moves at a time.** Motion contrast is the strongest gaze magnet; if
  everything moves, nothing is salient. *(saliency research)*
- **ONE idea per beat.** Apple's "one idea per slide". Split sequential ideas into
  beats; never cram. 
- **ONE emphasis per beat.** A single focal word/element. Silence (clean, still) is
  a legitimate and premium state.

---

# PART I — THE EIGHT SYSTEMS

Each system: principle → **deterministic rules** → **engine seam** (where it lives)
→ current state.

## 1. ATTENTION SYSTEM (the spine)

**Principle.** Direct the eye; never make the viewer choose. Salience = feature
contrast (luminance, colour, motion, edge) + centrality + faces/gaze. We control
luminance (scrim/outline), colour (accent), and **motion** (the biggest lever).

**Deterministic rules**
- **A1 — Singular motion.** At any instant, exactly one element may be *actively
  animating*. While a word springs in, everything already on screen is **still**.
  While text holds, only the background may drift (parallax) — slow enough to not
  compete. Never two competing animations.
- **A2 — One focal point per beat.** The hero word / the accent word / the stat —
  one. Everything else is support (dimmer, smaller, still).
- **A3 — Contrast makes the focal point.** The focal element must win on ≥2 of:
  luminance (brighter / better scrim), colour (accent vs white), size (≥1.25×),
  motion (it's the thing moving). Support loses on all.
- **A4 — Attention reset via pattern interrupt.** Every 2–3 beats, change *something*
  structurally (chunk length, size role, a still beat, a colour moment) so the
  viewer re-engages. Identical treatment every caption = the "mechanical" tell.
- **A5 — Deliberate stillness.** Some beats must **not** move at all (hold). Stillness
  after motion is a reset and makes the next motion salient. "When nothing moves, the
  next thing that moves owns the frame."
- **A6 — Respect the reading path.** Eyes enter top-left-ish and settle centre; a
  reveal should flow L→R / top→down, never scatter.

**Engine seam.** A new *Attention/Choreography* concern layered over the existing
passes (motion-planning pass + the ass-captions render loop): it decides, per beat,
which single element is "hot", suppresses competing motion, and schedules resets.
**Current state:** partial — stagger + one-emphasis exist, but *every* beat animates
identically (violates A4/A5) and support words also animate while the keyword does
(soft A1 violation). This is the next big design win.

## 2. TYPOGRAPHY SYSTEM

**Principle.** Type is hierarchy made visible. Obvious contrast + optical spacing +
whitespace = "designed"; uniform size/weight centered = "subtitle".

**Deterministic rules** (base = caption size at the current preset)
- **TY1 — Roles & scale (modular, ≥1.5× between adjacent):** `micro 0.72 · caption
  1.0 · headline 1.5 · hero 2.0` (overflow-clamped). Contrast must be *obvious*.
- **TY2 — Tracking as f(size)** (Apple optical): `micro/caption +tracking (loose,
  legible)`, `headline ~0`, `hero/display negative (tight, ‑2…‑5 px @ hero)`.
- **TY3 — Leading by role:** multi-line reads ≥1.4× font; **stacked hero ~1.05–1.15×**
  so a 2-line hero reads as ONE unit.
- **TY4 — Weight contrast:** support = Regular/Medium, focal = Bold/Heavy. Uniform
  bold is the #1 subtitle tell. *(needs worker fonts → RF-validate)*
- **TY5 — Whitespace is active:** ≤2 lines; short beats sit in air; never stretch to
  fill the safe box.
- **TY6 — One type family per video** (preset font); mono only for numeric/technical
  proof cues.
- **TY7 — Optical centering / balance:** trailing punctuation and single-letter
  widows shouldn't unbalance a centered line (trim/rebalance deterministically).

**Engine seam:** `typography.ts` roles + `passes.ts` typographyLayoutPass +
ass-captions header/`\fs`/`\fsp`. **Current:** hero 1.44/headline 1.24 (headline <
1.5×), fixed hero tracking only, no per-role leading, **no weight contrast**.

## 3. MOTION SYSTEM

**Principle.** Motion is physics + restraint. Expensive motion = ease-out + overshoot
+ follow-through + parallax + *singular* focus, not more animation.

**Deterministic rules**
- **MO1 — Ease-out entrances** (accel <1). *(done)*
- **MO2 — Overshoot & settle** (past target ~105–110%, relax). *(done)*
- **MO3 — Follow-through / overlapping action:** elements settle at *different* times
  — support first, focal lands last (a held beat). Extend to the *line's last word*.
- **MO4 — Stagger** 40–60 ms/word, flowing L→R. *(done)*
- **MO5 — Parallax depth:** planes move at different speeds (bg push vs steady text).
  *(done in outro)* The only motion allowed *during a hold*.
- **MO6 — Focus resolve** (blur→sharp) as a rare accent, ≤1 element/beat. *(done)*
- **MO7 — Timing budget:** micro-entrance 200–400 ms; feature beats 600–1200 ms; the
  **hook resolves fastest** (first 2 s = ~70% of retention).
- **MO8 — Motion economy (ties to A1):** total simultaneously-moving elements ≤1
  (foreground). Background parallax is exempt because it's sub-salient (slow, low
  contrast).
- **MO9 — Exits** quick-fade/settle, never a hard cut.

**Engine seam:** ass-captions `\t`/`\fad`/`\blur`/`\move` + outro ffmpeg builders.
**Current:** MO1/2/4/5/6 done; MO3 partial; MO7/MO8 not yet (uniform timing; support
animates alongside focal).

## 4. EMPHASIS SYSTEM (prosody, not lexicon)

**Principle.** Emphasise the word a person would *say louder* — the word carrying
new/contrastive information — then present it once, decisively.

**Deterministic rules** (priority order = the selection algorithm)
- **EM1 — Never emphasise function words** (articles, prepositions, pronouns, conj.,
  aux.). *(done: STOP_WORDS)*
- **EM2 — Selection priority:** `intent-lexicon (number>pain>transformation>emotion>
  power-verb)` → `contrastive-focus (word after but/instead/without/until/not)` →
  **`new-information / END-FOCUS (last content word of the thought group)`**. Only if
  the line is all function words → emphasise nothing.
- **EM3 — Replace "longest word" with END-FOCUS.** This is the single biggest
  "stop-feeling-like-a-parser" change. *(not done — P1)*
- **EM4 — At most ONE emphasis per beat.** *(done)*
- **EM5 — Channel varies (never all at once):** hero → **size only** (no colour);
  mid-read payload → **colour + scale**; number/proof → **mono + colour**; ordinary
  → **nothing**. *(V3 "big or coloured" is the start)*
- **EM6 — Restraint budget:** ≤1 coloured moment per ~5 s of runtime; if two adjacent
  beats both qualify, demote one to size-only. Prevents "every line coloured".

**Engine seam:** `lexicon.ts` + `grouping.ts selectKeyword` + `passes.ts
keywordSelectionPass`. **Current:** lexicon+contrast+one-per-beat done; **end-focus
default missing**; restraint budget across beats missing.

## 5. READING RHYTHM SYSTEM

**Principle.** Text must be readable without effort and must *breathe* — a cadence,
not a metronome.

**Deterministic rules**
- **RR1 — Chunk length is role-aware:** hook ≤2 words (punch), reads ≤3, never >3 on
  a Modern line. Fewer words → bigger type → less subtitle.
- **RR2 — Reading-speed floor:** never show a cue faster than ~200 WPM / 0.3 s per
  word; min cue ~1 s. (Advisory QA can flag.)
- **RR3 — Rhythm variation (pattern interrupt):** alternate chunk lengths across beats
  (1 → 3 → 2 …) so cadence isn't monotone; a one-word beat is a natural accent.
- **RR4 — RSVP for hooks:** a single big word flashed centre reduces eye travel and
  maximises the 2 s hook.
- **RR5 — Gap discipline:** 0–200 ms between cues; no dead air, no overlap onto the
  next beat or the outro.

**Engine seam:** `grouping.ts` (role-aware max-words) + caption timing/clamp in
`ffmpeg.ts`. **Current:** flat maxWords=3; no role-aware chunking; timing tracks VO.

## 6. STORY RHYTHM SYSTEM (presentation layer only — story pipeline stays FROZEN)

**Principle.** A commercial has an emotional shape: Hook → Tension → Turn → Proof →
Resolution → CTA. Presentation *reinforces* each beat's role; it never rewrites the
script (agents 01–10 are frozen).

**Deterministic rules** (map the beat's narrative role → presentation treatment)
- **SR1 — Hook (first ~2 s):** biggest type, fastest reveal, often a question/pain;
  RSVP if ≤2 words. Owns the retention window.
- **SR2 — Tension/problem:** pain-word emphasis; cooler/dimmer treatment; tighter.
- **SR3 — Turn (the "but"):** contrastive-focus emphasis; a pattern interrupt (size
  jump or a still beat then motion) marks the pivot.
- **SR4 — Proof/benefit:** numbers as mono stats; transformation words accented.
- **SR5 — Resolution → CTA handoff:** energy settles, whitespace opens, leading into
  the Final Shot.
- **SR6 — Emotional pacing curve:** intensity rises to the turn, peaks at proof,
  resolves at CTA — mirrored by size/motion energy, not just words.

**Engine seam:** a per-beat *narrative-role* signal (derivable deterministically from
position + lexicon: first beat=hook, contrast-pivot beat=turn, numeric beat=proof,
last beat before outro=resolution) feeding typography/emphasis/motion choices.
**Current:** only "first beat = hero" exists; the fuller role map is a design
opportunity (still deterministic, no LLM).

## 7. CTA SYSTEM

**Principle.** The CTA is the emotional *resolution*, not a banner. It must feel
earned and inevitable, emerging from the story.

**Deterministic rules**
- **CT1 — Single ask:** one verb, one outcome. ("Start free." not a paragraph.)
- **CT2 — Verb is the focal word** (power-verb emphasis), but via size/weight more
  than colour at the ending (calm confidence > loud).
- **CT3 — Emerge, don't cut:** the CTA rises out of the Final Shot (see §8), motivated
  by light, not slapped on a card.
- **CT4 — Brand is the quietest beat:** the logo/name settles last, low energy =
  confidence (a sting that shouts reads cheap).
- **CT5 — Timing:** CTA legible ≥1.5 s before end; hold the finished frame ≥0.8 s.

**Engine seam:** `branding.ts` layers + outro ffmpeg builders. **Current:** CTA rise +
underline + brand exist; treatment is good but underline *fades* (should draw-on) and
logo reveal is absent.

## 8. FINAL SHOT SYSTEM ("the film breathes out")

**Principle.** Not an end screen — the **final shot** of the commercial. The viewer
should never feel it "stopped"; the CTA is the last line of the scene.

**The OttoFlow final-shot beat sheet (3.0–4.0 s)** — our unique language:
1. **Dissolve-in (0–0.4 s):** last scene frame → defocus + desaturate + darken; fade
   from the film (continuity over cut). *(done)*
2. **Living camera (whole):** slow 6–7% push; the world keeps breathing. *(done)*
3. **Light gather (0.3–0.8 s):** a brand-tinted glow **blooms** where the CTA lands —
   motivates the reveal. *(static now → should animate)*
4. **CTA rise (0.55–1.2 s):** promise rises + overshoot-settles; verb is focal. *(done)*
5. **Underline draw-on (0.95–1.3 s):** accent underline **wipes L→R** — the OttoFlow
   "commit" gesture. *(fades now → upgrade to wipe)*
6. **Brand signature (1.3–1.7 s):** name/logo settles last, calm. *(name done; logo
   reveal missing)*
7. **Living hold (→ end):** all still, light steady, footage gently pushing.

**What makes it OURS (not Apple/Nike):** continuity-over-cut (grown from the film's
own last frame) · light-motivated reveal · draw-on underline gesture · the *quietest*
brand beat. **Engine seam:** `renderCtaCardLayers` + `buildCinematicOutroClipArgv`.

---

# PART II — REFERENCE PATTERN LIBRARY (archetypes → rules)

Compact catalogue. Each: **pattern** — why it works / attention effect — **rule we
encode**. Grouped to cover the brief's categories.

## A. Caption / typography-layout patterns (premium reads)
1. **Single-word punch** (Nike/Apple hero). One giant word, centred, still, held.
   → *Attention: zero competition.* Rule: ≤2-word hook → hero 2.0× + RSVP + hold.
2. **Kicker + headline stack** (editorial). Small word above a big word. → *hierarchy
   in one glance.* Rule: role stack micro-over-hero, tight leading (TY3).
3. **Two-tone line** (Stripe/Linear). Mostly one weight/colour, ONE accent word.
   → *single focal point.* Rule: EM4/EM5 colour one payload word only.
4. **All-caps label + sentence** (fashion/luxury). Wide-tracked small caps as a label.
   → *rhythm contrast.* Rule: micro role = uppercase + positive tracking.
5. **Number-forward stat** (SaaS proof). The figure dominates, unit smaller. → *the
   eye locks on the number.* Rule: numeric → mono + accent + scale (done).
6. **Clean statement, no accent** (Apple). Plain white, perfect spacing, still.
   → *confidence via restraint.* Rule: ordinary line → emphasise nothing (EM2 tail).
7. **Lower-third anchor vs dead-centre.** Intentional placement reads designed.
   → Rule: candidate placement band (RF-gated, C3).
8. **Tight 2-line unit** (poster). Two short lines, near-solid leading, as one block.
   → Rule: stacked hero leading ~1.1× (TY3).

## B. Text-animation / kinetic styles
9. **Fade-rise** (baseline premium): opacity + small up-move, ease-out. Rule: entrance
   default. 10. **Overshoot pop** (spring): scale past→settle. *(done)* 11. **Focus
   resolve** (rack focus): blur→sharp on the focal word. *(done)* 12. **Mask/clip
   wipe** (cinematic): text revealed behind a moving edge. Rule: reserve for the
   underline draw-on + optional hero reveal (`\clip` animated). 13. **Word-by-word
   RSVP** (Apple recap): same position, sequential words. Rule: hook option. 14.
   **Trailing follow-through:** last word settles last. Rule: MO3. 15. **Counter-move
   settle** (anticipation): tiny dip before rise. Rule: subtle, focal only. 16.
   **Karaoke fill** (spoken sync): colour follows VO. *(done — corporate)*.

## C. Attention patterns (eye choreography)
17. **Singular motion** — one thing moves. Rule A1. 18. **Hold/stillness reset** —
freeze to reset, then move. Rule A5. 19. **Pattern interrupt** every 2–3 beats
(size/length/colour/stillness change). Rule A4. 20. **Bright-in-dark focal** — scrim
darkens field, text is the bright spot. Rule: outro scrim + caption outline. 21.
**Motion-direction contrast** — focal moves as support holds. Rule A1+MO8. 22.
**Centre bias for the hook**, drift to rhythm later. 23. **Parallax depth** during
holds (only sub-salient bg moves). Rule MO5/MO8. 24. **Colour as a rare spike** — one
accent moment draws the eye precisely once. Rule EM6.

## D. CTA endings & cinematic final shots
25. **Emerge-from-scene CTA** (the film continues). Rule §8. 26. **Light-motivated
reveal** — glow blooms, then text. Rule step 3. 27. **Draw-on underline "commit"**.
Rule step 5. 28. **Quiet brand signature** — logo is the calmest beat. Rule CT4. 29.
**Living hold** — never a frozen card; bg keeps breathing. Rule step 7. 30.
**Defocus-continuation backdrop** — last frame blurred. *(done)*. 31. **Fade-through-
black micro-dissolve** into the final shot. *(done)*. 32. **Logo lockup settle** (when
a real asset exists) — scale+fade to rest, no spin/particles. Rule: calm reveal only.

## E. Kinetic / motion SYSTEMS (whole-video coherence)
33. **One easing family** across the whole video (ease-out-expo/quint) = coherence.
Rule: single accel constant per preset. 34. **One motion vocabulary** (fade-rise +
overshoot + focus-pull) reused — consistency reads as "a system". 35. **Energy
curve** — motion amplitude rises to the turn, peaks at proof, calms at CTA. Rule SR6.
36. **Timing grid** — entrances quantised to a small set (e.g., 220/300/400 ms) not
arbitrary. 37. **Restraint budget** — a fixed max of "loud" moments per video.

---

# PART III — SELF-CRITIQUE & THE HONEST BAR

Would Apple/Linear/Stripe ship the *current* build? **Stills: close. Motion &
attention: not yet.** The remaining gaps are attention-level, not typographic:
- **A1/MO8 violated:** support words animate while the focal word animates → mild
  competition. Fix: focal moves, support already settled (or vice-versa).
- **A4/A5 missing:** every beat animates identically, no holds, no pattern interrupts
  → this is the true source of "still feels mechanical/AI".
- **EM3 missing:** end-focus. The one change that makes emphasis feel spoken.
- **TY4 missing:** weight contrast (RF-gated).
- **Final shot:** glow/underline/logo still card-ish in places.

**Verdict:** we have a strong typographic base; the leap to "edited by a pro" now
comes from the **ATTENTION SYSTEM** (§1) — singular motion, holds, pattern
interrupts, energy curve — more than from more typography.

---

# PART IV — UPDATED IMPLEMENTATION BACKLOG (deterministic, fail-safe, Modern-opt-in)

Ordered by *attention impact per risk*, all locally-validatable unless noted.

1. **P1 — End-focus emphasis** (EM3): last-content-word default; order lexicon >
   contrast > end-focus. *Highest "human" win.*
2. **P2 — Attention choreography** (A1/MO3/MO8): while the focal word animates,
   support words are already settled; focal lands last (follow-through). Removes
   motion competition.
3. **P3 — Rhythm & pattern interrupts** (A4/A5/RR3): vary chunk length by role
   (hook ≤2), insert *hold* beats (no entrance) on ~1 in 3, so motion elsewhere is
   salient. Snappier hook (MO7).
4. **P4 — Typography depth** (TY1/2/3): headline→1.5×, tracking as f(size), per-role
   leading.
5. **P5 — Final-shot polish** (§8): animate glow bloom + **draw-on underline** wipe +
   logo reveal.
6. **P6 — Emphasis restraint budget** (EM6) + energy curve (SR6) advisory.
7. **RF-GATED:** weight contrast (TY4) + caption placement (C3) + real-footage motion
   feel → validate on ONE Modern-V1 Royalty-Free render (download → frames → critique).
8. **P7 — Advisory QA** (RR2 reading-speed / overflow) — non-blocking, last.

Every item: one logical commit, frame-critiqued, fail-safe → Legacy, no new arch.

---

## Sources
- Visual saliency / what draws the eye: [Springer — Spatio-Temporal Saliency for Gaze](https://link.springer.com/article/10.1007/s11263-009-0215-3), [Nature — Gaze fixations in dynamic scenes](https://www.nature.com/articles/s41598-018-22127-w), [PMC — Feature-contrast attracts attention](https://pmc.ncbi.nlm.nih.gov/articles/PMC6835688/)
- Editing rhythm / pattern interrupt / holds: [Backstage — Film Rhythm Editing](https://www.backstage.com/magazine/article/film-rhythm-editing-guide-77147/), [AIR — Retention editing / pattern-interrupt rehooks](https://air.io/en/youtube-hacks/advanced-retention-editing-cutting-patterns-that-keep-viewers-past-minute-8), [Skillman — Rhythmic Editing](https://www.skillmanvideogroup.com/rhythmic-editing/)
- Apple keynote one-idea/progressive disclosure: [Medium — How we make slides at Apple](https://medium.com/adventures-in-consumer-technology/this-is-how-we-make-slides-at-apple-b8a84352bf6d), [Forbes — Techniques from Apple's WWDC Keynote](https://www.forbes.com/sites/carminegallo/2013/06/11/ten-presentation-techniques-you-can-and-should-copy-from-apples-wwdc-keynote/)
- Prosody / emphasis, typography, motion, retention: see [05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md) source list (SF Pro optical sizing, sentence-stress linguistics, follow-through/overlap/parallax, short-form retention data, kinetic-typography timing).
