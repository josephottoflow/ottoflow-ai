# OttoFlow Presentation Engine V4 — Production Specification

**Scope:** presentation quality ONLY. **Research + specification. No code, no
commits, no implementation.** The render pipeline (Seedance, AtlasCloud, ElevenLabs,
FFmpeg stitching/concat, workers, queue, Redis, Railway, Supabase, scene/story gen,
providers, upload/download, retries) is **FROZEN**. No new providers/LLM/Whisper/OCR/
ASR/external typography or caption services. Everything builds on the **existing
ASS/libass + FFmpeg** layer.

**Architecture (approved shape):** ONE `PresentationEngine` = 8 deterministic passes
run **in-process inside the existing compose step**, at the two seams that already
exist — `renderAss()` (captions) and the CTA-clip append (outro). Gated per-render by
the existing profile flags; **fail-safe** (any pass throws → prior behaviour → Legacy);
Legacy output **byte-identical**. No orchestration/worker changes. (Deeper background:
`01_RESEARCH.md`, `02_ARCHITECTURE.md`, `03_STYLE_GUIDE_V2.md`.)

This document contains all 10 deliverables.

---

## 1. Caption Intelligence Research (deterministic only)
Premium captions are *edited to the voice*, not transcribed. Rules (no AI):
- **Words on screen:** 1–3 words/line for hooks/emphasis; ≤6 words/line for
  professional reads. **≤2 lines** visible at once.
- **Characters:** ≤32–42 chars/line (hard cap → triggers re-chunk/shrink).
- **Reading speed:** 9–13 chars/sec (~160–180 wpm); each beat on screen **0.8–2.0 s**
  (min 0.8 to be readable, max ~3 s before it feels static).
- **When captions change:** on the *idea/phrase* boundary, synced to the caption's
  own `[startMs,endMs]` spans — typically every 0.8–2.0 s; a scene holds 2–5 beats.
- **Follow narration:** deterministic per-word timing derived from the beat's span
  (length-weighted, sums exactly to the span — our existing `karaokeRuns` model). No
  ASR; timing comes from the spans we already have.
- **Grouping/chunking:** break at natural speech pauses (punctuation, conjunctions),
  never mid-grammar; **never** split a number from its unit, a name, or leave a
  stop-word dangling at a line edge.
- **Keyword selection (deterministic priority lexicon):**
  1. numbers / % / $ / × → also render mono
  2. pain/problem words (stuck, wasted, chaos, lost, slow, fail…)
  3. transformation words (unlock, clarity, effortless, finally, instantly…)
  4. emotion/urgency (love, hate, now, never, best, free…)
  5. power verbs (save, stop, build, win, cut, double…)
  6. contrast pivots (but, instead, until, without) → emphasize the *next* word
  7. else strongest noun (Capitalised/proper) → else longest non-stop-word
  **One keyword per line; never a stop-word.** Lexicons are data tables (tunable).
- **Overflow prevention:** measure text width per line vs the role's max-width; if
  over, re-chunk or drop one type size before render (never clip).

## 2. Typography Research
- **Pairing (keep the shipped stack):** Sora (display/CTA), Plus Jakarta Sans
  (captions/body), IBM Plex Mono (numbers/data). Geometric + humanist + mono = the
  premium 3-role model.
- **Hierarchy (the biggest lever):** a **5–7 step scale within one video**, chosen per
  beat — not one global size. Display-XL 6.9%H (hook) → Hero 5.2% → Headline 4.4% →
  Caption 4.0% (read) → Body 3.1% → Micro 1.5%.
- **Sizing rule:** *huge* for 1–3-word hooks, numbers, emotional peaks, CTA; *small*
  for connective reads. Weight is a hierarchy tool (bold hooks, regular reads).
- **Tracking:** display slightly negative (−0.5…−1px @1920) for tight premium feel;
  body slightly positive for legibility.
- **Line height:** 96–100% display, 112–120% body.
- **Stroke/shadow:** heavy weight + strong dark edge (stroke 4–8px @1920 + soft
  shadow) → ~21:1 contrast, readable on any footage at thumb-scroll.
- **Safe areas:** 120px sides, 220 top, 320 bottom; captions in the **55–78%H** band
  (lower-middle), never over a face, never in the bottom UI rail.

## 3. Text Animation Research (ASS/libass-implementable only)
Every technique below compiles to ASS override tags libass already renders
(`\t, \fad, \move, \fscx/\fscy, \k/\kf, \blur, \1c, \pos/\an`). Study of Apple/Linear/
Stripe/Nike/Netflix motion → **elegant, restrained, ease-out**:
- **Reveal timing:** word pop 90–180 ms; caption entrance 120–220 ms; scene/outro
  reveals 500–900 ms; final hold ≥ 800 ms.
- **Easing:** ease-out (fast→settle), custom expo (≈ cubic-bezier .16,1,.3,1),
  approximated in ASS with a front-loaded `\t` and small overshoot. **Never ease-in.**
- **Scale:** entrance from 106–112% → 100% (`\fscx/\fscy` via `\t`); ≤4% overshoot.
- **Stagger:** reveal words 20–60 ms apart (per-word `\t`/`\k`) — the #1 "designed"
  signal; avoid whole-block reveals.
- **Opacity:** `\fad` / `\alpha` fades 90–220 ms; clear a beat (fade 90–160 ms) before
  the next enters — no stacking.
- **Blur:** subtle `\blur` glow on keyword/hook only (0.6–1.2); never on reading text.
- **Emphasis animation:** keyword = accent color (`\1c`) + 108–112% scale + optional
  soft glow, appearing in sync with the spoken word (karaoke). Numbers → mono `\fn`.
- **Brand consistency:** ONE entrance curve + ONE emphasis motion, used everywhere.

## 4. End Screen V3 Research (an animated *scene*, not a slide) — FFmpeg-native
Premium endings are motion scenes. Frozen-safe realization: build the outro as a
**short pre-composed clip** via a **self-contained ffmpeg pass** and let the
**existing concat append it** exactly as it appends the current CTA card — stitching
untouched.
- **Composition:** brand-palette gradient background with a **slow vertical drift +
  soft accent bloom** (`zoompan`/gradient + overlay, ≤3% motion) + edge vignette.
- **Staggered reveal (ease-out):** CTA headline (Headline/CTA role) fade+scale →
  accent **underline wipe** L→R → **brand wordmark/logo** fade-scale (700–900 ms) →
  conditional **website / social handles / QR** (only when the real asset exists).
- **CTA hierarchy:** one clear action, largest; brand second; URL/handles/QR tertiary.
- **Logo:** composite locked brand logo bytes (never model-generated); else wordmark.
- **QR/social/website placement:** lower third, below the underline, small (Micro/
  Footer roles), shown only if provided; otherwise keep the outro minimal & elegant.
- **Duration 2.5–4.0 s**, hold the final composed frame ≥ 0.8 s.
- **Fallback:** any failure → the current V3 static premium card → Legacy card.

## 5. Audio Presentation Research (existing FFmpeg filters only)
Nodes available today: `acompressor, equalizer/highpass, sidechaincompress, loudnorm,
alimiter, afade, volume`. Spec:
- **Loudness (per platform):** TikTok/IG −11, FB Reels −12, YT/LinkedIn −14; TP ≤ −1.5
  dBTP (`loudnorm` + `alimiter`).
- **Voice clarity:** `acompressor` ~4:1 (thresh ≈ −18 dB, atk 5 ms, rel 120 ms) +
  gentle EQ (high-pass ~80 Hz, presence lift 2–5 kHz). Voice is always loudest.
- **Ducking:** `sidechaincompress` (thresh ~0.04, ratio 8, atk 20, rel 300) so the bed
  sits ~−18…−22 LUFS under narration, recovering in gaps.
- **Narration/music balance & emotion:** music **rises** at the hook and the outro,
  **falls** under dense narration (volume automation via `afade`/`volume` enable);
  voice centered/mono-safe.

## 6. GitHub / Open-Source Survey (ideas only, no code copied)
Confirms our foundation: the best engines all build on **ASS/libass** — we don't need
a new renderer, we need smarter authoring.
- **libass** — the standard ASS renderer (our FFmpeg `ass` filter). Right substrate.
- **SubtitlesOctopus / JASSUB** — libass→WASM for browsers. Idea: an **author-time
  ASS preview** in the studio (no render-path change).
- **vidstack/captions, weizhenye/ASS** — lightweight ASS/VTT renderers; styling ideas.
- **auto-subs / CapCut-style generators** — word-level karaoke, **preset libraries**,
  **marker-based per-word timing**, **overflow/conflict detection**. Adopt as *passes*
  (their ASR is out of scope; we keep deterministic span timing).
- **Motion-typography / AE-automation repos** — idea: **choreography-as-data** (a
  stagger/keyframe spec compiled to ASS `\t`), not hand-tuned tags.
Everything premium compiles to ASS tags → a smart **ASS choreography compiler** is the
whole job.

## 7. Presentation Engine Specification (the 8 passes)
`PresentationEngine.run(captions, plan, profileFlags) → { ass, outroClipSpec, qa }`.
Pure, deterministic, in-process; runs Modern-only; each pass `try/catch → prior
behaviour`. New pure files under `src/lib/presentation/` (no infra).

| # | Pass | Input | Output | Rules / validation | Failure mode |
|---|---|---|---|---|---|
| 1 | **Sentence Analysis** | caption text + `[start,end]ms` | tokens + pause/boundary map + POS-ish tags (heuristic) | detect punctuation, conjunctions, numbers, names; no network | → treat whole caption as one phrase |
| 2 | **Caption Grouping** | tokens + boundaries | beats[] (1–3 word lines, ≤2 lines, per-word timing) | ≤ chars/line; break at pauses; keep number+unit/names; no dangling stop-word | → V3 `groupIntoLines` |
| 3 | **Keyword Selection** | beat words + tags | ≤1 keyword index/line + reason | priority lexicon (§1); never a stop-word | → longest non-stop-word |
| 4 | **Typography Layout** | beats + role hints + frame | per-beat role + positioned/wrapped lines | role ∈ 5–7 scale; ≤1 loud beat/5 s; fits max-width | → Caption role, center |
| 5 | **Animation Planning** | beats + roles + energy | motion spec (enter/emphasis/exit) → **ASS tags** | ease-out; durations in bounds; ≤4% overshoot; stagger 20–60 ms | → simple `\fad` |
| 6 | **Overflow Detection** | positioned lines + roles | fixups (shrink role step / re-chunk) | measured width ≤ role max; ≤2 lines | → shrink one step / clamp |
| 7 | **Safe-Area Validation** | final layout + frame | pass/fixup | bbox ∈ {120/220/320}; band 55–78%H; contrast ≥ threshold (raise stroke/scrim) | → clamp into band |
| 8 | **Presentation QA** (advisory) | final ASS + outro spec | scores 0–100 + flags + pass/fail vs checklist | attention, readability, retention-cadence, brand-compliance, premium; **non-blocking** | → skip (log only) |

Passes 1–7 are **correctness/authoring** (they produce or fix the ASS); Pass 8 is
**advisory** (scores, never blocks). Output ASS plugs into the existing `renderAss`;
the outro spec into the existing CTA-clip append. Config (roles, curves, lexicons,
timing, per-platform LUFS) lives in typed tables extending `typography.ts` /
`render-profile.ts`.

## 8. Premium Video Style Guide V4 (canonical values)
Supersedes prior style guides for Modern profiles; Legacy unchanged.
- **Type scale:** Display-XL 132 / Display 116 / Hero 100 / Headline 84 / Caption 76 /
  Body 60 / Micro 28 px @1920 (%H equivalents). Faces per §2.
- **Emphasis:** priority lexicon (§1); one keyword/line; accent = **brand accent →
  marigold fallback only** (never hardcoded); numbers → IBM Plex Mono.
- **Motion:** ease-out expo; word pop 90–180 ms; caption enter 120–220 ms; stagger
  20–60 ms; ≤4% overshoot; final hold ≥ 800 ms; one curve + one emphasis motion.
- **Safe areas / grid:** 120/220/320; caption band 55–78%H; 20px rhythm; generous air.
- **End scene:** pre-composed 2.5–4 s animated clip; conditional assets; held frame.
- **Audio:** per-platform LUFS −11/−12/−14, −1.5 dBTP; voice 4:1 + presence EQ; duck
  −18…−22 LUFS; music rise@hook/outro.
- **Profiles:** `legacy` (byte-identical) · `modern_v1` professional (Jakarta, calm
  hierarchy) · `modern_v2` bold creator (Sora, big Display/Hero, punchy stagger). All
  V4 flags default Legacy; opt-in per render; **never a global default**.

## 9. Implementation Roadmap
Small commits; each = `next build` + `build:worker` + scope check + **Legacy
byte-identical** + unit tests; RF-first validation; Modern opt-in. Passes map 1:1 to
phases so risk stays isolated:
1. **P1** Sentence Analysis + Caption Grouping (Passes 1–2) → RF A/B.
2. **P2** Keyword Selection lexicon (Pass 3) → RF (vs labeled emphasis set).
3. **P3** Typography Layout + hierarchy per beat (Pass 4) → RF.
4. **P4** Overflow + Safe-Area validation (Passes 6–7) → fault-injection + RF.
5. **P5** Animation Planning / ASS choreography (Pass 5) → RF.
6. **P6** End Scene V3 clip (FFmpeg pass before concat) → RF (render + fallback).
7. **P7** Audio V3 (existing filters) → measure LUFS + RF.
8. **P8** Presentation QA scorer (advisory) + studio "Presentation Score".
9. **P9 (optional)** author-time ASS preview in studio (frontend only).
Validation per phase: RF (download→local-ffmpeg frame inspection — the proven
method), then **one** Seedance render after RF certifies. Legacy stays default until
a full A/B across ≥5 brand categories + QA checklist pass, then you decide.

## 10. Risk Assessment (RPN-ranked)
| # | Risk | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| 1 | Emphasis picks a subjectively "wrong" word | 4 | 5 | 5 | 100 | priority lexicon + per-brand tuning + advisory QA flag; rules are human-legible |
| 2 | Scope creep into a frozen system | 9 | 3 | 3 | 81 | hard rule: presentation lib only; if a change needs the pipeline → STOP + ask |
| 3 | Overflow / cramped long captions | 6 | 4 | 3 | 72 | Pass 6 auto shrink/re-chunk; unit tests on long inputs |
| 4 | Over-motion feels "gaming" | 6 | 3 | 4 | 72 | restraint budget: ≤1 loud beat/5s, ≤4% overshoot, one curve; QA premium score |
| 5 | Audio over-processing (pump/artifact) | 6 | 3 | 4 | 72 | conservative params; measure LUFS/TP; A/B vs Legacy; profile-gated |
| 6 | Font not loaded on worker → DejaVu | 5 | 2 | 4 | 40 | validated on worker (V3 cert); fontsdir + ASS-embed fallback; readable regardless |
| 7 | A pass throws → broken frame | 9 | 2 | 2 | 36 | every pass try/catch → prior → Legacy; ASS-validity gate pre-render |
| 8 | Legacy byte-identity drift | 9 | 2 | 2 | 36 | Legacy path literally unchanged; byte-identity unit test per commit |
| 9 | Outro clip step slows/breaks compose | 7 | 2 | 3 | 42 | isolated ffmpeg pass before concat; timeout + fallback; concat untouched |

**Top items:** emphasis subjectivity (#1), scope creep (#2), overflow (#3),
over-motion (#4). **No pipeline/infra risk by construction** — pure lib, per-render
gated, fail-safe to Legacy.

## Success criteria
A first-time viewer says "this looks professionally edited" — varied hierarchy,
human-accurate emphasis, restrained choreographed motion, an animated end scene,
broadcast audio — while the certified render pipeline stays **frozen**, **Legacy stays
default**, and **Modern stays opt-in** until you approve otherwise.

**Status: specification complete — awaiting approval before any code.**
