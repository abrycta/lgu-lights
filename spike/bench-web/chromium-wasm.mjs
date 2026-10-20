import { chromium } from "playwright-core";
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage();
await p.goto("http://127.0.0.1:8765/bench-web/wasm.html");
const r = await p.waitForFunction(() => window.RESULT, null, { timeout: 120000 });
for (const x of await r.jsonValue()) console.log(JSON.stringify(x));
await b.close();
