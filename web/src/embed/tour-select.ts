// Chooses the /embed tour from the published data (CLAUDE.md rule 27: the richest moments, chosen from the
// data; the reduced-motion still is the densest one). Pure and deterministic: the same data gives the same tour.
// Used at build time by scripts/build-embed.mjs (Node strips the types) and reusable by any other renderer.
//
// The rule, for one year (a PSA round):
// 1. A province qualifies only when EVERY place in it has a PSA official figure that year, so the view never
//    shows a model-only figure.
// 2. Its density is the number of its places whose official figure is solid (tier 0, CV at most 10 %).
// 3. Its featured place is one of those solid places where the light-based model, trained WITHOUT that round
//    (kind "backtest"), still put the official figure inside its 90 % range; of those, the one it came
//    closest to (smallest |model − official|, then the pcode). A province with no such place does not qualify.
// 4. One province per region (its densest), the regions ranked by that density (ties: the pcode); the top
//    `steps` make the tour, interleaved across Luzon, Visayas and Mindanao in the order each group first
//    appears, so step 0 is always the densest province: the reduced-motion still.

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
  /** The province's density: places with a solid official figure. */
  solid: number;
  places: number;
  official: number;
  model: number;
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

export function chooseTour(
  index: TourIndex,
  yearOf: (pcode: string) => TourYear | undefined,
  steps = 6,
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
    const solid = years.filter(({ y }) => y!.official!.tier === 0); // rule 2
    const fits = solid
      .filter(({ y }) => {
        const m = y!.model;
        const o = y!.official!.estimate;
        return m?.kind === "backtest" && m.lo90 <= o && o <= m.hi90;
      })
      .map(({ l, y }) => ({
        l,
        official: y!.official!.estimate,
        model: y!.model!.estimate,
        err: Math.abs(y!.model!.estimate - y!.official!.estimate),
      }))
      .sort((a, b) => a.err - b.err || byCode(a.l.p, b.l.p)); // rule 3
    const best = fits[0];
    if (!best) continue;
    candidates.push({
      pcode: best.l.p,
      name: best.l.n,
      province: names.get(pv) ?? pv,
      region: best.l.r,
      solid: solid.length,
      places: places.length,
      official: best.official,
      model: best.model,
    });
  }

  // Rule 4: the densest province of each region, then the top regions.
  candidates.sort((a, b) => b.solid - a.solid || byCode(a.pcode, b.pcode));
  const seen = new Set<string>();
  const top: TourPick[] = [];
  for (const c of candidates) {
    if (seen.has(c.region)) continue;
    seen.add(c.region);
    top.push(c);
    if (top.length === steps) break;
  }
  if (!top.length) throw new Error("no province qualifies for the embed tour");

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
