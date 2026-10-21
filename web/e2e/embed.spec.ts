import { expect, type Page, test } from "@playwright/test";

import { TOUR } from "../src/embed/pack.gen";

// The /embed tour krtmtthw.dev frames: no Header, nothing to focus (no link: the portfolio links out),
// a non-interactive map, the ready message to the parent, a few places in turn, and nothing fetched from
// anywhere but the app's own origin (never /api/).

// The panel's heading for each TOUR place (scripts/build-embed.mjs says why each was chosen).
const NAMES: Record<string, string> = {
  PH1705101: "Abra de Ilog",
  PH0907215: "Siayan",
  PH0604532: "Salvador Benedicto",
  PH0305416: "City of San Fernando",
  PH0803747: "Tacloban City",
  PH1102319: "City of Tagum",
};

function watch(page: Page, origin: string) {
  const bad: string[] = [];
  const warnings: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    if (new URL(u).origin !== origin || new URL(u).pathname.startsWith("/api/")) bad.push(u);
  });
  page.on("console", (m) => {
    // A tile the pack lacks, or any error (a detached tile buffer showed up as one).
    if (m.text().includes("tile not in pack") || m.type() === "error") warnings.push(m.text());
  });
  return { bad, warnings };
}

/** The frame never scrolls: no scrollbar on the page or the side panel (both clip what overflows). */
async function expectNoScrollbars(page: Page) {
  const s = await page.evaluate(() => {
    const d = document.documentElement;
    const aside = document.querySelector("aside")!;
    return {
      page: [getComputedStyle(d).overflow, getComputedStyle(document.body).overflow, innerWidth - d.clientWidth, innerHeight - d.clientHeight, scrollY],
      aside: [getComputedStyle(aside).overflowY, aside.offsetWidth - aside.clientWidth - 1], // minus its 1 px left border
    };
  });
  expect(s).toEqual({ page: ["hidden", "hidden", 0, 0, 0], aside: ["hidden", 0] });
}

test("embed: first place, own origin only, ready message", async ({ page, baseURL }) => {
  const { bad, warnings } = watch(page, new URL(baseURL!).origin);
  // Pretend to be framed: window.parent is [Replaceable], so a stub records what the page posts.
  await page.addInitScript(() => {
    const posted: unknown[] = [];
    (window as unknown as { __posted: unknown[] }).__posted = posted;
    Object.defineProperty(window, "parent", { value: { postMessage: (msg: unknown, target: string) => posted.push({ msg, target }) } });
  });

  await page.goto("/embed?year=2023&lgu=PH1705101&lang=en");
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  const posted = await page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted);
  expect(posted).toEqual([{ msg: { type: "akari:embed-ready", app: "lights" }, target: "https://krtmtthw.dev" }]);

  await expect(page.locator("[data-akari-header]")).toHaveCount(0);
  await expect(page.getByTestId("lgu-panel")).toContainText("Abra de Ilog");
  await expect(page.getByTestId("open-live")).toHaveCount(0);
  // Everything is inert and the map has no controls: Tab finds nothing to focus in the frame.
  await expect(page.getByTestId("embed-frame")).toHaveAttribute("inert", "");
  await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
  const focusable = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable]")].filter(
        (e) => !e.closest("[inert]") && e.tabIndex >= 0,
      ).length,
  );
  expect(focusable).toBe(0);
  await expectNoScrollbars(page);

  expect(warnings).toEqual([]);
  expect(bad).toEqual([]);
});

test("embed: tours every place and loops, each fully packed", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const { bad, warnings } = watch(page, new URL(baseURL!).origin);
  await page.goto("/embed?year=2023&lgu=PH1705101&lang=en");
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  for (const [i, lgu] of [...TOUR.entries(), [0, TOUR[0]] as const]) {
    await expect(page.locator(`html[data-tour-step="${i}"]`)).toBeAttached({ timeout: 10_000 });
    await expect(page.getByTestId("lgu-panel")).toContainText(NAMES[lgu]!);
    await expectNoScrollbars(page);
  }
  expect(warnings).toEqual([]);
  expect(bad).toEqual([]);
});

test("embed: reduced motion stays on the first place", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/embed?year=2023&lgu=PH1705101&lang=en");
  await expect(page.locator("html[data-embed-ready]")).toBeAttached();
  await page.waitForTimeout(7_000); // longer than one step
  await expect(page.locator('html[data-tour-step="0"]')).toBeAttached();
  await expect(page.getByTestId("lgu-panel")).toContainText("Abra de Ilog");
});
