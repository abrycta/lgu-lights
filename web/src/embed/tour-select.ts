// Chooses the /embed tour from the published data (CLAUDE.md rule 27: the richest moments, chosen from the
// data; the reduced-motion still is the densest one). Pure and deterministic: the same data gives the same tour.
// Used at build time by scripts/build-embed.mjs (Node strips the types) and reusable by any other renderer.
//
// The rule, for one year (a PSA round):
// 1. A province qualifies only when EVERY place in it has a PSA official figure that year, so the view never
//    shows a model-only figure.
// 2. Its density is how many distinct colours it puts on the map: its number of places × the spread of their
//    official figures (highest − lowest, in points), so a province of many places, high and low together,
//    beats a flat one.
// 3. Its featured place is its solid place (tier 0, CV at most 10 %) with the HIGHEST official figure, so the tour reaches the high end.
//    Ties go to a place where the light-based model, trained WITHOUT that round (kind "backtest"), put the
//    official figure inside its 90 % range, then to the smaller |model − official|, then the pcode.
// 4. One province per region: its densest (ties: the higher featured figure, then the pcode).
// 5. The high end (the knob: HIGH_VALUE, HIGH_STEPS): first up to HIGH_STEPS regions whose featured figure is
//    at least HIGH_VALUE, the densest first; then the densest other regions fill the tour up to `steps`.
// 6. The still (step 0: the first view and the reduced-motion still) is the high-end step whose province has
//    the most solid figures (ties: density, then the pcode); with no high-end step, the densest. The rest
//    follow by density, interleaved across Luzon, Visayas and Mindanao in the order each group first appears
//    (the still's group first).

/** The fields of one year of a place's file (public/data/<v>/lgu/<pcode>.json) the rule reads. */
export type TourYear = {
  official: { estimate: number; tier: number } | null;
  model: { estimate: number; kind: string; lo90: number; hi90: number } | null;
};

export type TourIndexLgu = { p: string; n: string; pv: string; r: string };
export type TourIndex = {
  lgus: TourIndexLgu[];
  provinces: { pcode: string; name: string }[];
};

export type TourPick = {
  pcode: string;
  name: string;
  province: string;
  region: string;
  /** The province's density: places × spread (rule 2). */
  density: number;
  /** Its places with a solid official figure. */
  solid: number;
  places: number;
  /** The lowest and highest official figure among its places. */
  low: number;
  highest: number;
  official: number;
  /** The model's estimate without the round, when it has one. */
  model: number | null;
};

export type Tour = { tour: string[]; still: string; picks: TourPick[] };

/** Island group of a region pcode (PSGC): Luzon, Visayas or Mindanao. */
export function islandGroup(region: string): "Luzon" | "Visayas" | "Mindanao" {
  const n = Number(region.slice(2, 4));
  if ([6, 7, 8, 18].includes(n)) return "Visayas";
  if ([9, 10, 11, 12, 15, 16, 19].includes(n)) return "Mindanao";
  return "Luzon"; // 1–5, 13 (NCR), 14 (CAR), 17 (Mimaropa)
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The knob for the high end: how many steps (if the data has them) show a figure of at least HIGH_VALUE %. */
export const HIGH_VALUE = 50;
export const HIGH_STEPS = 3;

export function chooseTour(
  index: TourIndex,
  yearOf: (pcode: string) => TourYear | undefined,
  steps = 6,
  high: { value: number; steps: number } = { value: HIGH_VALUE, steps: HIGH_STEPS },
): Tour {
  const names = new Map(index.provinces.map((p) => [p.pcode, p.name]));
  const byProvince = new Map<string, TourIndexLgu[]>();
  for (const l of index.lgus) {
    const list = byProvince.get(l.pv) ?? [];
    list.push(l);
    byProvince.set(l.pv, list);
  }

  const candidates: TourPick[] = [];
  for (const [pv, places] of byProvince) {
    const years = places.map((l) => ({ l, y: yearOf(l.p) }));
    if (!years.every(({ y }) => y?.official)) continue; // rule 1
    const values = years.map(({ y }) => y!.official!.estimate);
    const [low, highest] = [Math.min(...values), Math.max(...values)];
    const solid = years.filter(({ y }) => y!.official!.tier === 0);
    const ranked = solid
      .map(({ l, y }) => {
        const m = y!.model;
        const o = y!.official!.estimate;
        const fit = m?.kind === "backtest" && m.lo90 <= o && o <= m.hi90;
        return { l, official: o, model: m?.estimate ?? null, fit, err: m ? Math.abs(m.estimate - o) : Infinity };
      })
      .sort(
        (a, b) =>
          b.official - a.official || Number(b.fit) - Number(a.fit) || a.err - b.err || byCode(a.l.p, b.l.p),
      ); // rule 3
    const best = ranked[0];
    if (!best) continue;
    candidates.push({
      pcode: best.l.p,
      name: best.l.n,
      province: names.get(pv) ?? pv,
      region: best.l.r,
      density: Math.round(places.length * (highest - low) * 100) / 100, // rule 2
      solid: solid.length,
      places: places.length,
      low,
      highest,
      official: best.official,
      model: best.model,
    });
  }

  // Rule 4: the densest province of each region.
  const dense = (a: TourPick, b: TourPick) => b.density - a.density || b.official - a.official || byCode(a.pcode, b.pcode);
  candidates.sort(dense);
  const seen = new Set<string>();
  const perRegion = candidates.filter((c) => !seen.has(c.region) && !!seen.add(c.region));
  // Rule 5: the high end first, then the densest.
  const top = perRegion.filter((c) => c.official >= high.value).slice(0, Math.min(high.steps, steps));
  for (const c of perRegion) if (top.length < steps && !top.includes(c)) top.push(c);
  if (!top.length) throw new Error("no province qualifies for the embed tour");
  // Rule 6: the still first, then by density.
  top.sort(dense);
  const highs = top.filter((c) => c.official >= high.value);
  const still = (highs.length ? [...highs].sort((a, b) => b.solid - a.solid || dense(a, b)) : top)[0]!;
  top.splice(top.indexOf(still), 1);
  top.unshift(still);

  // Interleave the island groups (each group keeps its density order).
  const groups = new Map<string, TourPick[]>();
  for (const c of top) {
    const g = islandGroup(c.region);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const picks: TourPick[] = [];
  for (let i = 0; picks.length < top.length; i++)
    for (const list of groups.values()) if (list[i]) picks.push(list[i]!);

  return { tour: picks.map((p) => p.pcode), still: picks[0]!.pcode, picks };
}
