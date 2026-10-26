import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DARK_HC_RAMP, DARK_RAMP } from "./style";

// index.css repeats the dark ramps for the legend, guide, people grid and chart: keep them equal to the map's.
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const blocks = [...css.matchAll(/\.seq-ramp \{([^}]*)\}/g)].map((m) => [...(m[1] ?? "").matchAll(/--chart-seq-\d: (#[0-9a-f]{6});/g)].map((x) => x[1]));

describe("dark poverty ramp", () => {
  it("is the same in index.css as on the map", () => {
    expect(blocks).toEqual([DARK_RAMP, DARK_RAMP, DARK_HC_RAMP, DARK_HC_RAMP, DARK_HC_RAMP, DARK_HC_RAMP]);
  });
});
