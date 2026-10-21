import { expect, test } from "@playwright/test";

// The frozen /embed view krtmtthw.dev frames: no Header, one outbound link, a non-interactive map, the
// ready message to the parent, and nothing fetched from anywhere but the app's own origin (never /api/).
test("embed: frozen view, own origin only, ready message", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const bad: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    if (new URL(u).origin !== origin || new URL(u).pathname.startsWith("/api/")) bad.push(u);
  });
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("tile not in pack")) warnings.push(m.text());
  });
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
  const link = page.getByTestId("open-live");
  await expect(link).toHaveAttribute("href", "https://lights.krtmtthw.dev/?year=2023&lgu=PH1705101");
  await expect(link).toHaveAttribute("target", "_blank");
  // The map and panels are inert and the map has no controls: the link is the only stop for Tab.
  await expect(page.getByTestId("embed-frame")).toHaveAttribute("inert", "");
  await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).not.toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();

  expect(warnings).toEqual([]);
  expect(bad).toEqual([]);
});
