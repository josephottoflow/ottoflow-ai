# Bundled premium fonts (Video Quality V3 — Modern profiles only)

Per the approved OttoFlow Premium Video Style Guide, the **Modern** render
profiles use these premium open-source faces. **Legacy is unchanged (DejaVu Sans,
system-provided).** These are **assets**, not a provider/SDK.

| File | Family (libass name) | Subfamily | Source | License |
|---|---|---|---|---|
| `Sora-Regular.ttf` / `Sora-Bold.ttf` | `Sora` | Regular / Bold | google/fonts `ofl/sora` (variable font, static-instanced at wght 400/700 via fonttools) | OFL 1.1 (`OFL-Sora.txt`) |
| `PlusJakartaSans-Regular.ttf` / `-Bold.ttf` | `Plus Jakarta Sans` | Regular / Bold | tokotype/PlusJakartaSans | OFL 1.1 (`OFL-PlusJakartaSans.txt`) |
| `IBMPlexMono-Regular.ttf` / `-Bold.ttf` | `IBM Plex Mono` | Regular / Bold | IBM/plex | OFL 1.1 (`OFL-IBMPlexMono.txt`) |

**Role mapping** (see `src/lib/ffmpeg-pipeline/typography.ts`): Sora → display /
hero / headline / CTA / button; Plus Jakarta Sans → caption / body / brand /
footer / micro; IBM Plex Mono → technical overlays only.

## Delivery to libass (finalised + validated in Phase 3)
libass resolves a face by **family name**; the family strings above match
`typography.ts`. Two supported delivery mechanisms:
1. **`fontsdir`** on the ffmpeg `ass` filter pointing at this directory (primary
   plan; works on the Linux worker where libass uses fontconfig).
2. **ASS `[Fonts]` embedding** (fallback) — most robust cross-platform, used if the
   worker's libass ignores `fontsdir`.

⚠️ **Must be validated on the Linux worker** during the first Royalty-Free render.
Local Windows ffmpeg does not honor `fontsdir` (no fontconfig), so font loading
cannot be confirmed locally. If a Modern caption falls back to DejaVu on the
worker, switch to mechanism (2). Fallback is graceful (readable, not a crash).
