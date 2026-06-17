const sharp = require("sharp");
const fs = require("fs");
(async () => {
  // Logo: 800x260 transparent PNG, rounded teal rect + wordmark
  const logoSvg = `<svg width="800" height="260" xmlns="http://www.w3.org/2000/svg">
    <rect x="20" y="40" width="180" height="180" rx="40" fill="#14b8a6"/>
    <circle cx="110" cy="130" r="54" fill="#ffffff"/>
    <text x="240" y="160" font-family="Arial" font-size="96" font-weight="800" fill="#0f766e">OTTO</text>
  </svg>`;
  await sharp(Buffer.from(logoSvg)).png().toFile(".smoke-assets/logo.png");

  // Founder headshot: 640x640 — simple stylized portrait placeholder (valid image)
  const headSvg = `<svg width="640" height="640" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#cbd5e1"/><stop offset="100%" stop-color="#94a3b8"/></linearGradient></defs>
    <rect width="640" height="640" fill="url(#bg)"/>
    <circle cx="320" cy="250" r="120" fill="#475569"/>
    <ellipse cx="320" cy="560" rx="200" ry="160" fill="#475569"/>
  </svg>`;
  await sharp(Buffer.from(headSvg)).png().toFile(".smoke-assets/founder.png");

  const a = fs.statSync(".smoke-assets/logo.png").size;
  const b = fs.statSync(".smoke-assets/founder.png").size;
  console.log("logo.png", a, "founder.png", b);
})();
