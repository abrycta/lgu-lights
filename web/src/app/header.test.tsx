import { AkariProvider } from "@abrycta/akari/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LightsHeader } from "./Shell";
import type { UrlState } from "./url";

// Drift guard (Akari README): Lights renders Akari's one menu bar, once, with exactly one current page.
function render(page: UrlState["page"]) {
  return renderToStaticMarkup(
    <AkariProvider toaster={false} inlineScript={false}>
      <LightsHeader url={{ page, year: 2024, prov: null, lgu: null, lang: null }} />
    </AkariProvider>,
  );
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("LightsHeader", () => {
  it.each(["map", "about"] as const)("is Akari's header with one current page (%s)", (page) => {
    const html = render(page);
    expect(count(html, /<header[^>]*data-akari-header=""/g)).toBe(1);
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)];
    expect(current).toHaveLength(1);
    expect(current[0]?.[1]).toBe(page === "map" ? "Map" : "About &amp; method");
    expect(html).toContain('href="https://krtmtthw.dev"');
  });
});
