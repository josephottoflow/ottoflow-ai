# THE OTTOFLOW PRESENTATION DESIGN BIBLE

**Status:** PERMANENT single source of truth for the OttoFlow Presentation Engine.
Consolidates and supersedes ad-hoc styling; the research derivations live in the
companion appendices [05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md)
and [06_CREATIVE_DIRECTION_BIBLE](06_CREATIVE_DIRECTION_BIBLE.md). **No code in this
document.** Every rule is deterministic (a machine applies it identically each time),
citable, and maps to an existing engine seam.

**Boundaries (unchanged):** inside the existing Presentation Engine + FFmpeg/libass
only. No new workers, providers, LLMs, render engine, or queues. Legacy byte-identical.
Modern opt-in per render, never global. Every change fail-safe → Legacy.

> **Honesty note.** I cannot stream and scrub these commercials frame-by-frame — I
> have no video-ingestion capability. Every "reference breakdown" below is a
> **principle reverse-engineered from published analyses, eye-tracking/attention
> science, and the documented house styles of the named brands** — not a fabricated
> timecode log. Where I give numbers, they come from cited research, not from me
> claiming to have measured a specific frame. This is the honest, useful form of the
> deliverable.

---

## THE ONE LAW

> **THE ATTENTION CONTRACT — at every instant the frame answers "where do I look?"
> with exactly ONE answer, and that answer moves on purpose from beat to beat.**

Premium ≠ more design. Premium = the disciplined enforcement of a single, directed
focal point, so the viewer never works to find it. Everything else is machinery for
that. Corollaries (hard rules): **one thing moves · one idea per beat · one emphasis
per beat · silence is allowed.**

---

## PART A — FOUNDATIONAL SCIENCE (the numbers everything derives from)

| Fact | Value | Source | Consequence for us |
|---|---|---|---|
| Reading fixation | 200–250 ms median | eye-tracking | A word must be on screen ≥250 ms to be *read*; word reveals ≤ that feel subliminal/cheap |
| Saccade | 20–35 ms | eye-tracking | Eye "jumps" are near-instant; layout should minimise jumps (short lines, one column) |
| Perceptual span | 3–4 chars left, 14–15 right (~18/fixation) | reading science | A "punch" line ≤ ~18 chars reads in ONE fixation → maximal impact |
| Silent reading speed | 200–300 WPM (≈238) | reading science | On-screen ceiling ~200 WPM → **≥0.30 s per word** display floor |
| Foveal clarity | ~2° visual angle | vision science | Only the focal element is sharp; everything else is peripheral → justify ONE focus |
| Gaze magnets | motion > luminance/colour/edge contrast > faces/gaze | saliency research | **Motion is the strongest lever we own** → ration it (one mover) |
| First 2 seconds | decide ~70% of retention | retention data | Hook must resolve <1 s and open a loop |
| Pain-point question hook | +23% retention | retention data | Presentation must not slow the hook |
| Fast pacing | +34% retention (TikTok) | retention data | Brisk cadence; short cues |
| Completion benchmark | TikTok ~78% · Shorts ~73% · Reels ~65% · viral ~76% | retention data | The bar we design toward |
| Open loop (Zeigarnik) | unresolved → dopamine, sustained attention | psychology | Hook OPENS a curiosity gap; CTA CLOSES it |
| Contrast (legibility) | ≥4.5:1 text/background | WCAG | Outline+shadow+scrim must guarantee this over any footage |

---

## PART B — THE SYSTEMS

Each: principle → **deterministic rules** → engine seam → state (`✓ done` / `◑ partial` / `✗ todo`).

### B1. ATTENTION SYSTEM *(the spine)*
Direct the eye; never make the viewer choose.
- **A1 Singular motion** — at any instant exactly ONE foreground element animates;
  everything already on screen is still. Background parallax (slow, low-contrast) is
  the only concurrent motion. `✗` (support words currently animate with the focal word)
- **A2 One focal point/beat** — hero word *or* accent word *or* stat, never several. `◑`
- **A3 Focal wins on ≥2 of** {luminance, colour, size ≥1.25×, being-the-mover}. `◑`
- **A4 Pattern interrupt every 2–3 beats** — change chunk length / size role / colour /
  stillness so attention re-engages. `✗`
- **A5 Deliberate stillness** — ~1 in 3 beats is a HOLD (no entrance); stillness makes
  the next motion salient. `✗`
- **A6 Reading path** — reveals flow L→R / top→down, never scatter. `✓`
- *Seam:* motion-planning pass + ass-captions render loop (a new choreography layer).

### B2. TYPOGRAPHY SYSTEM
Type is hierarchy made visible.
- **TY1 Roles/scale** (of caption base): micro 0.72× · caption 1.0× · headline 1.5× ·
  hero 2.0×; **≥1.5× between adjacent focal levels**. `◑` (headline is 1.24×, hero 1.44×)
- **TY2 Tracking = f(size)**: micro/small +2…+4% · caption ~0 · headline −1…−2% ·
  hero −2…−5% (Apple optical: <20pt looser, ≥20pt tighter). `◑` (fixed hero only)
- **TY3 Leading by role**: reads ≥1.4× · stacked hero 1.05–1.15× (reads as one unit). `✗`
- **TY4 Weight contrast**: support Regular/Medium, focal Bold/Heavy. #1 subtitle tell. `✗` *(RF-gated: worker fonts)*
- **TY5 Whitespace active**: ≤2 lines; short beats sit in air; never fill the box. `◑`
- **TY6 One family/video** (preset); mono only for numeric proof. `✓`
- **TY7 Optical balance**: no single-letter widow, trailing-punctuation imbalance. `✗`
- *Seam:* typography.ts + typographyLayoutPass + ass header/`\fs`/`\fsp`.

### B3. MOTION SYSTEM
Physics + restraint; expensive = refinement, not quantity.
- **MO1 ease-out** (accel 0.4–0.6) `✓` · **MO2 overshoot** +5…+10% settle 80–100 ms `✓`
- **MO3 follow-through** — support settles first, focal + line's last word land last `◑`
- **MO4 stagger** 40–60 ms/word L→R `✓` · **MO5 parallax** (bg push ≤7%/beat; only motion during a hold) `✓`
- **MO6 focus-resolve** blur 4–8px→sharp, ≤1 element/beat `✓`
- **MO7 timing budget** micro 200–400 ms; feature 600–1200 ms; **hook fastest (≤~300 ms, lands <1 s)** `✗`
- **MO8 motion economy** ≤1 foreground mover (ties A1) `✗` · **MO9 exit** fade 100–200 ms, never hard cut `✓`
- *Seam:* ass-captions `\t`/`\fad`/`\blur` + outro ffmpeg builders.

### B4. READING SYSTEM
Effortless legibility + a cadence, not a metronome.
- **RD1 Words on screen ≤5** (≤2 lines × ≤3); punch 1–2. `◑`
- **RD2 Line ≤18 chars for punch, ≤~28 for reads** (foveal span). `✗` (only width-px guard)
- **RD3 Display floor ≥0.30 s/word; cue 1–3 s; min 1 s.** `◑` (VO-timed)
- **RD4 Chunk length role-aware**: hook ≤2, read ≤3. `✗`
- **RD5 Cadence variation** (1→3→2 words) as pattern interrupt. `✗`
- **RD6 Gaps 0–200 ms**, no overlap onto next beat/outro. `✓`
- *Seam:* grouping.ts + caption clamp in ffmpeg.ts.

### B5. EMPHASIS SYSTEM *(prosody, not lexicon)*
Emphasise the word a person would *say louder*.
- **EM1** never function words `✓`
- **EM2 selection priority**: intent-lexicon (number>pain>transformation>emotion>power)
  → contrastive-focus (after but/instead/without/until/not) → **new-info/END-FOCUS
  (last content word)** → else nothing. `◑` (end-focus missing)
- **EM3 replace "longest word" with END-FOCUS** — the key "stop-feeling-like-a-parser" fix. `✗`
- **EM4 ≤1 emphasis/beat** `✓` · **EM5 channel varies** (hero=size · payload=colour+scale ·
  number=mono+colour · ordinary=none) `◑`
- **EM6 restraint budget** ≤1 coloured moment / ~5 s; demote adjacent qualifiers to size. `✗`
- *Seam:* lexicon.ts + grouping.ts selectKeyword + keywordSelectionPass.

### B6. STORYTELLING SYSTEM *(presentation reinforces; story agents 01–10 FROZEN)*
Map each beat's narrative role → presentation treatment (role derived deterministically
from position + lexicon; no LLM).
- **ST1 Hook** (beat 0): biggest, fastest, opens a loop. `◑`
- **ST2 Tension**: pain emphasis, cooler/tighter. `✗`
- **ST3 Turn** (contrast pivot beat): contrastive emphasis + a pattern interrupt marks the pivot. `✗`
- **ST4 Proof** (numeric beat): mono stat, peak energy. `◑`
- **ST5 Resolution→CTA**: energy settles, whitespace opens. `✗`
- **ST6 Energy curve**: size/motion amplitude rises to Turn, peaks at Proof, calms at CTA. `✗`
- *Seam:* a per-beat narrative-role signal feeding B2/B3/B5.

### B7. COMMERCIAL EDITING SYSTEM
Borrow the editor's craft of rhythm.
- **CE1 Cut/reveal on the beat** — text lands with VO stress / scene change, not between. `◑`
- **CE2 Hold before payoff** — a beat of stillness before the CTA/turn builds anticipation. `✗`
- **CE3 Pace to energy** — faster reveals in tension, slower/held at resolution. `✗`
- **CE4 No dead air, no clutter** — one idea per beat (Apple); split sequential ideas. `◑`
- **CE5 Match cut of attention** — the focal point of beat N sits near where beat N+1's
  focal point appears (minimise eye travel between beats). `✗`
- *Seam:* caption timing + choreography layer.

### B8. EYE-TRACKING SYSTEM *(quantified legibility)*
- **ET1** word on screen ≥250 ms to be read (fixation). `◑`
- **ET2** punch line ≤18 chars = one fixation. `✗`
- **ET3** minimise saccades: one centred column, ≤2 lines, consistent anchor. `✓`
- **ET4** focal element in foveal centre; support peripheral. `◑`
- *Seam:* grouping + layout + placement.

### B9. VIEWER PSYCHOLOGY & B10. RETENTION SYSTEM
- **VP1 Open loop at the hook** (question / pain / incomplete idea) → Zeigarnik tension. `◑` (story-driven)
- **VP2 Micro-curiosity every few beats** — a reveal that implies more. `✗`
- **VP3 Close the loop at the CTA** — the promise resolves the opening tension. `◑`
- **VP4 Emotional payoff** — the Final Scene delivers the feeling, not just an ask. `◑`
- **RT1 first-2s priority** (hook fastest, biggest). `✗`
- **RT2 pacing brisk** (short cues, pattern interrupts sustain the +34%). `✗`
- **RT3 loopability** — a clean, calm ending invites a rewatch (short-form loops). `✓`
- *Seam:* presentation can't write the loop (frozen story) but MUST present the hook/CTA
  to maximise it — timing + size + not slowing beat 0.

### B11. CTA SYSTEM
The emotional resolution, earned and inevitable.
- **CT1** single ask (one verb, one outcome) `◑` · **CT2** verb focal via size/weight
  (calm > loud at the end) `◑` · **CT3** emerge from the Final Scene, never a card `✓`
- **CT4** brand is the quietest beat (confidence) `✓` · **CT5** CTA legible ≥1.5 s; hold ≥0.8 s `✓`

### B12. FINAL SCENE SYSTEM *("the film breathes out")*
OttoFlow's unique ending. Beat sheet (3.0–4.0 s):
1. Dissolve-in 0–0.4 s (last frame → defocus/desat/darken) `✓`
2. Living camera — 6–7% push throughout `✓`
3. **Light gather 0.3–0.8 s** — brand-tinted glow *blooms* where CTA lands `◑`(static)
4. CTA rise 0.55–1.2 s (overshoot-settle, verb focal) `✓`
5. **Underline draw-on 0.95–1.3 s** — wipe L→R (the OttoFlow "commit" gesture) `✗`(fades)
6. Brand signature 1.3–1.7 s — settles last, calm `◑`(name; no logo reveal)
7. Living hold → end (still, light steady, footage breathing) `✓`
- *Ours, not imitation:* continuity-over-cut · light-motivated reveal · draw-on underline · quiet brand.

---

## PART C — DETERMINISTIC RULES (master quick-reference)

**Typography:** base caption 4.5–5.0 %H · hero up to ~9–10 %H · roles 0.72/1.0/1.5/2.0 ·
≥1.5× adjacent focal contrast · tracking +4%…−5% by size · leading reads ≥1.4× / hero
~1.1× · ≤2 lines · text/bg ≥4.5:1.
**Reading:** ≤5 words on screen · punch ≤2 words ≤18 chars · read ≤3 words ≤~28 chars ·
≥0.30 s/word · cue 1–3 s (min 1 s) · gaps 0–200 ms.
**Emphasis:** ≤1/beat · ≤1 colour / 5 s · lexicon→contrast→end-focus→none · channel by role.
**Motion:** ease-out accel 0.4–0.6 · stagger 40–60 ms · overshoot +5…10% settle 80–100 ms ·
entrance 200–400 ms (hook ≤~300, lands <1 s) · focus-pull blur 4–8px ≤1/beat · ≤1 fg mover ·
bg push ≤7%/beat · exit 100–200 ms · pattern-interrupt every 2–3 beats · ~1/3 beats HOLD.
**Safe areas:** sides 120px (~11%) · top ~220px · bottom ~320px (clear of platform UI ~bottom 20%) ·
caption band ~42–78 %H.
**Retention/story:** hook <1 s + open loop · energy rises→Turn, peaks→Proof, calm→CTA ·
close loop at CTA.
**Final scene:** 3.0–4.0 s · beats per B12 · push 6–7% · backdrop blur ~26 / bright −0.34 / sat 0.78 · hold ≥0.8 s.

---

## PART D — QUALITY CHECKLIST (release gate; any ✗ on a **must** blocks Modern)

**Attention (must):** □ At every instant one clear focal point □ Only one foreground
element animates at a time □ ≥1 hold/still beat present □ a pattern interrupt within
every 3 beats.
**Typography (must):** □ Obvious hierarchy (≥1.5× where roles differ) □ No line clipped /
overflowing safe area □ ≤2 lines, ≤5 words □ Contrast ≥4.5:1 over footage.
**Emphasis (must):** □ ≤1 emphasis per beat □ Emphasised word is the one a human would
stress (end-focus/contrast/intent), never a function word □ Some lines clean (no colour).
**Motion (should):** □ Ease-out + overshoot, no linear pops □ Hook resolves fastest □
Exits fade, never hard cut □ No competing motion.
**Reading (must):** □ Every cue readable ≥0.30 s/word □ No cue <1 s.
**Story/CTA (should):** □ Hook opens a loop in <1 s □ Energy curve present □ CTA emerges
from the Final Scene □ Brand is the calmest beat.
**Final Scene (must):** □ Grows from the film (no hard cut to a card) □ Nothing static-
card-like □ CTA legible ≥1.5 s + hold ≥0.8 s.
**Gate rule:** any **must** unchecked → do not present as premium; iterate.
**The three questions (ask on every render):** Would Apple ship this? Would Linear ship
this? Would a professional commercial editor approve this? If no → keep improving.

---

## PART E — REFERENCE LIBRARY (reverse-engineered patterns → rules)

Honest archetypes (see honesty note). Format: **pattern** — attention/why — *rule*.

**Openings / hooks:** Single-word punch (Nike) — zero competition, one fixation — *hook
≤2 words, hero 2.0×, RSVP, land <1 s*. · Question-on-pain (SaaS) — opens a Zeigarnik loop
— *present the hook fastest & biggest*. · Hard-cut-in on motion — motion contrast grabs —
*first frame already moving*.
**Reads / body:** Kicker+headline stack (editorial) — hierarchy in one glance — *micro-over-
hero, tight leading*. · Two-tone line (Stripe/Linear) — single accent — *one payload word
coloured*. · Clean statement no accent (Apple) — confidence via restraint — *ordinary line =
no colour*. · Number-forward stat — eye locks the figure — *numeric = mono+accent+scale*.
**Emphasis:** End-focus stress (speech) — matches how it's *said* — *last content word default*.
· Contrast pivot punch — meaning turns on it — *stress word after but/without*. · Size-not-
colour hero — big = loud — *hero emphasises by size only*.
**Motion:** Fade-rise · Overshoot pop · Focus-resolve · Trailing follow-through · Mask/clip
wipe (reserve for underline draw-on) · Word-by-word RSVP (hook) · Karaoke fill (spoken sync).
**Attention:** Singular motion · Hold/stillness reset · Pattern interrupt / 2–3 beats ·
Bright-in-dark focal · Motion-direction contrast · Colour as a rare spike · Match-cut of
attention (focal near next focal).
**Endings / final shots:** Emerge-from-scene CTA · Light-motivated reveal · Draw-on underline
"commit" · Quiet brand signature · Living hold (never frozen) · Defocus-continuation backdrop
· Calm logo lockup (no spin/particles).
**Systems:** One easing family · One motion vocabulary reused · Energy curve · Quantised
timing grid (220/300/400 ms) · Restraint budget (fixed max loud moments/video).

---

## PART F — IMPLEMENTATION MAPPING (rule → seam → status → wave)

| Rule group | Engine seam | Status | Wave |
|---|---|---|---|
| EM2/EM3 end-focus emphasis | grouping.ts / keywordSelectionPass | ✗ | **W1** |
| A1/MO8/MO3 singular motion + follow-through | ass-captions render loop | ✗ | **W2** |
| A4/A5/RD5 holds + pattern interrupts; MO7 hook snappier | render loop + preset flags | ✗ | **W3** |
| RD4 role-aware chunking; TY1 headline→1.5× | grouping.ts / typographyLayoutPass | ✗ | **W3** |
| TY2/TY3 tracking f(size) + leading | ass header / `\fsp` / `\fs` | ◑ | **W4** |
| B12 final-scene: glow bloom + draw-on underline + logo | renderCtaCardLayers / outro builders | ◑ | **W5** |
| ST/CE energy curve + narrative-role treatment | new per-beat role signal | ✗ | **W6** |
| TY4 weight contrast; placement (B1/ET) | presets / header | ✗ | **RF-gated** |
| RD3/RT reading-speed + overflow advisory | presentationQaPass | ✗ | **W7 (last)** |

Every wave: deterministic · Modern-opt-in · fail-safe → Legacy · one logical commit ·
frame-critiqued on local ffmpeg before ship · RF render only where a rule needs real
fonts/footage/motion-in-playback to judge.

---

## PART G — CREATIVE-DIRECTOR RE-CRITIQUE (of this bible)

*Is this production-quality as a design bible?* Strengths: it is now organised around
**attention** (the right spine), every rule is deterministic with a number and a seam,
and it names the honest gaps. Weaknesses I accept and flag:
1. **Real-footage-dependent rules (placement, weight, motion-in-playback) can't be
   finalised on stills** — the bible marks these RF-gated rather than pretending.
2. **Story-role treatment (B6/ST) risks over-reach** — it must stay presentation-only
   (agents 01–10 frozen); the bible constrains it to a *derived* role signal, no LLM.
3. **The reference library is archetypes, not frame logs** — stated openly; it still
   yields deterministic rules, which is what implementation needs.

*Would Apple/Linear/Stripe's teams recognise these principles?* Yes — restraint,
one focal point, optical typography, motion economy, earned endings are exactly their
playbook. The bible is **ready to govern implementation.**

**Recommended first wave when implementation resumes: W1 (end-focus emphasis) + W2
(singular motion / no competing animation)** — the two changes that most directly remove
the "parser" and "mechanical" tells, both fully validatable on local frames.

---

## Sources (this document)
- Eye-tracking / fixation / saccade / span: [PMC — Fixation duration & subtitled video](https://pmc.ncbi.nlm.nih.gov/articles/PMC8012014/), [PLOS One — Viewers keep up with fast subtitles](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0199331), [Ashok Charan — Fixations & Saccades](https://www.ashokcharan.com/Marketing-Analytics/~bm-eye-tracking-fixations-saccades.php)
- Reading speed: [Iris Reading — Average Reading Speed](https://irisreading.com/what-is-the-average-reading-speed/), [WordsRated — Reading Speed Statistics](https://wordsrated.com/reading-speed-statistics/)
- Commercial pacing / shot length: [Moonb — Average commercial length 2026](https://www.moonb.io/blog/how-long-is-the-average-commercial), [PremiumBeat — Cutting 15/30/60s spots](https://www.premiumbeat.com/blog/cutting-commercials-editing-15-30-and-60-second-spots/)
- Retention psychology (Zeigarnik / curiosity gap): [BetterVideoContent — Zeigarnik & retention](https://bettervideocontent.com/what-is-the-zeigarnik-effect-how-to-hack-video-retention/), [PodIntelligence — Zeigarnik storytelling](https://www.podintelligence.com/blog/zeigarnik-effect-for-engaging-storytelling/)
- Foundational appendices (typography, prosody, motion, attention, retention, editing, Apple keynote): see [05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md) and [06_CREATIVE_DIRECTION_BIBLE](06_CREATIVE_DIRECTION_BIBLE.md) source lists.
