# Expressive Typography & Animated Typeface — research (from 3 references)

**Status:** Research addendum (docs 09/10). No engine adoption. Source: three
referenced YouTube pages **read** (titles/descriptions/comments — not watched; no
video ingestion): Ji Lee "Word as Image" (3.8M views) ×2, and "Franchise Animated –
An Animated Typeface" (Animography). Principles extracted, identities discarded.

## Technique A — WORD AS IMAGE (expressive / semantic typography)
A word's **motion expresses its meaning**: "grow" scales up, "shrink" scales down,
"fall/drop" moves down, "rise/lift" moves up, "split/break" separates into halves,
"spin/rotate" rotates, "shake/nervous/creepy" jitters, "stretch" widens, "squeeze"
narrows, "fade/vanish" dissolves. Read by audiences as premium "logo-intro / movie-
title" quality — the opposite of a subtitle.

**Deterministic + reproducible.** A small **expressive lexicon** maps a word → a
motion category; the motion is a libass tag we already emit. It only fires when a
caption's *emphasis/keyword* is an expressive word (a rare, high-craft accent — never
every word). Mapping:

| Meaning | Words (lexicon) | Motion | ASS |
|---|---|---|---|
| grow | grow, expand, scale, bigger, more | scale ↑ into place | `\fscx\fscy` `\t` |
| shrink | shrink, smaller, less, tiny, reduce | scale ↓ | `\fscx\fscy` `\t` |
| fall | fall, drop, down, sink, crash | move down + settle | `\move` |
| rise | rise, lift, up, soar, boost | move up | `\move` |
| split | split, break, divide, apart | two halves separate | `\clip` halves + `\move` |
| spin | spin, rotate, turn, flip | rotate in | `\frz`/`\fry` `\t` |
| shake | shake, nervous, creepy, panic, chaos | jitter | alternating `\frz`/`\move` `\t` |
| stretch | stretch, long, extend | widen | `\fscx` `\t` |
| fade | fade, vanish, disappear, gone | dissolve | `\alpha` `\t` |

→ **`reveal.express` primitive** (pure fn: word-category + box → ASS fragment) +
`lexicon.expressive`. A **Signature / Cinematic** philosophy can put `express` in its
`recipe.reveal` so its hero/keyword gets the expressive treatment; other philosophies
never use it.

## Technique B — ANIMATED TYPEFACE (per-letter build)
An animated typeface = each glyph has a built-in entrance; text **builds letter by
letter**. We do NOT adopt their font (frozen renderer / no external engine), but the
principle = **letter/character cascade**: split the word into per-character events,
each with a staggered designed entrance (rise+scale+fade, or a `\frz` flip). Expensive
(one event per char) → reserve for hero / single-word beats.

→ **`reveal.letterCascade` primitive** (word + placement + per-char timing → N
per-char ASS events). A recipe token `letterCascade` for hero reveals in
Impact/Signature/Broadcast philosophies.

## Fit with the engine
Both are Reveal primitives → recipe tokens (`express`, `letterCascade`) → composed by
philosophies. Fully libass-native (no renderer change). Sparse by design (accent on
the keyword/hero, not every beat) — consistent with the Attention rule (one focal
moment). These are exactly the "text is part of the film, designed by a motion
designer" techniques the initiative targets, and they don't depend on caption brevity.

**Limits:** true per-letter *bespoke* animation (each letter uniquely designed, like
Ji Lee's hand-crafted words) is not automatable — we approximate the *category* of
motion by meaning, not a bespoke illustration per word. That's the honest ceiling; the
categorical version is still a strong, distinctive, deterministic technique.
