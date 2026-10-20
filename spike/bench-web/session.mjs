// Runs map.html for each variant in headless Chrome (SwiftShader WebGL) and tallies .pmtiles requests per step
// from the server log. Writes session-results.jsonl and a screenshot per variant (gitignored out/).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const log = process.argv[2], variants = process.argv.slice(3);
mkdirSync("out", { recursive: true });
const b = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const v of variants) {
  const [pm, mode = "props", ...rest] = v.split(":"); const base = rest.join(":");
  writeFileSync(log, "");
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(`http://127.0.0.1:8765/bench-web/map.html?pm=${pm}&mode=${mode}${base ? `&base=${encodeURIComponent(base)}` : ""}`);
  const r = await (await p.waitForFunction(() => window.RESULT, null, { timeout: 300000 })).jsonValue();
  await p.screenshot({ path: `out/${pm}-${mode}.png` });
  await p.close();
  const rows = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const steps = {}; let cur = "pre";
  for (const x of rows) {
    if (x.p.startsWith("/__mark/")) { cur = x.p.split("/").pop(); continue; }
    if (!x.p.endsWith(".pmtiles") && !x.p.endsWith(".json")) continue;
    const s = (steps[cur] ??= { requests: 0, bytes: 0 }); s.requests++; s.bytes += x.b;
  }
  const total = Object.values(steps).reduce((a, s) => ({ requests: a.requests + s.requests, bytes: a.bytes + s.bytes }), { requests: 0, bytes: 0 });
  const out = { variant: pm, mode, ...r, steps, total, errors: errs.slice(0, 3) };
  console.log(JSON.stringify(out)); appendFileSync("session-results.jsonl", JSON.stringify(out) + "\n");
}
await b.close();
