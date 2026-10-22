import { expect, type Page, test } from "@playwright/test";

import { TOUR } from "../src/embed/pack.gen";

// The /embed tour krtmtthw.dev frames (src/embed, drawn as SVG): nothing to focus (no link: the portfolio links
// out), the ready message to the parent, the places in turn every 2.2 s, a full map at any frame size, and nothing
// fetched from anywhere but the app's own origin (never /api/, never MapLibre).

// The caption's place for each TOUR place (chosen from the data by src/embed/tour-select.ts; re-check after a data release).
const NAMES: Record<string, string> = {
  PH0907215: "Siayan",
  PH1400125: "Tineg",
  PH0704607: "Bindoy",
  PH1908825: "Guindulungan",
  PH0501714: "Garchitorena",
  PH0301424: "Doña Remedios Trinidad",
};
const STILL = TOUR[0];

function watch(page: Page, origin: string) {
  const bad: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    const { origin: o, pathname } = new URL(u);
    if (o !== origin || pathname.startsWith("/api/") || /maplibre|\/tiles\//.test(pathname)) bad.push(u);
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { bad, errors };
}

/** The frame never scrolls, and the map is drawn: the province fitted inside the map box, with its places filled. */
async function expectFullMap(page: Page) {
  const s = await page.evaluate(() => {
    const d = document.documentElement;
    const map = document.querySelector(".map")!.getBoundingClientRect();
    const svgs = [...document.querySelectorAll<SVGSVGElement>(".map svg")];
    const svg = svgs[svgs.length - 1]!;
    const prov = svg.querySelector(".prov-sel")!.getBoundingClientRect();
    const fills = svg.querySelectorAll("path.off, path.mod").length;
    const inside = prov.width > 20 && prov.left >= map.left - 1 && prov.right <= map.right + 1 && prov.top >= map.top - 1 && prov.bottom <= map.bottom + 1;
    return { scroll: [innerWidth - d.clientWidth, innerHeight - d.clientHeight, scrollY], map: map.width > 100 && map.height > 100, inside, filled: fills > 0 };
  });
  expect(s).toEqual({ scroll: [0, 0, 0], map: true, inside: true, filled: true });
}

const caption = (page: Page) => page.locator(".card").last();

test("embed: first place, own origin only, ready message, nothing to focus", async ({ page, baseURL }) => {
  const { bad, errors } = watch(page, new URL(baseURL!).origin);
  // Pretend to be framed: window.parent is [Replaceable], so a stub records what the page posts.
  await page.addInitScript(() => {
    const posted: unknown[] = [];
    (window as unknown as { __posted: unknown[] }).__posted = posted;
    Object.defineProperty(window, "parent", { value: { postMessage: (msg: unknown, target: string) => posted.push({ msg, target }) } });
  });
  // Start still (?paused=1, as the parent does), so the tour cannot move past the first place on a slow runner.
  await page.goto(`/embed?lang=en&paused=1`);
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  await expect(page.locator(".glyph-seal")).toBeHidden();
  const posted = await page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted);
  expect(posted).toEqual([{ msg: { type: "akari:embed-ready", app: "lights" }, target: "https://krtmtthw.dev" }]);
  await expect(caption(page).locator(".name")).toHaveText(NAMES[STILL]!);
  await expect(page.locator("html")).toHaveAttribute("data-tour-step", "0");
  await expect(page.getByTestId("embed-frame")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
  expect(await page.locator("a[href], button, input, select, textarea, [tabindex]").count()).toBe(0);
  await expectFullMap(page);
  expect(errors).toEqual([]);
  expect(bad).toEqual([]);
});

test("embed: the glyph seal holds until the first place is drawn", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/embed-data/**", async (r) => (await held, r.continue()));
  await page.goto(`/embed?lang=en`);
  await expect(page.locator(".glyph-seal")).toBeVisible();
  await expect(page.locator(".glyph-seal")).toHaveText("光");
  release();
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  await expect(page.locator(".glyph-seal")).toBeHidden();
});

test("embed: tours every place every 2.2 s and loops", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const { bad, errors } = watch(page, new URL(baseURL!).origin);
  // Each step change, timed in the page (the test's own polling would blur it).
  await page.addInitScript(() => {
    const at: [number, string][] = ((window as unknown as { __steps: [number, string][] }).__steps = []);
    new MutationObserver(() => {
      const s = document.documentElement.dataset.tourStep;
      if (s != null && at[at.length - 1]?.[1] !== s) at.push([performance.now(), s]);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-tour-step"] });
  });
  await page.goto(`/embed?lang=en`);
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  for (const [i, lgu] of [...TOUR.entries(), [0, TOUR[0]] as const]) {
    await expect(page.locator(`html[data-tour-step="${i}"]`)).toBeAttached({ timeout: 10_000 });
    await expect(caption(page).locator(".name")).toContainText(NAMES[lgu]!);
    await expectFullMap(page);
  }
  const at = (await page.evaluate(() => (window as unknown as { __steps: [number, string][] }).__steps)).map(([t]) => t);
  // From step 1 on (step 0's clock starts with the first painted frame, after its DOM is written).
  const gaps = at.slice(2).map((t, i) => Math.round(t - at[i + 1]!));
  expect(gaps.length, gaps.join()).toBeGreaterThanOrEqual(TOUR.length - 1);
  expect(Math.min(...gaps), gaps.join()).toBeGreaterThan(2_100);
  expect(Math.max(...gaps), gaps.join()).toBeLessThan(3_000);
  expect(errors).toEqual([]);
  expect(bad).toEqual([]);
});

test("embed: reduced motion stays on the still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/embed?lang=en`);
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  await page.waitForTimeout(5_000); // longer than two steps
  await expect(page.locator('html[data-tour-step="0"]')).toBeAttached();
  await expect(caption(page).locator(".name")).toHaveText(NAMES[STILL]!);
});

// Desktop: the portfolio frames 1280×800 scaled to its slot and sends the scale; the panel's type is Akari's steps
// divided by it, so the reader sees the steps themselves (never smaller).
test("embed, desktop: type in Akari's steps at the reader's size", async ({ page }) => {
  await page.goto(`/embed?lang=en&paused=1`);
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  const sizes = () =>
    page.evaluate(() =>
      [".name", ".value", ".sentence", ".where", ".credit"].map((s) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize)),
    );
  expect(await sizes()).toEqual([18, 30, 12, 11, 11]);
  await page.evaluate(() => document.documentElement.style.setProperty("--embed-scale", "0.5"));
  expect(await sizes()).toEqual([36, 60, 24, 22, 22]);
});

// The parent (krtmtthw.dev) starts the frame still (?paused=1) and pauses or resumes it by message: a stand-in
// parent page on the real origin frames the local build. Messages from any other origin are ignored.
test("embed: the parent pauses and resumes the tour, and only the parent", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  // Both on public https origins (Chrome won't let a public page frame 127.0.0.1): the app's is proxied to the build.
  const app = "https://lights.krtmtthw.dev";
  await page.route(`${app}/**`, async (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ response: await r.fetch({ url: `${baseURL}${u.pathname}${u.search}` }) });
  });
  const src = `${app}/embed?lang=en&paused=1`;
  await page.route("https://krtmtthw.dev/", (r) =>
    r.fulfill({ contentType: "text/html", body: `<!doctype html><iframe src="${src}" width="1280" height="800"></iframe>` }),
  );
  await page.goto("https://krtmtthw.dev/");
  const embed = page.frameLocator("iframe");
  const html = embed.locator("html");
  await expect(html).toHaveAttribute("data-embed-ready", /.*/, { timeout: 20_000 });
  const send = (type: string, origin = app) =>
    page.evaluate(([t, o]) => document.querySelector("iframe")!.contentWindow!.postMessage({ type: t }, o!), [type, origin]);
  await page.waitForTimeout(3_000); // longer than one step
  await expect(html).toHaveAttribute("data-tour-step", "0");
  await send("akari:embed-resume");
  await expect(html).toHaveAttribute("data-tour-step", "1", { timeout: 10_000 });
  await send("akari:embed-pause");
  await expect(html).toHaveAttribute("data-embed-paused", "");
  const held = await html.getAttribute("data-tour-step");
  await page.waitForTimeout(3_000);
  await expect(html).toHaveAttribute("data-tour-step", held!);
  // A message from the frame itself (not the parent) is ignored.
  await embed.locator("html").evaluate(() => window.postMessage({ type: "akari:embed-resume" }, "*"));
  await page.waitForTimeout(3_000);
  await expect(html).toHaveAttribute("data-tour-step", held!);
});

// Phones and tablets: krtmtthw.dev gives the frame its picture slot's real size (16:10, measured on the site:
// 358×224 on a 390 px phone, 736×460 at 768 px, the frame 1 px inside). The compact layout: the map over a
// two-line caption at a readable size, never the desktop view scaled down.
for (const { name, viewport } of [
  { name: "phone", viewport: { width: 356, height: 222 } },
  { name: "tablet", viewport: { width: 734, height: 458 } },
]) {
  test(`embed, compact (${name}): map and caption, tours every place`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { bad, errors } = watch(page, new URL(baseURL!).origin);
    await page.goto(`/embed?lang=en`);
    await expect(page.locator("html[data-embed-ready]")).toBeAttached();
    await expect(caption(page).locator(".name")).toBeHidden();
    await expect(caption(page).locator(".c-line.two")).toContainText("below the poverty line");
    // Readable at the slot's real size: 14 px place, 12 px figure line; the credit at Akari's smallest step.
    const sizes = await page.evaluate(() => [".c-line.one", ".c-line.two", ".credit"].map((s) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize)));
    expect(sizes).toEqual([14, 12, 11]);
    const map = await page.locator(".map").boundingBox();
    expect(map!.height).toBeGreaterThan(viewport.height * 0.6);
    for (const [i, lgu] of [...TOUR.entries(), [0, TOUR[0]] as const]) {
      await expect(page.locator(`html[data-tour-step="${i}"]`)).toBeAttached({ timeout: 10_000 });
      await expect(caption(page).locator(".c-line.one")).toContainText(NAMES[lgu]!);
      await expectFullMap(page);
    }
    expect(errors).toEqual([]);
    expect(bad).toEqual([]);
  });
}

// Opened at any size (not only the portfolio's frames), every place draws a full map: the pack is geometry, not tiles.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`embed: a full map at ${viewport.width}×${viewport.height}, every place`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto(`/embed?lang=en`);
    await expect(page.locator("html[data-embed-ready]")).toBeAttached();
    for (let i = 0; i < TOUR.length; i++) {
      await expect(page.locator(`html[data-tour-step="${i}"]`)).toBeAttached({ timeout: 10_000 });
      await expectFullMap(page);
    }
  });
}
