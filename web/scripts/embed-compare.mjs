#!/usr/bin/env node
// Side-by-side check of two /embed builds (e.g. the live one and a local preview), as krtmtthw.dev shows them:
//   node scripts/embed-compare.mjs <before-origin> <after-origin> <out-dir> [--sheets]   (--sheets: redraw the sheets only)
// The portfolio is played by a stand-in page routed at https://krtmtthw.dev (the embed accepts only that parent):
// desktop frames 1280×800 scaled to a 611 px slot (and told its scale), phones show the 358×224 slot at its real
// size on an emulated iPhone 13. Writes PNGs and three JPEG contact sheets (≤ 1600 px wide, quality 70):
//   tour.jpg      every tour step, light, English: desktop and iPhone, before and after;
//   variants.jpg  the still under reduced motion, Japanese, dark, high contrast (light and dark);
//   direct.jpg    /embed opened directly at 1440×900, 1280×800 and an iPhone 13's full screen.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, devices } from "@playwright/test";

const [before, after, out, flag] = process.argv.slice(2);
if (!before || !after || !out) throw new Error("usage: embed-compare.mjs <before-origin> <after-origin> <out-dir>");
mkdirSync(out, { recursive: true });
const SIDES = { before, after };
// Chrome won't let a public page frame a local origin: a local side is framed from a stand-in https origin
// proxied to it (still a krtmtthw.dev host, as the live embed is).
const local = (o) => /^http:\/\/(127\.0\.0\.1|localhost)/.test(o);
const FRAMED = { before: local(before) ? "https://before.lights.krtmtthw.dev" : before, after: local(after) ? "https://after.lights.krtmtthw.dev" : after };
const PARENT = "https://krtmtthw.dev/__embed-compare";
const DESKTOP = { ctx: { viewport: { width: 643, height: 414 }, deviceScaleFactor: 2 }, frame: [1280, 800], slot: [611, 382] };
const PHONE = { ctx: { ...devices["iPhone 13"], viewport: { width: 390, height: 256 } }, frame: [358, 224], slot: [358, 224] };
const LAYOUTS = { desktop: DESKTOP, iphone: PHONE };

const parentHtml = (src, [fw, fh], [sw, sh]) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>body{margin:0;padding:16px;background:Canvas}#slot{width:${sw}px;height:${sh}px;overflow:hidden;position:relative;border-radius:2px}
iframe{border:0;width:${fw}px;height:${fh}px;transform-origin:0 0;transform:scale(${sw / fw})}</style>
<div id="slot"><iframe src="${src}" title="embed"></iframe></div>
<script>addEventListener("message",(e)=>{if(e.data&&e.data.type==="akari:embed-ready"){const w=document.querySelector("iframe").contentWindow,o=new URL(document.querySelector("iframe").src).origin;
w.postMessage({type:"akari:embed-scale",scale:${sw / fw}},o);w.postMessage({type:"akari:embed-resume"},o);}});</script>`;

const browser = await chromium.launch();

/** A context with the stand-in parent; `opts`: reducedMotion, colorScheme, contrast. */
async function framed(side, layout, { lang = "en", ...opts } = {}) {
  const L = LAYOUTS[layout];
  const ctx = await browser.newContext({ ...L.ctx, ...opts });
  const src = `${FRAMED[side]}/embed?year=2023&lgu=PH0907215&lang=${lang}${layout === "desktop" ? "&pr=1" : ""}`;
  if (FRAMED[side] !== SIDES[side])
    await ctx.route(`${FRAMED[side]}/**`, async (r) => {
      const u = new URL(r.request().url());
      await r.fulfill({ response: await r.fetch({ url: `${SIDES[side]}${u.pathname}${u.search}` }) });
    });
  await ctx.route(PARENT, (r) => r.fulfill({ contentType: "text/html", body: parentHtml(src, L.frame, L.slot) }));
  const page = await ctx.newPage();
  await page.goto(PARENT);
  const frame = page.frameLocator("iframe");
  await frame.locator("html[data-embed-ready]").waitFor({ state: "attached", timeout: 60_000 });
  return { ctx, page, slot: page.locator("#slot") };
}

const shot = (name) => join(out, `${name}.png`);
const cells = { tour: [], variants: [], direct: [] };
const capture = flag !== "--sheets";

if (capture) {
// The tour: every step, light, English.
for (const layout of ["desktop", "iphone"])
  for (const side of ["before", "after"]) {
    const { ctx, slot, page } = await framed(side, layout);
    const row = [];
    for (let i = 0; i < 6; i++) {
      if (i) await page.frameLocator("iframe").locator(`html[data-tour-step="${i}"]`).waitFor({ state: "attached", timeout: 30_000 });
      await page.waitForTimeout(i ? 1100 : 900); // after the fade and the settle, before the next change (2.2 s)
      await slot.screenshot({ path: shot(`tour-${layout}-${side}-${i}`) });
      row.push(`tour-${layout}-${side}-${i}`);
    }
    cells.tour.push([`${layout} · ${side}`, row]);
    await ctx.close();
  }

// Variants: stills (reduced motion).
const VARIANTS = [
  ["reduced motion", {}],
  ["Japanese", { lang: "ja" }],
  ["dark", { colorScheme: "dark" }],
  ["high contrast", { contrast: "more" }],
  ["dark, high contrast", { colorScheme: "dark", contrast: "more" }],
];
for (const [label, opts] of VARIANTS) {
  const row = [];
  for (const layout of ["desktop", "iphone"])
    for (const side of ["before", "after"]) {
      const { ctx, slot, page } = await framed(side, layout, { reducedMotion: "reduce", ...opts });
      await page.waitForTimeout(800);
      const name = `still-${label.replace(/\W+/g, "-")}-${layout}-${side}`;
      await slot.screenshot({ path: shot(name) });
      row.push(name);
      await ctx.close();
    }
  cells.variants.push([label, row]);
}

// Opened directly (no parent), at sizes other than the portfolio's frame.
for (const [label, ctxOpts] of [
  ["1440×900", { viewport: { width: 1440, height: 900 } }],
  ["1280×800", { viewport: { width: 1280, height: 800 } }],
  ["iPhone 13", { ...devices["iPhone 13"] }],
]) {
  const row = [];
  for (const side of ["before", "after"]) {
    const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const blank = [];
    page.on("console", (m) => /tile not in pack/.test(m.text()) && blank.push(m.text()));
    await page.goto(`${SIDES[side]}/embed?year=2023&lgu=PH0907215&lang=en`);
    await page.locator("html[data-embed-ready]").waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const name = `direct-${label.replace(/\W+/g, "-")}-${side}`;
    await page.screenshot({ path: shot(name) });
    console.log(`direct ${label} ${side}: ${blank.length} "tile not in pack" warnings`);
    row.push(name);
    await ctx.close();
  }
  cells.direct.push([label, row]);
}

  writeFileSync(join(out, "cells.json"), JSON.stringify(cells));
} else Object.assign(cells, JSON.parse(readFileSync(join(out, "cells.json"), "utf8")));

// Contact sheets.
const sheet = async (file, rows, heads) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 } });
  const src = (n) => `data:image/png;base64,${readFileSync(shot(n)).toString("base64")}`;
  const cols = rows[0][1].length;
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:12px;width:1576px;font:13px system-ui;background:#fff;color:#222}
  h2{font-size:13px;margin:10px 0 4px}.r{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;align-items:start}
  img{width:100%;display:block;border:1px solid #ccc}.h{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;font-size:11px;color:#666}</style>
  ${heads ? `<div class="h">${heads.map((h) => `<div>${h}</div>`).join("")}</div>` : ""}
  ${rows.map(([t, r]) => `<h2>${t}</h2><div class="r">${r.map((n) => `<img src="${src(n)}">`).join("")}</div>`).join("")}`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: join(out, file), type: "jpeg", quality: 70, fullPage: true });
  await page.close();
};
await sheet("tour.jpg", cells.tour, ["step 0 (the still)", "step 1", "step 2", "step 3", "step 4", "step 5"]);
await sheet("variants.jpg", cells.variants, ["desktop slot · before", "desktop slot · after", "iPhone slot · before", "iPhone slot · after"]);
await sheet("direct.jpg", cells.direct, ["before", "after"]);
await browser.close();
console.log(`contact sheets: ${join(out, "tour.jpg")}, variants.jpg, direct.jpg`);
