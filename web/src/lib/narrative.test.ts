import { describe, expect, it } from "vitest";

import type { YearRecord } from "@/data/types";

import { backtestNote, narrative } from "./narrative";

const model: YearRecord = {
  year: 2024,
  official: null,
  model: { estimate: 18, lo50: 15, hi50: 21, lo90: 12, hi90: 24, cv: 15, tier: 1, from: 2023, kind: "nowcast" },
  shown: { value: 18, tier: 1, source: "model" },
  inputs: null,
};

const official: YearRecord = {
  year: 2021,
  official: { estimate: 17.09, se: 10.65, cv: 62.3, lo90: -0.43, hi90: 34.61, tier: 2, estimator: "CensusEB" },
  model: { estimate: 14.2, lo50: 10, hi50: 18, lo90: 5.1, hi90: 23.3, cv: 30, tier: 2, from: 2018, kind: "backtest" },
  shown: { value: 17.09, tier: 2, source: "official" },
  inputs: null,
};

describe("narrative", () => {
  it("speaks the interval and the tier and says a model value is not official (EN)", () => {
    expect(narrative(model, 2024, "Adams", "en")).toBe(
      "In 2024 the model estimates poverty in Adams at 18.0 % (90 % interval 12.0–24.0 %). This is an estimate, not an official figure; reliability: “Use with care”. It builds on the 2023 PSA round and satellite data (night lights, vegetation) since then.",
    );
  });

  it("does the same in Japanese", () => {
    const s = narrative(model, 2024, "Adams", "ja");
    expect(s).toContain("90%区間 12.0〜24.0%");
    expect(s).toContain("公式統計ではありません");
    expect(s).toContain("注意して使う値");
  });

  it("labels official figures, clamps a negative lower limit and names the estimator", () => {
    const s = narrative(official, 2021, "Adams", "en");
    expect(s).toContain("official figure");
    expect(s).toContain("0.0–34.6");
    expect(s).toContain("Census EB");
    expect(s).toContain("Rough guess");
  });

  it("says when there is no estimate", () => {
    expect(narrative(undefined, 2012, "Adams", "en")).toBe("There is no estimate for Adams in 2012.");
  });

  it("adds the backtest line only for backtest years", () => {
    expect(backtestNote(official, "en")).toBe("Without this round the model would have said 14.2 % (90 % interval 5.1–23.3 %, from 2018 data).");
    expect(backtestNote(model, "en")).toBeNull();
  });
});
