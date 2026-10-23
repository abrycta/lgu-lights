import { describe, expect, it } from "vitest";

import type { LguDetail, YearRecord } from "@/data/types";

import {
  changeSentence,
  changeTest,
  changeWindow,
  clearChanges,
  comparisonSentence,
  freq,
  headline,
  parseAttrsCsv,
  peopleCells,
  provinceAverage,
  reliabilitySentence,
  shareBelow,
  whatIfExplanation,
  whyModelSentence,
} from "./plain";

const off = (year: number, estimate: number, se: number, estimator = year >= 2021 ? "CensusEB" : "ELL"): YearRecord => ({
  year,
  official: { estimate, se, cv: (se / estimate) * 100, lo90: estimate - 1.645 * se, hi90: estimate + 1.645 * se, tier: 1, estimator },
  model: null,
  shown: { value: estimate, tier: 1, source: "official" },
  inputs: null,
});
const mod = (year: number, estimate: number, lo90: number, hi90: number, from: number, kind: "between" | "nowcast" | "backtest" = "nowcast"): YearRecord => ({
  year,
  official: null,
  model: { estimate, lo50: estimate - 2, hi50: estimate + 2, lo90, hi90, cv: 40, tier: 2, from, kind },
  shown: { value: estimate, tier: 2, source: "model" },
  inputs: null,
});

describe("natural frequencies", () => {
  it("uses simple fractions when close, otherwise per 100", () => {
    expect([24, 33.4, 50, 7.85, 37.9, 0.3].map((v) => freq(v, "en"))).toEqual(["about 1 in 4", "about 1 in 3", "about 1 in 2", "about 8 in 100", "about 38 in 100", "fewer than 1 in 100"]);
    expect(freq(24, "ja")).toBe("約4人に1人");
  });

  it("headline says a model value is an estimate", () => {
    expect(headline(off(2023, 24, 3.6), 2023, "Tagbilaran City (Capital)", "en")).toBe(
      "About 1 in 4 people in Tagbilaran City lived below the poverty line in 2023 (likely between 18 and 30 in every 100).",
    );
    expect(headline(mod(2025, 24, 10, 40, 2023), 2025, "Adams", "en")).toMatch(/^Lights estimates that about 1 in 4 people in Adams/);
  });

  it("reliability in plain words", () => {
    expect(reliabilitySentence(2, 9.6, 40.2, "en")).toBe("Wide range: the true figure could be anywhere from 10 to 40 in 100.");
  });
});

describe("change rule", () => {
  it("calls a change real only beyond 1.645·√(SE₁²+SE₂²)", () => {
    expect(changeTest({ year: 2021, est: 30, se: 2 }, { year: 2023, est: 24, se: 2 }).kind).toBe("down"); // 6 > 4.65
    expect(changeTest({ year: 2021, est: 30, se: 2 }, { year: 2023, est: 26, se: 2 }).kind).toBe("unclear"); // 4 < 4.65
    expect(changeTest({ year: 2018, est: 40, se: 1 }, { year: 2021, est: 20, se: 1 }).kind).toBe("notComparable");
  });

  it("phrases the result and never compares across the method change", () => {
    const years = [off(2018, 40, 1), off(2021, 30, 2), off(2023, 24, 2)];
    expect(changeSentence(years, years[2], "en")).toBe("Since PSA's 2021 figure: down from 30 to 24 in 100. That's bigger than the margin of error, so the fall is likely real.");
    expect(changeSentence(years, years[1], "en")).toMatch(/aren't strictly comparable/);
    expect([...clearChanges(years)]).toEqual([[2023, "down"]]);
  });

  it("compares a model year with the round it starts from", () => {
    const years = [off(2023, 24, 2), mod(2025, 25, 10, 40, 2023)];
    expect(changeSentence(years, years[1], "en")).toMatch(/^Since PSA's 2023 figure: up from 24 to 25 in 100, but that's within the margin of error/);
  });

  it("province window stays inside one method era", () => {
    const rounds = [2012, 2015, 2018, 2021, 2023];
    expect(changeWindow(rounds, 2025)).toEqual({ from: 2021, to: 2023 });
    expect(changeWindow(rounds, 2018)).toEqual({ from: 2012, to: 2018 });
    expect(changeWindow(rounds, 2022)).toEqual({ methodBreak: 2021 });
    expect(changeWindow(rounds, 2013)).toBeNull();
  });
});

describe("comparison", () => {
  it("ranks among same-source places and names the source", () => {
    const others = Array.from({ length: 100 }, (_, i) => i / 2); // 0..49.5
    expect(shareBelow(35, others)).toBe(0.7);
    expect(comparisonSentence({ value: 35, lo: 28, hi: 42, source: "official", year: 2023, others, province: { name: "Bohol", mean: 19.2, n: 47 } }, "en")).toBe(
      "Higher than 7 in 10 towns and cities in the country, and above the Bohol average of 19 in 100 (comparing PSA official figures for 2023).",
    );
    expect(comparisonSentence({ value: 20, lo: 10, hi: 40, source: "model", year: 2025, others: [], province: { name: "Bohol", mean: 19, n: 47 } }, "en")).toBe(
      "Within the margin of error of the Bohol average of 19 in 100 (comparing Lights model estimates for 2025).",
    );
  });

  it("weights the province average by population when every place has it", () => {
    const lgu = (v: number, pop: number | null): LguDetail => ({
      pcode: "x", psgc: "x", name: "x", province: { pcode: "p", name: "P" }, region: { pcode: "r", name: "R" }, class: "municipality", area_km2: 1,
      years: [{ ...off(2023, v, 1), inputs: { radiance: null, lit: null, ndvi: null, pop } }],
    });
    expect(provinceAverage([lgu(10, 3000), lgu(30, 1000)], 2023, "official")).toEqual({ mean: 15, n: 2, weighted: true });
    expect(provinceAverage([lgu(10, 3000), lgu(30, null)], 2023, "official")).toEqual({ mean: 20, n: 2, weighted: false });
  });

  it("parses the published attribute table", () => {
    const n = parseAttrsCsv('pcode,n,v23,v24,t23,t24,s23,s24\nPH1,"A, B",17.1,,2,2,0,1\n');
    expect(n.years).toEqual([2023, 2024]);
    expect(n.tiers).toBe(true);
    expect(n.rows.get("PH1")).toEqual({ v: [17.1, null], t: [2, 2], s: [0, 1] });
    // The embed's cut-down copy: one year's value and source, no tiers.
    const e = parseAttrsCsv("pcode,n,v23,s23\nPH1,,17.1,0\n");
    expect(e.tiers).toBe(false);
    expect(e.rows.get("PH1")).toEqual({ v: [17.1], t: [null], s: [0] });
  });
});

describe("model explanation and what-if", () => {
  it("says where a model figure starts", () => {
    const years = [off(2023, 24, 2), mod(2025, 25, 10, 40, 2023)];
    expect(whyModelSentence(years, years[1], "en")).toBe(
      "PSA last measured this place in 2023. This 2025 figure starts from that one, adds the national trend and an adjustment for the province, and estimates how the place moved within its province from past PSA rounds and satellite data.",
    );
  });

  it("adapts the what-if wording to the size of the change", () => {
    expect(whatIfExplanation(24.2, 23.4, 20, 0, "en")).toBe(
      "If night lights here had grown 20 % a year faster, the estimate would move from 24 to 23 in 100 (−0.8 points). That's small, because the model relies mostly on past PSA figures, not satellites.",
    );
    expect(whatIfExplanation(24.2, 21, 30, 0, "en")).toMatch(/noticeable shift/);
    expect(whatIfExplanation(24.2, 24.2, 0, 0, "en")).toBeNull();
  });

  it("fills the 100-people picture from lower limit to estimate to upper limit", () => {
    const c = peopleCells(24, 18, 30);
    expect([c.filter((x) => x === "sure").length, c.filter((x) => x === "est").length, c.filter((x) => x === "maybe").length]).toEqual([18, 6, 6]);
  });
});
