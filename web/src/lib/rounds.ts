// PSA SAE rounds and estimator eras from config/rounds.json (via rounds.gen.ts, audit M5), and the wording of
// year lists, so no page hard-codes a round or a year. The rounds Lights shows and the feature years come
// from the data version's manifest (manifest.rounds, manifest.years).

import { ROUNDS } from "./rounds.gen";

export { ROUNDS };

/** First round of PSA's Census EB small-area method (ELL before): figures across it are not compared. */
export const CENSUS_EB_FROM: number = ROUNDS.find((r) => r.estimator === "CensusEB")?.year ?? Infinity;
/** Last round estimated with ELL. */
export const LAST_ELL: number = Math.max(...ROUNDS.filter((r) => r.estimator === "ELL").map((r) => r.year));

/** The model's training-only rounds: before the first feature year (2006, 2009). */
export const roundsBefore = (firstYear: number) => ROUNDS.map((r) => r.year).filter((y) => y < firstYear);

/** "2012, 2015, 2018" (en) / "2012・2015・2018" (ja); `and` joins the last two with "and" in English. */
export function yearList(years: readonly number[], lang: "en" | "ja", and = false): string {
  if (lang === "ja") return years.join("・");
  if (!and || years.length < 2) return years.join(", ");
  return `${years.slice(0, -1).join(", ")} and ${years[years.length - 1]}`;
}

/** "2012–2025" (en) / "2012〜2025" (ja), without the trailing 年. */
export const yearSpan = (from: number, to: number, lang: "en" | "ja") => `${from}${lang === "ja" ? "〜" : "–"}${to}`;
