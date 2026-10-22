import { describe, expect, it } from "vitest";

import { chooseTour, islandGroup, type TourIndex, type TourYear } from "./tour-select";

const off = (estimate: number, tier = 0, model = estimate, kind = "backtest"): TourYear => ({
  official: { estimate, tier },
  model: { estimate: model, kind, lo90: model - 10, hi90: model + 10 },
});

// Provinces (pcode = region + 3 digits): solid counts decide density.
function data(spec: Record<string, { r: string; years: TourYear[] }>) {
  const index: TourIndex = { lgus: [], provinces: [] };
  const years = new Map<string, TourYear>();
  for (const [pv, { r, years: ys }] of Object.entries(spec)) {
    index.provinces.push({ pcode: pv, name: `P${pv}` });
    ys.forEach((y, i) => {
      const p = `${pv}${String(i + 1).padStart(2, "0")}`;
      index.lgus.push({ p, n: `L${p}`, pv, r });
      years.set(p, y);
    });
  }
  return { index, yearOf: (p: string) => years.get(p) };
}

describe("chooseTour", () => {
  it("skips provinces with any model-only place, and the densest is the still", () => {
    const { index, yearOf } = data({
      PH08001: { r: "PH08", years: [off(10), off(20), off(30), { official: null, model: null }] },
      PH07001: { r: "PH07", years: [off(10), off(20)] },
      PH05001: { r: "PH05", years: [off(10), off(20), off(30, 1)] },
    });
    const t = chooseTour(index, yearOf);
    expect(t.picks.map((p) => p.province)).toEqual(["PPH05001", "PPH07001"]);
    expect(t.still).toBe(t.tour[0]);
    expect(t.picks.every((p) => p.region !== "PH08")).toBe(true);
  });

  it("features the highest solid figure; the backtest's 90 % fit only breaks ties", () => {
    const { index, yearOf } = data({
      PH03001: {
        r: "PH03",
        years: [off(20, 0, 23), off(20, 0, 20.5), off(70, 1), off(20, 0, 40), off(10, 0)],
      },
    });
    // 70 is not solid (tier 1); of the solid 20s, two fit the backtest's range and 20.5 is closer.
    expect(chooseTour(index, yearOf).tour).toEqual(["PH0300102"]);
    const { index: i2, yearOf: y2 } = data({ PH03001: { r: "PH03", years: [off(20), off(30, 0, 60)] } });
    expect(chooseTour(i2, y2).picks[0]!.official).toBe(30); // outside its range, still the highest
  });

  it("ranks provinces by places × spread, one per region, interleaving the island groups", () => {
    // k places from 10 % up in steps of 5: density k × 5(k − 1).
    const n = (k: number) => Array.from({ length: k }, (_, i) => off(10 + 5 * i));
    const { index, yearOf } = data({
      PH01001: { r: "PH01", years: n(9) },
      PH01002: { r: "PH01", years: n(8) }, // same region: dropped
      PH03001: { r: "PH03", years: n(7) },
      PH07001: { r: "PH07", years: n(6) },
      PH10001: { r: "PH10", years: n(5) },
      PH06001: { r: "PH06", years: n(4) },
      PH09001: { r: "PH09", years: [off(20), off(20)] }, // flat: density 0
    });
    const t = chooseTour(index, yearOf, 4, { value: 50, steps: 0 });
    expect(t.picks.map((p) => [p.province, islandGroup(p.region)])).toEqual([
      ["PPH01001", "Luzon"],
      ["PPH07001", "Visayas"],
      ["PPH10001", "Mindanao"],
      ["PPH03001", "Luzon"],
    ]);
    expect(t.still).toBe(t.tour[0]);
  });

  it("reaches the high end: up to `steps` regions at or above the value come first", () => {
    const n = (k: number, top = 40) => Array.from({ length: k }, (_, i) => off(top - i));
    const { index, yearOf } = data({
      PH01001: { r: "PH01", years: n(20) },
      PH05001: { r: "PH05", years: n(18) },
      PH07001: { r: "PH07", years: n(16) },
      PH09001: { r: "PH09", years: [off(30), off(62)] }, // sparse but high
      PH14001: { r: "PH14", years: [off(30), off(55)] },
    });
    const t = chooseTour(index, yearOf, 3, { value: 50, steps: 2 });
    expect(t.picks.map((p) => p.official).sort()).toEqual([40, 55, 62]);
    // The still is a high-end step: the one with the most solid figures (tie: density 2 × 32 beats 2 × 25).
    expect(t.still).toBe("PH0900102");
    expect(t.tour[0]).toBe(t.still);
  });

  it("is deterministic and fails loudly when nothing qualifies", () => {
    const { index, yearOf } = data({ PH05001: { r: "PH05", years: [off(10, 1)] } });
    expect(() => chooseTour(index, yearOf)).toThrow(/no province/);
  });
});
