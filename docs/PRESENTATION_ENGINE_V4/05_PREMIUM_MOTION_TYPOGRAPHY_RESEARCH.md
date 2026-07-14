# Presentation Engine V4 — Premium Motion & Typography Research

**Status:** Research + deterministic-rule extraction. **No code in this document.**
Governs the next implementation waves (Emphasis V4, Kinetic V4, End Screen language).
Constraints unchanged: inside the existing Presentation Engine + FFmpeg/libass only;
Legacy byte-identical; Modern opt-in; no new workers/providers/LLMs/render engine.

> Method: extract **deterministic** rules (a machine can apply them the same way
> every time) from how premium brands and motion designers actually work — never
> copy a look, encode the *why*. Each rule cites a source, names the **engine seam**
> that would apply it, and states the **current gap**.

---

## 0. Thesis — why premium video feels premium (and ours still doesn't)

Six root causes separate "a template" from "edited by an agency". None is an
engineering problem; all are **design decisions** we can encode deterministically.

1. **Restraint.** Premium work emphasises *rarely* and *decisively*. Amateur work
   decorates everything (every line coloured, every word animated) → the eye finds
   no focal point. *Fix: sparse, one-focal-moment emphasis (mostly done in V2/V3).*
2. **Contrast that is obvious, not timid.** Real hierarchy is ≥1.5× size steps and
   weight contrast, not a few percent. Subtitles are all one size/weight → "flat". 
3. **Emphasis that matches how a human *says* the line** (prosody), not a lexicon
   guess. Humans stress the word carrying *new / contrastive* information. *This is
   our weakest area and the biggest remaining win.*
4. **Motion physics.** Overshoot, follow-through/overlapping action, parallax depth,
   staggered offsets — the "expensive" cues. Linear moves read as "generated".
5. **Composition & whitespace.** Intentional placement, generous negative space, a
   deliberate reading rhythm — not text parked dead-centre like a caption track.
6. **An ending that concludes the story**, where the CTA *emerges from* the final
   scene rather than a card cutting in.

---

## 1. Typography — scale, hierarchy, tracking, leading

**Sources:** editorial-design hierarchy guides; Apple SF Pro optical-size system
(SF Text <20pt looser / SF Display ≥20pt tighter); type-scale/modular-scale refs.

### Deterministic rules
- **T1 — Modular scale, real steps.** Adjacent hierarchy levels need **≥1.5× size
  contrast** to read as distinct. Use one ratio family (Major Third 1.25 → Perfect
  Fourth 1.333 → Perfect Fifth 1.5). *Roles:* micro 0.72 · caption 1.0 · headline
  1.5 · hero 2.0 of the caption base (clamped by overflow).
- **T2 — Tracking is a function of size (optical sizing).** Small text → *looser*
  (+); large display → *tighter* (−). Concrete boundary from Apple: the Text→Display
  break is ~20pt. Map to caption multiplier: `mult ≤0.9 → +tracking`, `1.0 → ~0`,
  `≥1.25 → −tracking`, `≥1.5 → more −`. Prevents big type feeling loose/cheap.
- **T3 — Leading ≥1.4× font** for multi-line reads; tighter (~1.1–1.2×) for stacked
  display so a 2-line hero reads as one unit, not two captions.
- **T4 — Weight contrast.** Premium uses **light supporting words + heavy key word**
  (or all-heavy with size contrast). Uniform bold = the #1 "subtitle" tell.
- **T5 — Whitespace is active.** Never fill the safe box; a short line should sit in
  air. Big type + air = "headline"; small type in a busy frame = "subtitle".

### Current gap
- T1: hero is 1.44× / headline 1.24× → **hero is close but headline < 1.5× of
  caption**; the ceiling is also eaten by the overflow guard on 3-word lines. Fix by
  (a) pushing hero toward 1.5–2.0×, (b) grouping shorter (≤2 words) so big type fits.
- T2: only a fixed `\fsp-2/-3` on hero exists → make tracking a **continuous
  function of `fontMult`** (incl. small +tracking for micro/support).
- T3: libass leading is default → set line spacing per role (tighter for hero).
- **T4: NOT DONE — biggest typographic lever left.** Needs Sora/Jakarta Regular+Bold
  faces (bundled, proven to load on the Linux worker in Phase 3); cannot be *seen*
  on local ffmpeg (no fontconfig) → **requires one RF render to validate visually.**

---

## 2. Emphasis — think in prosody, not a lexicon

**Sources:** linguistics of sentence stress / prosody (content vs function words;
nuclear/end-focus; contrastive & new-information stress); pro-editor caption styles.

This reframes emphasis from "score each word" to **"which word would a person
*say louder*?"** — a genuinely human model.

### Deterministic rules
- **E1 — Never emphasise function words.** Articles, prepositions, pronouns,
  conjunctions, auxiliaries are *reduced* in speech. (We already exclude these via
  STOP_WORDS — keep.)
- **E2 — Content words are the candidates.** Nouns, main verbs, adjectives, adverbs,
  wh-words carry stress.
- **E3 — Default = NEW-INFORMATION / END-FOCUS.** In a neutral clause the nuclear
  stress falls on the **last content word of the thought group**. So absent a
  stronger signal, emphasise the *last content word*, not the longest word. This
  alone will feel dramatically more natural than "longest non-stop-word".
- **E4 — Contrastive focus overrides end-focus.** After a pivot (but / instead /
  without / until / not … but), stress the *contrasted* word. (We have contrast
  pivots — keep, and raise their priority above end-focus.)
- **E5 — Intent lexicon is the *override*, not the default.** Numbers, pain,
  transformation, emotion, power verbs are "editor would punch this" words → they
  outrank end-focus when present. (We have the tiers — reorder so lexicon > contrast
  > end-focus > (nothing).) 
- **E6 — At most ONE emphasis per on-screen beat** (done in V2). If nothing scores
  above "ordinary content word", emphasise **nothing** — a clean line is premium.
- **E7 — Emphasis channel varies (size OR colour OR weight), never all at once.**
  Hero = size. Mid-read payload = colour+scale. Stat = mono+colour. (V3 "big or
  coloured" is the start.)

### Current gap
- **E3 is missing** — we pick by lexicon tier then *longest word*. Replacing the
  longest-word fallback with **end-focus (last content word)** is the single biggest
  "stop feeling like a parser" change, and it's fully deterministic + locally
  testable (it changes *which index*, not fonts). **Highest-priority next code.**
- E5 ordering: ensure lexicon override > contrast > end-focus.

---

## 3. Motion — the physics that reads as "expensive"

**Sources:** 12 animation principles (follow-through / overlapping action; secondary
action); parallax depth; kinetic-typography reveal techniques; micro-entrance timing
200–400 ms, feature beats 600–1200 ms.

### Deterministic rules
- **M1 — Ease-out entrances** (fast in, settle slow). *(done: accel 0.5)*
- **M2 — Overshoot + settle** (scale past target ~105–110%, relax back). *(done V3)*
- **M3 — Overlapping action / follow-through.** Elements settle at *different* rates
  — the key word lands a beat after support words. *(partially done: keyword settles
  slower)* Extend: last word of a line settles last (trailing follow-through).
- **M4 — Stagger offsets** 40–60 ms/word; the reveal should *flow* L→R, not all-at-once. *(done)*
- **M5 — Parallax depth.** Different planes move at different speeds. Outro already
  does this (bg pushes, text steady). For captions, a *very* subtle differential
  (e.g., key word drifts up a hair more than support) hints depth. Optional/subtle.
- **M6 — Focus resolve** (blur→sharp) as a premium accent, ≤1 element/beat. *(done V3, keyword)*
- **M7 — Timing budget.** Micro-entrance 200–400 ms; **the hook (first beat) should
  resolve FASTER** to respect the "first 2 seconds decide 70% of retention" window.
- **M8 — Exit matters too.** Premium captions leave with a quick fade/settle, never a
  hard cut. *(fade-out exists; keep short.)*

### Current gap
- M7: all beats share timing → give the **hook a snappier entrance** (shorter
  stagger + faster settle) so it lands inside the 2s window.
- M3: extend follow-through to the *line's last word*, not only the keyword.
- All motion changes are font-agnostic → **locally validatable** on frames + short clips.

---

## 4. Composition, grouping & reading rhythm

**Sources:** editorial layout (asymmetry 7fr/3fr, whitespace); Apple RSVP (flash
words in one place to cut eye movement); short-form caption line-length data
(3–7 words/line, mobile 32–38 char/line, 1–3 word chunks for punch).

### Deterministic rules
- **C1 — Chunk length drives feel.** 1 word = punch/hero; 2 words = strong; 3 = read;
  4+ = supporting/subtitle. **Fewer words per line = bigger type = less subtitle-y.**
  Consider `maxWordsPerLine = 2` for hero/hook beats.
- **C2 — RSVP for hooks.** A one-word hook flashed centre (big) is maximally premium
  and retention-friendly. Reserve for ≤2-word hero beats.
- **C3 — Vertical rhythm / placement.** Dead-centre (an5) is the classic subtitle
  position. A consistent **lower-third-of-the-upper-half** anchor (≈42–48% H) or a
  deliberate band reads more "designed" while staying clear of platform UI. *(Needs
  RF render over real footage to tune safely — placement risk.)*
- **C4 — Whitespace.** Cap lines at ≤2; let short beats breathe (don't stretch to fill).
- **C5 — Safe areas** 120 px sides / clear of bottom ~20% (platform UI). *(have)*

### Current gap
- C1/C2: `maxWordsPerLine` is a flat 3 → make it **role-aware** (hook 2, read 3).
- C3: still an5 centre → candidate change, **RF-gated** (must see it on footage).

---

## 5. Retention & pacing (informs, doesn't override the frozen story pipeline)

**Sources:** 2025–26 short-form retention studies.

- **R1 — First 2 s decide ~70% of retention** → the hook caption must appear *fast*
  and read in <1 s. (→ M7 hook-snappier.)
- **R2 — Pain-point question openings +23%** retention. (Story pipeline; presentation
  just must not slow the hook.)
- **R3 — Fast pacing +34%**; brisk caption cadence, short cue durations (1–3 s),
  0–200 ms gaps. Our per-scene caption timing already tracks the VO.
- **R4 — Reading speed** 160–200 WPM (0.3–0.375 s/word) ceiling; never show a cue too
  briefly to read. Advisory QA (Pass 8) can flag cues exceeding this.
- These are **guardrails / QA checks**, not new emphasis logic. Belongs in the
  advisory Presentation-QA pass (non-blocking), NOT in the frozen story agents.

---

## 6. End Screen — the OttoFlow "Final Scene" language (unique, not imitation)

**Sources:** logo-reveal / brand-sting motion practice; commercial outro conventions;
"the ending is a scene, the CTA emerges from it." We define our **own** system.

### The OttoFlow ending in one sentence
> The film doesn't stop — it **breathes out**. The last scene defocuses and settles,
> a quiet light gathers, and the promise (CTA) rises out of that light, followed by
> the brand as a calm signature.

### Deterministic beat sheet (3.0–4.0 s)
1. **Dissolve-in (0–0.4 s):** last scene frame → defocus (blur), desaturate, darken;
   fade from the film. *A continuation, not a cut.* *(done: footage-continuation)*
2. **Breath / camera (whole clip):** a slow 6–7% push (never a zoom "effect") — the
   scene keeps living. *(done: zoompan)*
3. **Light gather (0.3–0.8 s):** a soft brand-tinted glow blooms where the CTA will
   land — motivates the text, "lights the stage". *(scrim glow exists; make it
   *animate in*, not static.)*
4. **CTA rise (0.55–1.2 s):** the promise line rises + settles with overshoot; the
   ONE verb/outcome word gets the accent. *(done, refine easing.)*
5. **Underline draw (0.95–1.3 s):** the accent underline **wipes** L→R (draw-on),
   not a fade — a signature "commit" gesture. *(currently fades; upgrade to a clip
   wipe = uniquely OttoFlow.)*
6. **Brand signature (1.3–1.7 s):** brand name/logo settles last, calm and quiet
   (low energy = confidence). *(name done; animated logo reveal is the gap.)*
7. **Hold (→ end):** everything still, light steady, footage still gently pushing —
   the viewer never feels "it ended", they feel "that's the product."

### What makes it *ours* (not Apple/Nike)
- **Continuity over cut** — always grown from the film's own last frame.
- **Light-motivated reveal** — text appears *because* light gathered, not on a card.
- **Draw-on underline** as the brand "commit" gesture.
- **Calm brand signature** — the logo is the quietest beat, not a bombastic sting.

### Current gap
- Static scrim glow → **animate the glow bloom** (grows as CTA rises).
- Underline fade → **draw-on wipe** (`\clip` animated, or a masked reveal in the
  layer compositor).
- **Animated logo reveal** (when a locked logo asset exists) — currently omitted to
  avoid the duplicate bottom-right overlay; resolve by suppressing the global
  overlay across the outro window and giving the logo its own calm reveal.

---

## 7. Gap summary & prioritised backlog (for approval before coding)

| # | Change | Area | Local-validatable? | Risk |
|---|--------|------|--------------------|------|
| P1 | **End-focus / new-information emphasis** (replace longest-word fallback with last-content-word; order lexicon > contrast > end-focus) | §2 E3/E5 | ✅ yes (index only) | low |
| P2 | **Role-aware grouping** (hook ≤2 words) + push hero toward 1.5–2.0× | §1 T1, §4 C1 | ✅ yes | low |
| P3 | **Tracking as f(size)** + per-role leading | §1 T2/T3 | ✅ yes | low |
| P4 | **Hook snappier entrance** + last-word follow-through | §3 M3/M7 | ✅ yes | low |
| P5 | **Weight contrast** (support Regular / key Bold) | §1 T4 | ⚠️ needs RF (fonts) | med |
| P6 | **Outro: animated glow bloom + draw-on underline + logo reveal** | §6 | ✅ mostly (synthetic footage) | med |
| P7 | **Caption placement** (lower anchor / band) | §4 C3 | ❌ RF-gated (real footage) | med |
| P8 | **Advisory QA** reading-speed/overflow flags | §5 R4 | ✅ yes | low |

**Recommended order:** P1 → P2 → P3 → P4 (all low-risk, locally provable, and they
attack the "parser/subtitle/mechanical" tells directly) → P6 (outro polish) → then
**one RF render** to validate P5 weight contrast + P7 placement + real-footage motion,
which cannot be judged on stills. P8 last (it's a guardrail, not a look).

**Every item stays** deterministic, Modern-opt-in, fail-safe→Legacy, one logical
commit, frame-critiqued before ship. No new architecture/workers/providers/LLMs.

---

## Sources
- Editorial hierarchy & whitespace: [Fiveable — Typographic Hierarchy & Scale](https://fiveable.me/advanced-editorial-design/unit-3/typographic-hierarchy-scale/study-guide/B1cAgPiV1GWWeXc3), [BAS — Editorial Layout Principles](https://www.bas-bg.com/editorial-layout-design-principles-how-to-create-magazine-spreads-that-captivate-readers/)
- Apple SF optical sizing/tracking: [SF Pro Typography System](https://blakecrosley.com/blog/sf-pro-typography-system), [Apple HIG — Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- Prosody / sentence stress: [Wikipedia — Stress (linguistics)](https://en.wikipedia.org/wiki/Stress_(linguistics)), [The Sound of English — Content vs Function Words](https://thesoundofenglish.org/content-function-words/), [Thought Groups & Sentence Stress](https://opentext.ku.edu/amenglishpronunciation/chapter/thought-groups-and-sentence-stress/)
- Motion "expensive" (follow-through/overlap/parallax): [Fiveable — Follow-through & Overlapping Action](https://fiveable.me/2d-animation/unit-7/timing-spacing-follow-overlapping-action/study-guide/tlKfOk7Bga0RJuND), [Motion Design School — Parallax](https://motiondesign.school/blog/parallax-in-after-effects/), [trydemotion — Motion Design Principles](https://trydemotion.com/blog/motion-design-principles-animation)
- Kinetic typography reveal/overshoot timing: [ikagency — Kinetic Typography Guide](https://www.ikagency.com/graphic-design-typography/kinetic-typography/)
- Caption emphasis styles: [Zubtitle — Word-by-word Styling](https://zubtitle.com/blog/emphasize-your-video-captions-with-word-by-word-styling), [OpusClip — Caption Presets & Retention](https://www.opus.pro/blog/best-caption-presets-styles-boost-retention)
- Retention & pacing: [OpusClip — TikTok Length/Format Retention Data](https://www.opus.pro/blog/tiktok-length-format-retention-data), [Joyspace — Ideal Video Length 2026](https://joyspace.ai/ideal-video-length-social-platform-2026)
- Caption timing/readability: [Clickyapps — Timing & WPM](https://clickyapps.com/creator/captions/guides/timing-best-practices-readability-wpm)
- ASS/libass technique ecosystem (idiom check, nothing copied): [libass](https://github.com/libass/libass), [NyuFX](https://github.com/Youka/NyuFX), [kfxgui](https://github.com/9vult/kfxgui)
