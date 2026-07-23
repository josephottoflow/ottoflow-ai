/**
 * PRESENTATION VALIDATION SUITE — permanent legibility/quality stress test.
 *
 * Composites a philosophy's rendered captions over the HARDEST backgrounds (the ones that
 * break text: pure white, high-contrast, noise, fractal detail) so we MEASURE legibility
 * instead of guessing. Every typography change should pass this before being accepted.
 * A design that survives the hardest synthetic conditions survives normal footage.
 *
 * Usage:  node scripts/presentation-qa.mjs <philosophyId> ["caption text"]
 *   e.g.  node scripts/presentation-qa.mjs premium "Reclaim 12 hours every week"
 * Output: scripts/_qa_out/<philosophy>_contact.png  (backgrounds × the caption, text-band
 *         crop) + the full frames. Inspect the contact sheet; score each background.
 *
 * Backgrounds are generated locally with ffmpeg lavfi (no assets needed). Real face/
 * city/landscape footage still needs the cloud RF render — this covers the legibility
 * envelope those extremes live inside.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderAss } from "../src/lib/ffmpeg-pipeline/ass-captions.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, "_qa_out");
const BG = path.join(OUT, "bg");
fs.mkdirSync(BG, { recursive: true });

const W = 1080, H = 1920;
const philosophy = process.argv[2] || "premium";
const caption = process.argv[3] || "Reclaim 12 hours every week";
const accent = process.argv[4] || "#E9C043";

const sh = (cmd, cwd) => execSync(cmd, { stdio: ["ignore", "ignore", "ignore"], cwd });

// ── the hard backgrounds (generated once, cached) ────────────────────────────
const BACKGROUNDS = {
  black: `color=c=0x000000:s=${W}x${H}`,
  white: `color=c=0xffffff:s=${W}x${H}`,
  "dark-grad": `gradients=s=${W}x${H}:c0=0x0a0a12:c1=0x2b2b33`,
  "bright-grad": `gradients=s=${W}x${H}:c0=0xd8d4c8:c1=0xffffff`,
  "hi-contrast": `gradients=s=${W}x${H}:c0=0x000000:c1=0xffffff:x0=0:y0=760:x1=${W}:y1=1160`,
  noise: `nullsrc=s=${W}x${H},geq=lum='random(1)*255':cb=128:cr=128`,
  fractal: `mandelbrot=s=${W}x${H}:rate=1`,
  overexposed: `color=c=0xf2f0ea:s=${W}x${H}`,
};

for (const [name, src] of Object.entries(BACKGROUNDS)) {
  const p = path.join(BG, `${name}.png`);
  if (!fs.existsSync(p)) sh(`ffmpeg -y -f lavfi -i "${src}" -frames:v 1 "${p}"`);
}

// ── render the caption through the engine ────────────────────────────────────
const ass = renderAss(
  [{ startMs: 0, endMs: 2600, text: caption, lineBreaks: [] }],
  { case: "sentence" },
  { width: W, height: H },
  { captionEngine: "animated", captionStyle: philosophy, accentColor: accent },
);
fs.writeFileSync(path.join(OUT, `${philosophy}.ass`), ass);

// ── composite over each background (settled frame) + crop the text band ──────
// Run ffmpeg WITH cwd=OUT and RELATIVE paths so the ass= filter path has no drive-colon
// (ffmpeg's filter parser treats ':' as an option separator — absolute Windows paths break).
const band = { y: 720, h: 420 };
const order = Object.keys(BACKGROUNDS);
const tiles = [];
for (const name of order) {
  const out = `${philosophy}_${name}.png`;
  sh(`ffmpeg -y -loop 1 -i "bg/${name}.png" -vf "ass=${philosophy}.ass,crop=${W}:${band.h}:0:${band.y}" -ss 1.4 -frames:v 1 "${out}"`, OUT);
  tiles.push(out);
}

// ── stack into a contact sheet ───────────────────────────────────────────────
const inputs = tiles.map((t) => `-i "${t}"`).join(" ");
const contact = `${philosophy}_contact.png`;
sh(`ffmpeg -y ${inputs} -filter_complex "${tiles.map((_, i) => `[${i}]`).join("")}vstack=inputs=${tiles.length},scale=720:-1" "${contact}"`, OUT);
console.log("CONTACT SHEET:", path.join(OUT, contact));
console.log("Rows (top→bottom):", order.join(" | "));
