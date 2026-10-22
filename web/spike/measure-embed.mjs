// SPIKE (lt-embed-spike): measures today's /embed (MapLibre) against /embed-lite (SVG) on a local `vite preview`.
//   node spike/measure-embed.mjs <base-url> <out-dir> [runs]
// Per page and device: wire bytes (each response body brotli-11 compressed, as Cloudflare would serve text;
// woff2/images as-is), JS bytes, time to first contentful paint and to `data-embed-ready`, and frame pacing
// around two tour changes (requestAnimationFrame intervals; long tasks). Screenshots of every tour step.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

import { chromium, devices } from "@playwright/test";

const [base = "http://localhost:5344", out = "/tmp/embed-spike", runs = "3"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const PAGES = { maplibre: "/embed?lang=en&pr=1", svg: "/embed-lite?lang=en" };
const DEVICES = {
  // The portfolio's desktop frame: 1280×800, shown scaled to about 611 px.
  desktop: { ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, cpu: 1, net: { down: 10e6 / 8, up: 5e6 / 8, rtt: 40 } },
  // An iPhone 15 at the slot's real size (390 − 2×16 gutter = 358 wide, 16:10), 4× CPU slowdown, Lighthouse "slow 4G".
  iphone: {
    ctx: { ...devices["iPhone 15"], viewport: { width: 358, height: 224 }, screen: { width: 393, height: 852 } },
    cpu: 4,
    net: { down: 1.6e6 / 8, up: 750e3 / 8, rtt: 150 },
  },
};

const br = (buf) => brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const compressible = (type) => /javascript|css|json|html|svg|text|wasm/.test(type);

async function measure(browser, page, device, { shots }) {
  const d = DEVICES[device];
  const ctx = await browser.newContext({ ...d.ctx, reducedMotion: "no-preference" });
  const tab = await ctx.newPage();
  const cdp = await ctx.newCDPSession(tab);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: d.net.down, uploadThroughput: d.net.up, latency: d.net.rtt });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
  const bodies = [];
  tab.on("response", async (r) => {
    try {
      const b = await r.body();
      const type = r.headers()["content-type"] ?? "";
      bodies.push({ url: r.url().replace(base, ""), type, raw: b.length, wire: compressible(type) ? br(b) : b.length });
    } catch {
      /* redirects, aborted */
    }
  });
  await tab.addInitScript(() => {
    // Frame pacing and long tasks from the first frame on.
    window.__frames = [];
    window.__long = [];
    window.__steps = [];
    const loop = (t) => {
      window.__frames.push(t);
      // Tour changes (the pages set data-tour-step), seen at frame time.
      const s = document.documentElement?.dataset.tourStep;
      if (s != null && window.__steps.at(-1)?.[1] !== s) window.__steps.push([t, s]);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
    } catch {
      /* not supported */
    }
  });
  const t0 = Date.now();
  await tab.goto(base + PAGES[page], { waitUntil: "commit" });
  await tab.waitForFunction(() => "embedReady" in document.documentElement.dataset, null, { timeout: 120_000 });
  const ready = await tab.evaluate(() => performance.now());
  const fcp = await tab.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null);
  const gl = await tab.evaluate(() => {
    const c = document.createElement("canvas").getContext("webgl2");
    const e = c?.getExtension("WEBGL_debug_renderer_info");
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (shots) await tab.screenshot({ path: join(out, `${page}-${device}-0.png`) });
  // Two tour changes (and the settle after each).
  const nSteps = shots ? 6 : 3;
  for (let i = 1; i < nSteps; i++) {
    await tab.waitForFunction((n) => window.__steps.length > n, i, { timeout: 60_000 });
    if (shots) {
      await tab.waitForTimeout(2000 / (page === "maplibre" ? 1.6 : 1)); // after the fade and settle
      await tab.screenshot({ path: join(out, `${page}-${device}-${i}.png`) });
    }
  }
  if (!shots) await tab.waitForTimeout(1600);
  const { frames, long, steps } = await tab.evaluate(() => ({ frames: window.__frames, long: window.__long, steps: window.__steps }));
  await ctx.close();
  // Frame pacing in the 1.6 s after each tour change (the fade and settle), after the first.
  const intervals = [];
  for (const [ts] of steps.slice(1, 3)) {
    const f = frames.filter((t) => t >= ts - 50 && t <= ts + 1600);
    for (let i = 1; i < f.length; i++) intervals.push(f[i] - f[i - 1]);
  }
  intervals.sort((a, b) => a - b);
  const q = (p) => intervals[Math.min(intervals.length - 1, Math.floor(p * intervals.length))] ?? null;
  const tourLong = long.filter(([s]) => s > ready);
  const sum = (xs, k) => xs.filter(k).reduce((a, b) => a + b.wire, 0);
  return {
    page,
    device,
    wall: Date.now() - t0,
    fcp: fcp && Math.round(fcp),
    ready: Math.round(ready),
    gl,
    requests: bodies.length,
    wireKB: Math.round(sum(bodies, () => true) / 1024),
    jsKB: Math.round(sum(bodies, (b) => /javascript/.test(b.type)) / 1024),
    dataKB: Math.round(sum(bodies, (b) => /json|protobuf/.test(b.type)) / 1024),
    fontKB: Math.round(sum(bodies, (b) => /font|woff/.test(b.type)) / 1024),
    cssKB: Math.round(sum(bodies, (b) => /css/.test(b.type)) / 1024),
    frames: intervals.length,
    p50: q(0.5) && +q(0.5).toFixed(1),
    p95: q(0.95) && +q(0.95).toFixed(1),
    worst: intervals.length ? +intervals.at(-1).toFixed(1) : null,
    janky: intervals.filter((x) => x > 25).length,
    longTasks: tourLong.length,
    longMs: Math.round(tourLong.reduce((a, [, d]) => a + d, 0)),
    files: bodies.map((b) => `${b.wire}\t${b.raw}\t${b.type}\t${b.url}`),
  };
}

const browser = await chromium.launch({ args: ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const results = [];
for (const device of Object.keys(DEVICES))
  for (const page of Object.keys(PAGES))
    for (let r = 0; r < Number(runs); r++) {
      const res = await measure(browser, page, device, { shots: r === 0 });
      results.push(res);
      console.log(`${device}\t${page}\trun ${r}\tfcp ${res.fcp}\tready ${res.ready}\twire ${res.wireKB} kB (js ${res.jsKB}, data ${res.dataKB}, fonts ${res.fontKB}, css ${res.cssKB})\tframes ${res.frames} p50 ${res.p50} p95 ${res.p95} worst ${res.worst} >25ms ${res.janky}\tlong ${res.longTasks}/${res.longMs}ms`);
    }
await browser.close();
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1));
