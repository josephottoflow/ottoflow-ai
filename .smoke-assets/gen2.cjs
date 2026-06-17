const sharp=require("sharp");
(async()=>{
  const logo=`<svg width="160" height="60" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="44" height="44" rx="10" fill="#14b8a6"/><circle cx="26" cy="30" r="13" fill="#fff"/><text x="58" y="42" font-family="Arial" font-size="30" font-weight="800" fill="#0f766e">OTTO</text></svg>`;
  await sharp(Buffer.from(logo)).png({compressionLevel:9,palette:true}).toFile(".smoke-assets/logo.png");
  const head=`<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="120" fill="#94a3b8"/><circle cx="60" cy="46" r="24" fill="#475569"/><ellipse cx="60" cy="108" rx="40" ry="32" fill="#475569"/></svg>`;
  await sharp(Buffer.from(head)).png({compressionLevel:9,palette:true}).toFile(".smoke-assets/founder.png");
  const fs=require("fs");
  console.log("LOGO_B64::"+fs.readFileSync(".smoke-assets/logo.png").toString("base64"));
  console.log("FOUNDER_B64::"+fs.readFileSync(".smoke-assets/founder.png").toString("base64"));
})();
