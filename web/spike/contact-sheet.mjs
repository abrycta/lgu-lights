// SPIKE (lt-embed-spike): one JPEG contact sheet (≤ 1600 px wide, quality 70) of measure-embed.mjs's step shots:
//   node spike/contact-sheet.mjs <shots-dir> [out.jpg]
// Rows: today's MapLibre embed and the SVG spike, desktop (the 1280×800 frame shown at the portfolio's ~611 px) and iPhone.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const [dir, out = join(dir, "contact-sheet.jpg")] = process.argv.slice(2);
const img = (f) => (existsSync(join(dir, f)) ? `data:image/png;base64,${readFileSync(join(dir, f)).toString("base64")}` : "");
const rows = [
  ["maplibre", "desktop", "Today (MapLibre), desktop frame"],
  ["svg", "desktop", "SVG spike, desktop frame"],
  ["maplibre", "iphone", "Today (MapLibre), iPhone slot"],
  ["svg", "iphone", "SVG spike, iPhone slot"],
];
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#fff;font:13px system-ui;color:#222;width:1576px}
h2{font-size:13px;margin:10px 0 4px} .r{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
img{width:100%;display:block;border:1px solid #ccc} figcaption{font-size:11px;color:#666}
</style>${rows
  .map(
    ([p, d, t]) =>
      `<h2>${t}</h2><div class="r">${[0, 1, 2, 3, 4, 5].map((i) => `<figure style="margin:0"><img src="${img(`${p}-${d}-${i}.png`)}"><figcaption>step ${i}</figcaption></figure>`).join("")}</div>`,
  )
  .join("")}`;
const b = await chromium.launch();
const tab = await b.newPage({ viewport: { width: 1600, height: 400 } });
await tab.setContent(html);
await tab.screenshot({ path: out, type: "jpeg", quality: 70, fullPage: true });
await b.close();
console.log(out);
