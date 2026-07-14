# V4 Research Report (Deliverables 1–8)

Principles extracted from premium commercial + top-creator practice (Apple, Linear,
Stripe, Nike, Airbnb, MrBeast, Hormozi, high-retention Reels/Shorts/TikTok). We
extract *principles*, never copy designs. Grounded in the V3 research plus 2025–26
sources listed at the end.

---

## §1 Professional Research Report (overview)
Premium short-form is **edited to a beat**, not captioned. Three meta-principles:
1. **Contrast drives attention** — size contrast, color contrast, speed contrast.
   Sameness is invisible; a one-word 130px hook next to a 60px read is what the eye
   locks onto.
2. **The cut is the unit, not the sentence** — text changes with the *idea*, often
   every 0.8–2.0 s, synchronized to voice stress and footage cuts.
3. **Restraint reads expensive** — one accent color, ease-out motion, generous
   space, a held final frame. Effects everywhere = cheap.

Our gap is not capability (ASS/libass does all of this) — it is **authoring
intelligence**: deciding *per beat* how big, how fast, what to stress, how to move.

## §2 Typography Research
- **Pairing:** one geometric display face for impact (our **Sora**), one humanist
  sans for reading (our **Plus Jakarta Sans**), one mono for data (our **IBM Plex
  Mono**). This is exactly the premium 3-role model — keep it.
- **Psychology:** geometric = confident/modern; humanist = trustworthy/legible;
  mono = precise/technical. Match face to *message*, not randomly.
- **Hierarchy (the biggest current weakness):** premium editing uses a **5–7 step
  scale within one video**. Today we use ~1–2 sizes. Need: Display-XL (hook),
  Display, Hero, Caption (read), Micro — chosen per beat.
- **Size rules:** *huge* for 1–3 word hooks, emotional peaks, numbers, the CTA;
  *small* for connective reads and disclaimers. *Bold* for stressed words/hooks;
  *lighter/regular* for connective tissue. Weight is a hierarchy tool, not a default.
- **Tracking/kerning/leading:** display sizes want slightly **negative tracking**
  (−0.5…−1px @1920) so big words feel tight/premium; body wants slight **positive**
  tracking for legibility; leading 96–100% for display, 112–120% for body. Optical
  centering matters (punctuation/quotes hang).
- **Mobile/TV/commercial readability:** heavy weight + strong dark edge (stroke
  and/or shadow) = ~21:1 contrast, readable on any footage at thumb-scroll. Cap
  reading lines at 1–3 words for hooks, ≤6 for reads.
- **How much / how long:** 160–180 wpm on screen; each beat **0.8–2.0 s**; ≤2 lines
  visible; a scene may hold 2–5 caption beats.

## §3 High-Retention Video Analysis
Why viewers keep watching (retention mechanics), and how *presentation* supports it:
- **0–3 s hook is 80% of the battle.** Biggest type, fastest entrance, immediate
  keyword, sound up front. If the first frame doesn't land a complete idea + a
  promise, the thumb moves.
- **Visual change every 1–3 s.** Text should *change* (new beat, new emphasis, size
  shift) on that cadence even within one scene — motion resets attention decay.
- **Open loops + escalation.** Presentation reinforces: withhold the accent/reveal
  until payoff; escalate size/energy across beats.
- **Emphasis rhythm.** The *stressed word* changing every beat is itself a retention
  device — the eye tracks the moving highlight.
- **Benchmarks:** ~65% who pass 3 s reach 10 s; ~45% of those reach 30 s. Niches
  peak at 15–35 s. Pace must **serve the story** — cutting faster than the narrative
  carries *hurts* retention.
- **What premium creators consistently do:** short beats, one loud word per beat,
  constant micro-motion, a hard style/size "pattern interrupt" every 5–8 s, and a
  calm, branded, converting end.

## §4 Text Presentation Research
- **Chunking:** 1–3 word beats for hooks/emphasis; ≤6 words for professional reads;
  break at **speech pauses**, never grammar. Never a full-sentence subtitle block.
- **Per scene:** 2–5 caption beats; 1 idea per beat.
- **Limits:** ≤32–42 chars/line; ≤2 lines on screen; 9–13 chars/sec reading speed.
- **Eye tracking / scanning:** the eye fixates ~3–4 words per glance and scans in a
  vertical-center Z; keep text in the **55–78% height band** (lower-middle), never
  dead-center over the subject's face, never in the bottom UI rail.
- **Never split:** numbers from units ("50 %"), names, or leave a stop-word dangling.
- **Disappear/overlap/animate:** a beat should clear before the next enters (no
  stacking); animate the *enter*, hold, then a quick fade — overlap only for a
  deliberate cross-beat build.
- **White space is a feature** — crowded captions read cheap; margins + air read
  premium.

## §5 Animation Research
- **Easing:** premium = **ease-out** (fast→settle), often a custom expo curve
  (≈ cubic-bezier .16,1,.3,1). **Never ease-in** for entrances (feels sluggish).
- **Durations:** word/character pop 90–180 ms; caption entrance 120–220 ms; scene/
  end reveals 500–900 ms; final hold ≥ 800 ms.
- **Overshoot/bounce/elastic:** use *sparingly* (≤4% overshoot). Big bounce/elastic
  reads gaming/cheap; a tiny settle reads crafted.
- **Techniques by tier:** fade + subtle scale (safe/premium) → per-word karaoke
  fill/rise (creator) → staggered word reveal + blur-in (high-end) → mask/wipe
  reveals (broadcast). Slide should be *small* (≤20px) and eased.
- **Staggering:** reveal words/lines in sequence (20–60 ms apart), not as a block —
  this is the single biggest "motion feels designed" lever.
- **Micro vs macro:** micro = per-word pop/fill (attention); macro = scene-level
  build/transition (rhythm). Both eased, both restrained.
- **Motion curves as brand:** pick ONE entrance curve + ONE emphasis motion and use
  them everywhere → consistency reads as craft.

## §6 End Screen Research
Premium endings are **scenes, not slides**. What elite endings share:
- **Motion background** (slow gradient drift / soft bloom, ≤3% movement) — never a
  flat card.
- **Staggered, eased brand reveal**: headline/CTA → accent underline wipe → brand
  wordmark/logo fade-scale (700–900 ms) → optional website/handles/QR — in sequence.
- **Held final frame** (≥0.8 s) so the CTA + brand land.
- **Consistency**: same motion/type/color every video → recall (Apple/Nike end-tags).
- **Conditional assets**: show logo/URL/social/QR only when real; otherwise minimal.
- **Duration 2.5–4 s.** Frozen-safe realization: render the outro as a **short
  pre-composed clip** appended by the existing concat (see architecture) — a scene,
  not a `sharp` PNG.

## §7 Audio Presentation Research
- **Loudness:** integrated −11 (TikTok/IG), −12 (FB Reels), −14 (YT/LinkedIn);
  true-peak ≤ −1.5 dBTP.
- **Voice:** compression 4:1–6:1, gentle EQ (high-pass ~80 Hz, presence lift
  2–5 kHz) for intelligibility; voice is always the loudest element.
- **Music:** sidechain-duck under voice (bed ~−18…−22 LUFS during narration),
  recover in gaps; **music rises** at the hook and the outro, **falls** under dense
  narration. Modest stereo width on music, voice centered/mono-safe.
- **Emotion:** music should track the arc — tension bed forward, transformation
  swell, calm hold at the CTA.
- **Frozen-safe:** all of this is achievable with the existing FFmpeg filtergraph
  nodes (acompressor, equalizer, sidechaincompress, loudnorm, alimiter, afade,
  volume automation) — no new audio tool.

## §8 Open-Source / GitHub Survey
Extract ideas only; copy nothing. Key finding: **the best engines all build on the
same ASS/libass core we already use** — validating our foundation. We need better
*authoring*, not a new renderer.
- **libass** — the industry-standard ASS renderer (what our FFmpeg `ass` filter
  uses). Confirms ASS is the right substrate.
- **SubtitlesOctopus / JASSUB** — libass compiled to WASM for browsers; idea: we
  could build a **browser ASS preview** for the editor (author-time WYSIWYG) without
  touching the render path.
- **vidstack/captions**, **weizhenye/ASS** — lightweight JS ASS/VTT renderers; ideas
  for a preview layer + CSS-driven styling model.
- **auto-subs (DaVinci/Premiere), CapCut-style generators** — word-level karaoke +
  preset systems + marker-based per-word timing + conflict/overflow detection.
  Ideas we adopt as **pure passes**: preset library, per-word timing, overflow/
  conflict checks. (Their Whisper/ASR is **out of scope** — we keep deterministic
  timing from caption spans; no new provider.)
- **Motion-typography / After-Effects-automation repos** — idea: choreography as
  data (a keyframe/stagger spec compiled to ASS `\t` transforms), not hand-tuned.

**Takeaway:** everything premium here compiles down to ASS override tags (`\k/\kf`,
`\t`, `\fad`, `\move`, `\fscx/\fscy`, `\blur`, `\fn`, `\1c`, `\pos/\an`) — which
libass already renders. V4 = a smart **ASS choreography compiler** + QA, in-process.

---
**Sources (2025–26):**
[OpusClip caption design](https://www.opus.pro/blog/video-caption-design-placement) ·
[OpusClip TikTok](https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices) ·
[OpusClip Shorts hooks](https://www.opus.pro/blog/youtube-shorts-hook-formulas) ·
[Socialync hook/body/payoff](https://www.socialync.io/blog/short-form-video-structure-guide-2026) ·
[Clippie editing techniques](https://clippie.ai/blog/video-editing-techniques-creators-2026) ·
[Critical Listening Lab loudness](https://www.criticallisteninglab.com/en/learn/loudness/social-media) ·
[OpenClip ducking](https://openclip.app/learn/audio-ducking) ·
[ClickyApps LUFS](https://clickyapps.com/creator/video/guides/lufs-targets-2025) ·
[Material easing](https://m3.material.io/styles/motion/easing-and-duration) ·
[Motion.dev easing](https://motion.dev/docs/easing-functions) ·
[libass](https://github.com/libass/libass) ·
[SubtitlesOctopus](https://github.com/libass/JavascriptSubtitlesOctopus) ·
[JASSUB](https://github.com/ThaUnknown/jassub) ·
[vidstack/captions](https://github.com/vidstack/captions)
