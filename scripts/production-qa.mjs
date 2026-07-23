/**
 * PRODUCTION VALIDATION SUITE — score a REAL rendered video against the Presentation Bible.
 *
 * The rendered video is the source of truth. Given an MP4 (an RF render, or any caption-
 * over-footage clip), this extracts key frames, builds contact sheets, computes objective
 * legibility metrics, and emits a scorecard TEMPLATE (Bible dimensions + strengths/
 * weaknesses/weakest-moment/next-refinement) for the reviewer to complete from the frames.
 * Optionally diffs against a previous approved render (SSIM) → improved/unchanged/regressed.
 *
 * Usage:  node scripts/production-qa.mjs <render.mp4> [previousApproved.mp4]
 * Output: scripts/_qa_out/prod/<name>/  — frames, contact.png, begin|middle|end.png,
 *         scorecard.md, and (if prev given) regression.md.
 *
 * Synthetic QA (presentation-qa.mjs) catches regressions BEFORE rendering; this is the real
 * acceptance test. No drawtext (fontconfig); ffmpeg run with cwd + relative paths (Windows).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const video = process.argv[2];
const prev = process.argv[3];
if (!video || !fs.existsSync(video)) {
  console.error("Usage: node scripts/production-qa.mjs <render.mp4> [previous.mp4]");
  process.exit(1);
}
const name = path.basename(video).replace(/\.[^.]+$/, "");
const OUT = path.join(__dir, "_qa_out", "prod", name);
fs.mkdirSync(OUT, { recursive: true });

const shOut = (cmd, cwd) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sh = (cmd, cwd) => { try { execSync(cmd, { cwd, stdio: ["ignore", "ignore", "ignore"] }); } catch {} };

// ── duration ─────────────────────────────────────────────────────────────────
function duration(v) {
  try {
    const o = shOut(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${v}"`);
    return parseFloat(o.trim()) || 0;
  } catch { return 0; }
}
const dur = duration(video);
if (!dur) { console.error("Could not read duration (ffprobe)."); process.exit(1); }

// ── extract an evenly-spaced grid of frames + labelled begin/middle/end ──────
const N = 9;
const stamps = Array.from({ length: N }, (_, i) => +(dur * (0.04 + 0.92 * (i / (N - 1)))).toFixed(2));
const abs = (p) => path.join(OUT, p);
stamps.forEach((t, i) => sh(`ffmpeg -y -ss ${t} -i "${video}" -frames:v 1 "${abs(`f${String(i).padStart(2, "0")}.png`)}"`));
const key = { begin: stamps[0], middle: stamps[Math.floor(N / 2)], end: stamps[N - 1] };
for (const [k, t] of Object.entries(key)) sh(`ffmpeg -y -ss ${t} -i "${video}" -frames:v 1 "${abs(k + ".png")}"`);

// ── contact sheet (3×3) ──────────────────────────────────────────────────────
const frames = stamps.map((_, i) => `f${String(i).padStart(2, "0")}.png`).filter((f) => fs.existsSync(abs(f)));
if (frames.length >= 9) {
  const ins = frames.slice(0, 9).map((f) => `-i "${f}"`).join(" ");
  sh(`ffmpeg -y ${ins} -filter_complex "[0][1][2]hstack=3[r0];[3][4][5]hstack=3[r1];[6][7][8]hstack=3[r2];[r0][r1][r2]vstack=3,scale=1080:-1" "contact.png"`, OUT);
}

// ── objective legibility metric per key frame (signalstats on the caption band) ──
function bandStats(frameAbs) {
  // Center/lower band where captions live; YAVG/YMIN/YMAX → a contrast proxy.
  try {
    const o = shOut(`ffmpeg -hide_banner -i "${frameAbs}" -vf "crop=iw:ih*0.28:0:ih*0.42,signalstats,metadata=print:file=-" -f null - 2>&1`);
    const g = (k) => { const m = o.match(new RegExp(`lavfi\\.signalstats\\.${k}=([0-9.]+)`)); return m ? +m[1] : null; };
    const yavg = g("YAVG"), ymin = g("YMIN"), ymax = g("YMAX");
    return { yavg, contrast: ymin != null && ymax != null ? ymax - ymin : null };
  } catch { return { yavg: null, contrast: null }; }
}
const stats = Object.fromEntries(Object.entries(key).map(([k]) => [k, bandStats(abs(k + ".png"))]));

// ── regression vs previous approved render (SSIM on matched frames) ──────────
let regression = "";
if (prev && fs.existsSync(prev)) {
  const pdur = duration(prev) || dur;
  const samples = [0.1, 0.5, 0.9];
  const rows = samples.map((f) => {
    const a = abs(`_new_${f}.png`), b = abs(`_old_${f}.png`);
    sh(`ffmpeg -y -ss ${(dur * f).toFixed(2)} -i "${video}" -frames:v 1 "${a}"`);
    sh(`ffmpeg -y -ss ${(pdur * f).toFixed(2)} -i "${prev}" -frames:v 1 "${b}"`);
    let ssim = null;
    try {
      const o = shOut(`ffmpeg -hide_banner -i "${a}" -i "${b}" -filter_complex ssim -f null - 2>&1`);
      const m = o.match(/All:([0-9.]+)/); ssim = m ? +m[1] : null;
    } catch {}
    const verdict = ssim == null ? "?" : ssim > 0.985 ? "unchanged" : "CHANGED (inspect: improved or regressed?)";
    return `| ${Math.round(f * 100)}% | ${ssim ?? "?"} | ${verdict} |`;
  });
  regression = `\n## Visual regression vs previous approved render\n\n| Position | SSIM | Verdict |\n|---|---|---|\n${rows.join("\n")}\n\n> SSIM ~1 = identical. A CHANGED frame must be inspected side-by-side to decide improved vs regressed — never assume.\n`;
  fs.writeFileSync(abs("regression.md"), regression);
}

// ── scorecard template (Bible dimensions; filled by inspecting the frames) ───
const dims = ["Typography", "Hierarchy", "Legibility", "Composition", "Motion", "Attention", "Emphasis", "Negative Space", "Contrast", "Premium Feel", "Subtitle Feel (lower=better)", "CTA", "Ending", "Brand Presence", "Overall Quality"];
const card = `# Production Scorecard — ${name}

Render: \`${video}\` · duration ${dur.toFixed(1)}s · ${frames.length} frames · contact.png
Objective caption-band metrics (0–255): begin YAVG ${stats.begin?.yavg ?? "?"} / contrast ${stats.begin?.contrast ?? "?"} · middle ${stats.middle?.yavg ?? "?"}/${stats.middle?.contrast ?? "?"} · end ${stats.end?.yavg ?? "?"}/${stats.end?.contrast ?? "?"}

## Scores (1–10) — fill by inspecting contact.png + begin/middle/end.png
${dims.map((d) => `- **${d}:** _/10 — `).join("\n")}

## Top 3 strengths
1.
2.
3.

## Top 3 weaknesses
1.
2.
3.

## Single weakest moment
> timestamp + what + why

## Recommended next refinement (ONE thing)
>
${regression}
> Standard: would a professional motion designer, not knowing it was AI, assume it was handcrafted for a commercial? If not, the weakest moment above is the next task.
`;
fs.writeFileSync(abs("scorecard.md"), card);
console.log("PRODUCTION QA:", OUT);
console.log("  contact:", abs("contact.png"));
console.log("  scorecard:", abs("scorecard.md"));
console.log("  band metrics:", JSON.stringify(stats));
