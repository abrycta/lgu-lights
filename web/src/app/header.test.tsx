import { AkariProvider } from "@abrycta/akari/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LightsHeader } from "./Shell";
import { parseUrl, type UrlState } from "./url";

// Drift guard (Akari README): Lights renders Akari's one menu bar, once, with at most one current item.
function render(page: UrlState["page"]) {
  return renderToStaticMarkup(
    <AkariProvider toaster={false} inlineScript={false}>
      <LightsHeader url={{ page, year: 2024, prov: null, lgu: null, lang: null }} />
    </AkariProvider>,
  );
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("LightsHeader", () => {
  // Route table: path → the one current item (data-current, the dot) and its aria-current; unknown paths mark nothing.
  it.each([
    ["/", "", "Map", "page"],
    ["/", "?year=2023&lang=ja", "Map", "page"],
    ["/about", "", "About &amp; method", "page"],
    ["/about/", "?lang=ja", "About &amp; method", "page"],
    ["/nope", "", null, null],
    ["/about/x", "", null, null],
  ] as const)("%s%s → %s", (path, search, label, aria) => {
    const html = render(parseUrl(path, search).page);
    expect(count(html, /<header[^>]*data-akari-header=""/g)).toBe(1);
    const current = [...html.matchAll(/<a [^>]*aria-current="([^"]+)"[^>]*data-current=""[^>]*>([^<]*)<\/a>/g)];
    expect(count(html, /data-current=""/g)).toBe(label ? 1 : 0);
    expect(count(html, /aria-current=/g)).toBe(label ? 1 : 0);
    if (label) expect([current[0]?.[2], current[0]?.[1]]).toEqual([label, aria]);
    expect(html).toContain('href="https://krtmtthw.dev"');
  });
});
