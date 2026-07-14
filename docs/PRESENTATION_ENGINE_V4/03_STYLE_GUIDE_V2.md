# Premium Video Style Guide V2 (Deliverable 13)

Extends the V3 guide (`docs/OTTOFLOW_PREMIUM_VIDEO_STYLE_GUIDE.md`) — that remains
the base (14 type roles, safe areas, per-platform LUFS, brand-accent priority, fonts
Sora/Jakarta/IBM Plex Mono). V2 adds the **per-beat presentation system** that turns
"correct subtitles" into "edited commercial." All values deterministic + tunable.

## A. Per-beat hierarchy (the fix for "flat hierarchy")
Each caption beat is assigned ONE role by intent — not one global size:

| Beat intent | Role | Size (%H) | Case | Motion |
|---|---|---|---|---|
| Hook / 1-word punch | **Display-XL** | 6.9% (~132px) | UPPER | scale-pop 106→100, hold |
| Big statement (≤3 w) | **Hero** | 5.2% (~100px) | UPPER | per-word stagger reveal |
| Emphasis / turn | **Headline** | 4.4% (~84px) | Sentence | fill + keyword accent |
| Professional read | **Caption** | 4.0% (~76px) | Sentence | \kf fill |
| Number / stat | **Hero + Mono** | 5.2% | — | count-in feel, accent |
| Connective / aside | **Body/Micro** | 3.1–1.5% | Sentence | quick fade |

Rule: **≤1 "loud" (Display/Hero) beat per ~5 s**; loudness only for hook, emotional
peak, numbers, and CTA. Everything else reads calm — contrast is the point.

## B. Emphasis intelligence (the fix for "wrong word highlighted")
Replace "longest non-stop-word" with a **priority lexicon + rules** (deterministic):
1. **Numbers / % / $ / ×** (always) — and render in IBM Plex Mono + accent.
2. **Pain / problem words** (stuck, wasted, chaos, lost, slow, hard, fail…).
3. **Transformation words** (unlock, clarity, effortless, finally, instantly…).
4. **Emotion / urgency** (love, hate, now, never, worst, best, free…).
5. **Power verbs** (save, stop, build, win, cut, double…).
6. **Contrast pivots** (but, instead, until, without) → emphasize the word *after*.
7. else **strongest noun** (Capitalised/proper) → else longest non-stop-word.
**Never** emphasize articles/prepositions/pronouns. One keyword per line. Curated
lexicons live as data tables (extendable per brand/industry later).

## C. Choreography (the fix for "generic animation")
Pick ONE brand entrance curve + ONE emphasis motion, used everywhere:
- **Entrance curve:** ease-out expo (≈ cubic-bezier .16,1,.3,1). Never ease-in.
- **Word stagger:** 20–60 ms between words (Hero/Display); reads as "designed."
- **Durations:** word pop 90–180 ms; caption enter 120–220 ms; ≤4% overshoot.
- **Emphasis motion:** keyword = accent color + 108–112% scale + (optional) soft
  glow; appears in sync with the spoken word (karaoke).
- **Clear before next:** a beat fades (90–160 ms) before the next enters; no stacking.
- All expressed as ASS `\t`/`\move`/`\fad`/`\k` — nothing the renderer can't do.

## D. Layout & fit (the fix for "cramped / doesn't fit")
- Auto-shrink one role step or re-chunk when a line exceeds role max-width.
- Captions in the **55–78% H** band; never over a face; never in the bottom rail.
- 20px grid rhythm; generous air; optical centering; underline/keyword aligned.

## E. End Scene V3 (the fix for "static slide")
A **pre-composed 2.5–4 s clip** (not a PNG): drifting brand-gradient bg + soft accent
bloom + staggered reveal (headline → underline wipe → brand/logo fade-scale →
conditional URL/handles/QR) + held final frame. Built as its own ffmpeg pass and
appended by the *existing* concat. Conditional assets only when real.

## F. Audio (extends V3)
Per-platform LUFS (−11/−12/−14, −1.5 dBTP), voice acompressor 4:1 + presence EQ,
sidechain duck (bed −18…−22 LUFS under voice), music **rises at hook + outro**, falls
under dense narration. Existing filtergraph nodes only.

## G. Profile mapping
- `legacy` → none (byte-identical). `modern_v1` → professional (Jakarta, calm
  hierarchy, corporate emphasis). `modern_v2` → bold creator (Sora, big Display/Hero,
  punchy stagger). A future `modern_v3` could enable the full choreography tier.
- All V4 flags default to Legacy values; **opt-in per render; never global default**.

## H. Acceptance = the QA checklist (see `02_ARCHITECTURE.md` §12 + V3 §10)
A render passes only if: hook lands in 3 s · emphasis matches human stress · ≤1 loud
beat/5s · fits safe areas · reads on light+dark · one accent color · animated (not
static) end scene · platform LUFS hit. Advisory Presentation Score surfaced in-studio.
