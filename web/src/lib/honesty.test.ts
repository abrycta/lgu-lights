import { describe, expect, it } from "vitest";

import { classLabels, classOf, fillStyle, MODEL_OPACITY, OFFICIAL_OPACITY, sourceLabel, tierOf } from "./honesty";

describe("classes", () => {
  it("uses step semantics with the fixed breaks", () => {
    expect([0, 9.99, 10, 19.9, 20, 39.9, 40, 100].map((v) => classOf(v))).toEqual([0, 0, 1, 1, 2, 3, 4, 4]);
    expect(classLabels()).toEqual(["< 10%", "10–20%", "20–30%", "30–40%", "≥ 40%"]);
  });
});

describe("official vs model styling", () => {
  it("never styles a model value like an official one", () => {
    for (const tier of [0, 1, 2] as const) {
      expect(fillStyle("model", tier).opacity).toBe(MODEL_OPACITY);
      expect(fillStyle("official", tier).opacity).toBe(OFFICIAL_OPACITY);
    }
    expect(MODEL_OPACITY).toBeLessThan(OFFICIAL_OPACITY);
  });

  it("hatches by tier", () => {
    expect([0, 1, 2].map((t) => fillStyle("official", t as 0 | 1 | 2).hatch)).toEqual(["none", "sparse", "dense"]);
  });

  it("labels the source with the year", () => {
    expect(sourceLabel("official", 2021, "en")).toBe("PSA official (2021)");
    expect(sourceLabel("model", 2024, "en")).toBe("Model estimate (2024)");
    expect(sourceLabel("model", 2024, "ja")).toBe("モデル推計（2024年）");
  });

  it("maps CV to tiers with the 10/20 thresholds", () => {
    expect([5, 10, 10.1, 20, 20.1, Infinity].map((cv) => tierOf(cv))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
