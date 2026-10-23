// How official figures and model estimates are told apart, in one place: the map, the legend, the
// table, the chart and the narrative all read these decisions, so a model value can never be styled
// like an official one in one view and not in another.

import type { Source, Tier } from "@/data/types";

export type Lang = "en" | "ja";
type Bi = { en: string; ja: string };

/** Fixed class breaks (manifest.breaks), the same for every year, map, legend and table. */
export const DEFAULT_BREAKS = [10, 20, 30, 40] as const;

/** Class index 0..breaks.length for a value (step semantics: a value equal to a break goes up). */
export function classOf(value: number, breaks: readonly number[] = DEFAULT_BREAKS): number {
  let c = 0;
  for (const b of breaks) if (value >= b) c++;
  return c;
}

/** Legend labels for the classes: "< 10", "10–20", ..., "≥ 40". */
export function classLabels(breaks: readonly number[] = DEFAULT_BREAKS): string[] {
  const out = [`< ${breaks[0]}%`];
  for (let i = 1; i < breaks.length; i++) out.push(`${breaks[i - 1]}–${breaks[i]}%`);
  out.push(`≥ ${breaks[breaks.length - 1]}%`);
  return out;
}

/** Reliability tiers in plain words (CV ≤ 10 %, ≤ 20 %, above): Solid, Moderate range, Wide range. */
export const TIER_LABEL: Record<Tier, Bi> = {
  0: { en: "Solid", ja: "確かな値" },
  1: { en: "Moderate range", ja: "幅がやや広い値" },
  2: { en: "Wide range", ja: "幅が広い値" },
};

/**
 * Plain names for the colour classes, matched to the fixed breaks [10, 20, 30, 40]: Low (< 10),
 * Moderate (10–20), High (20–40, two colour steps), Very high (≥ 40). `span` is how many colour
 * classes each name covers, so the legend can line the names up under the ramp.
 */
export const PLAIN_BINS: { name: { en: string; ja: string }; range: { en: string; ja: string }; span: number }[] = [
  { name: { en: "Low", ja: "低い" }, range: { en: "under 10 in 100", ja: "100人に10人未満" }, span: 1 },
  { name: { en: "Moderate", ja: "中程度" }, range: { en: "10–20", ja: "10〜20人" }, span: 1 },
  { name: { en: "High", ja: "高い" }, range: { en: "20–40", ja: "20〜40人" }, span: 2 },
  { name: { en: "Very high", ja: "非常に高い" }, range: { en: "40+", ja: "40人以上" }, span: 1 },
];

/** First year of PSA's Census EB small-area method (ELL before), from config/rounds.json. */
export { CENSUS_EB_FROM } from "./rounds";

/** "PSA official (2021)" / "Model estimate (2024)". */
export function sourceLabel(source: Source, year: number, lang: Lang): string {
  if (source === "official") return lang === "ja" ? `PSA公式統計（${year}年）` : `PSA official (${year})`;
  return lang === "ja" ? `モデル推計（${year}年）` : `Model estimate (${year})`;
}

export interface FillStyle {
  /** Fill opacity: model estimates are lighter (desaturated against the ground) than official figures. */
  opacity: number;
  /** Hatching over the fill: none for reliable, sparse for "use with caution", dense for unreliable. */
  hatch: "none" | "sparse" | "dense";
}

export const OFFICIAL_OPACITY = 0.92;
export const MODEL_OPACITY = 0.55;

export function fillStyle(source: Source, tier: Tier): FillStyle {
  return {
    opacity: source === "official" ? OFFICIAL_OPACITY : MODEL_OPACITY,
    hatch: tier === 2 ? "dense" : tier === 1 ? "sparse" : "none",
  };
}

/** Coefficient of variation to tier, with the manifest's thresholds (CV in %). */
export function tierOf(cv: number, reliableMax = 10, cautionMax = 20): Tier {
  if (!Number.isFinite(cv)) return 2;
  return cv <= reliableMax ? 0 : cv <= cautionMax ? 1 : 2;
}

/** Places whose "official" figure Lights combines from PSA's district estimates (data v5): the City of Manila,
 *  which PSA publishes only as its 14 districts; weighted by 2020 Census population (pipeline/lgu/labels.py). */
export const COMBINED_DISTRICTS: Readonly<Record<string, number>> = { PH1303901: 14 };

/** "Combined from PSA's 14 district estimates" for such a place, else null. */
export function combinedNote(pcode: string | undefined, lang: "en" | "ja"): string | null {
  const n = pcode ? COMBINED_DISTRICTS[pcode] : undefined;
  if (!n) return null;
  return lang === "ja" ? `PSAの${n}地区の推計を人口で加重して合算` : `combined from PSA's ${n} district estimates`;
}

/** PSA's SAE method changed from ELL to Census EB (config/rounds.json). */
export function estimatorLabel(e: string): string {
  return e === "CensusEB" ? "Census EB" : e;
}
