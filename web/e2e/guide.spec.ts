import { readFileSync } from "node:fs";

import { devices, expect, test } from "@playwright/test";

import { PACK_URL_SMALL } from "../src/embed/pack.gen";

// "How to read this map" opened from the legend on a phone: the legend sits under the map there, so the guide
// (top of the map) must be brought into view, its top below the sticky header, with focus on its heading.
// The map page needs a data version; CI has none, so the embed pack stands in for it (tiles it lacks are empty).

// The iPhone 13 profile in Chromium (CI installs only Chromium).
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["iPhone 13"];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

const pack = JSON.parse(readFileSync(new URL(`../public${PACK_URL_SMALL}`, import.meta.url), "utf8")) as {
  manifest: unknown;
  index: unknown;
  attrs: string;
  tiles: Record<string, string>;
};

test("the guide opened from the legend scrolls into view on a phone", async ({ page }) => {
  await page.route(/^[^?]*\/\/[^/]+\/data\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/data\//, "");
    if (path === "latest.json") return route.fulfill({ json: { version: "e2e", base: "e2e/" } });
    if (path === "e2e/manifest.json") return route.fulfill({ json: pack.manifest });
    if (path === "e2e/index.json") return route.fulfill({ json: pack.index });
    if (path === "e2e/tiles-attrs.csv") return route.fulfill({ body: pack.attrs, contentType: "text/csv" });
    const tile = /^e2e\/tiles\/(.+)\.pbf$/.exec(path)?.[1];
    if (tile) return route.fulfill({ body: Buffer.from(pack.tiles[tile] ?? "", "base64"), contentType: "application/x-protobuf" });
    return route.fulfill({ status: 404 });
  });
  await page.addInitScript(() => localStorage.setItem("lights.guide", "dismissed"));
  await page.goto("/");

  const open = page.getByTestId("guide-open").locator("visible=true");
  await open.scrollIntoViewIfNeeded();
  await open.click();

  const guide = page.getByTestId("guide");
  await expect(page.locator("#guide-title")).toBeFocused();
  await expect(async () => {
    const box = (await guide.boundingBox())!;
    const header = await page.locator('[data-slot="app-header"]').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect(box.y + 40).toBeLessThan(page.viewportSize()!.height);
  }).toPass();
});
