// Spike: can a normal (headless) Chromium load PSA pages that block curl? Records title, status and xlsx links.
import { chromium } from "playwright-core";
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const b = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await b.newContext({ locale: "en-PH", timezoneId: "Asia/Manila" });
for (const u of process.argv.slice(2)) {
  const p = await ctx.newPage();
  let status = null;
  try {
    const r = await p.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 }); status = r?.status();
    await p.waitForTimeout(12000);
    const title = await p.title();
    const links = await p.$$eval("a[href]", (as) => as.map((a) => [a.textContent.trim().slice(0, 90), a.href]).filter(([, h]) => /\.(xlsx?|zip|csv|pdf)(\?|$)/i.test(h)));
    console.log(JSON.stringify({ url: u, first_status: status, title, n_file_links: links.length, links: links.slice(0, 60) }));
  } catch (e) { console.log(JSON.stringify({ url: u, first_status: status, error: String(e).slice(0, 200) })); }
  await p.close();
}
await b.close();
