// "In plain words": the sentences for non-technical visitors, in EN and JA. Pure functions only, so
// the rules (natural frequencies, the comparison, the change test) are tested in one place and every
// view says the same thing. The technical sentence in narrative.ts stays the precise version.
//
// Honesty rules kept here:
// - a model estimate always says it is an estimate ("Lights estimates…");
// - comparisons never mix sources: official figures are compared with official figures, model
//   estimates with model estimates, and the sentence says which;
// - a change is called "likely real" only when it is bigger than the margin of error (changeTest),
//   and never across PSA's 2018 → 2021 method change.

import type { LguDetail, Source, Tier, YearRecord } from "@/data/types";

import { CENSUS_EB_FROM, type Lang } from "./honesty";

const Z90 = 1.645;

/** Whole people per 100, with the lower limit clamped at 0 (as everywhere else). */
const r100 = (v: number) => Math.round(Math.max(0, v));

/** "Tagbilaran City (Capital)" → "Tagbilaran City": the parenthetical reads badly mid-sentence. */
export function shortName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "") || name;
}

/** Strip "Region VII (Central Visayas)" to "Central Visayas"; names without a parenthetical stay. */
export function regionShort(name: string): string {
  const m = /\(([^)]+)\)\s*$/.exec(name);
  return m ? m[1]! : name;
}

/**
 * A rate as a natural frequency: "about 1 in 4" when a simple fraction (2 to 10) is within
 * max(0.6, 5 %) of the value, otherwise "about 8 in 100". Under 0.5: "fewer than 1 in 100".
 */
export function freq(v: number, lang: Lang): string {
  const ja = lang === "ja";
  if (v < 0.5) return ja ? "100人に1人未満" : "fewer than 1 in 100";
  const tol = Math.max(0.6, 0.05 * v);
  for (let n = 2; n <= 10; n++) {
    if (Math.abs(100 / n - v) <= tol) return ja ? `約${n}人に1人` : `about 1 in ${n}`;
  }
  const k = Math.round(v);
  return ja ? `100人のうち約${k}人` : `about ${k} in 100`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The value, interval and source currently shown for a year, or null. */
export function shownFigure(rec: YearRecord | undefined): { source: Source; est: number; lo: number; hi: number; tier: Tier } | null {
  if (!rec?.shown) return null;
  if (rec.shown.source === "official" && rec.official) {
    const o = rec.official;
    return { source: "official", est: o.estimate, lo: o.lo90, hi: o.hi90, tier: o.tier };
  }
  if (rec.model) {
    const m = rec.model;
    return { source: "model", est: m.estimate, lo: m.lo90, hi: m.hi90, tier: m.tier };
  }
  return null;
}

/** #1 The everyday headline, in natural frequencies, with the 90 % interval as "likely between". */
export function headline(rec: YearRecord | undefined, year: number, place: string, lang: Lang): string | null {
  const f = shownFigure(rec);
  if (!f) return null;
  const p = shortName(place);
  const lo = r100(f.lo);
  const hi = r100(f.hi);
  if (lang === "ja") {
    const range = `100人あたりおそらく${lo}〜${hi}人`;
    return f.source === "official"
      ? `${year}年、${p}では${freq(f.est, lang)}が貧困線を下回る暮らしをしていました（${range}）。`
      : `Lightsの推計では、${year}年の${p}では${freq(f.est, lang)}が貧困線を下回る暮らしをしていたと見られます（${range}）。`;
  }
  const range = `likely between ${lo} and ${hi} in every 100`;
  return f.source === "official"
    ? `${cap(freq(f.est, lang))} people in ${p} lived below the poverty line in ${year} (${range}).`
    : `Lights estimates that ${freq(f.est, lang)} people in ${p} lived below the poverty line in ${year} (${range}).`;
}

/** #4 Reliability in plain words: one sentence per tier, with the range in people per 100. */
export function reliabilitySentence(tier: Tier, lo: number, hi: number, lang: Lang): string {
  const a = r100(lo);
  const b = r100(hi);
  if (lang === "ja") {
    if (tier === 0) return `確かな値：実際の値はほぼ確実に100人あたり${a}〜${b}人の範囲です。`;
    if (tier === 1) return `注意して使う値：実際の値はおそらく100人あたり${a}〜${b}人で、この水準にしては幅が広めです。`;
    return `おおよその目安：実際の値は100人あたり${a}〜${b}人のどこかかもしれません。`;
  }
  if (tier === 0) return `Solid: the true figure is very likely between ${a} and ${b} in 100.`;
  if (tier === 1) return `Use with care: the true figure is probably between ${a} and ${b} in 100, a wide range for a figure this size.`;
  return `Rough guess: the true figure could be anywhere from ${a} to ${b} in 100.`;
}

// ---------------------------------------------------------------------------------------------
// #3 Did it really change?

/** A figure with its standard error, for the change test. */
export interface Point {
  year: number;
  est: number;
  se: number;
}

/**
 * Standard error of a figure. Official: PSA's published SE. Model: the larger 90 % half-width / 1.645
 * (conformal intervals can be asymmetric and their lower limit is clamped at 0, so the larger side
 * is the conservative choice).
 */
export function pointOf(rec: YearRecord, source: Source): Point | null {
  if (source === "official" && rec.official) return { year: rec.year, est: rec.official.estimate, se: rec.official.se };
  if (source === "model" && rec.model) {
    const m = rec.model;
    return { year: rec.year, est: m.estimate, se: Math.max(m.hi90 - m.estimate, m.estimate - m.lo90) / Z90 };
  }
  return null;
}

/** PSA's method era of a year: ELL before 2021, Census EB from 2021. */
export const eraOf = (year: number) => (year >= CENSUS_EB_FROM ? "CensusEB" : "ELL");

export type Change = { kind: "up" | "down" | "unclear"; diff: number } | { kind: "notComparable"; diff: number };

/**
 * The change rule: the difference is "likely real" when |d| > 1.645 · √(SE₁² + SE₂²), a two-sided
 * test at the 10 % level that treats the two figures as independent (PSA publishes no covariance).
 * Across the 2018 → 2021 method change the figures are not compared at all.
 */
export function changeTest(prev: Point, cur: Point): Change {
  const diff = cur.est - prev.est;
  if (eraOf(prev.year) !== eraOf(cur.year)) return { kind: "notComparable", diff };
  const se = Math.sqrt(prev.se ** 2 + cur.se ** 2);
  if (!(se > 0) || Math.abs(diff) <= Z90 * se) return { kind: "unclear", diff };
  return { kind: diff > 0 ? "up" : "down", diff };
}

/** The figure a year is compared with: the previous PSA round for official years, the round a model estimate starts from otherwise. */
export function previousOfficial(years: YearRecord[], rec: YearRecord): YearRecord | null {
  const f = shownFigure(rec);
  if (!f) return null;
  const target = f.source === "model" ? rec.model!.from : null;
  const prior = years.filter((y) => y.official && (target != null ? y.year === target : y.year < rec.year));
  return prior.length ? prior[prior.length - 1]! : null;
}

/** #3 sentence: change since the previous PSA figure, or why it is not compared. */
export function changeSentence(years: YearRecord[], rec: YearRecord | undefined, lang: Lang): string | null {
  if (!rec) return null;
  const f = shownFigure(rec);
  const prevRec = f ? previousOfficial(years, rec) : null;
  if (!f || !prevRec) return null;
  const prev = pointOf(prevRec, "official")!;
  const cur = pointOf(rec, f.source)!;
  const c = changeTest(prev, cur);
  const ja = lang === "ja";
  if (c.kind === "notComparable") {
    return ja
      ? `PSAは2018年と2021年の間に推計方法を変えたため、この値とPSAの${prev.year}年の値は厳密には比較できません。変化とはみなしません。`
      : `PSA changed its method between 2018 and 2021, so this figure and PSA's ${prev.year} figure aren't strictly comparable; we don't call it a change.`;
  }
  let a = String(r100(prev.est));
  let b = String(r100(cur.est));
  if (a === b) {
    a = Math.max(0, prev.est).toFixed(1);
    b = Math.max(0, cur.est).toFixed(1);
  }
  const up = c.diff > 0;
  if (ja) {
    const move = `PSAの${prev.year}年の値から、100人あたり${a}人から${b}人に${up ? "増えました" : "減りました"}`;
    return c.kind === "unclear"
      ? `${move}が、誤差の範囲内なので、実際に変わったかどうかは分かりません。`
      : `${move}。誤差の範囲を超えているため、${up ? "増加" : "減少"}はおそらく実際のものです。`;
  }
  const move = `Since PSA's ${prev.year} figure: ${up ? "up" : "down"} from ${a} to ${b} in 100`;
  return c.kind === "unclear"
    ? `${move}, but that's within the margin of error, so we can't tell whether it really changed.`
    : `${move}. That's bigger than the margin of error, so the ${up ? "rise" : "fall"} is likely real.`;
}

/** Official years whose change from the previous official round (same method era) is likely real: chart marks. */
export function clearChanges(years: YearRecord[]): Map<number, "up" | "down"> {
  const out = new Map<number, "up" | "down">();
  let prev: Point | null = null;
  for (const r of years) {
    const p = pointOf(r, "official");
    if (!p) continue;
    if (prev) {
      const c = changeTest(prev, p);
      if (c.kind === "up" || c.kind === "down") out.set(r.year, c.kind);
    }
    prev = p;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// #2 Compared with what?

/** Everyone's shown value per year, from the published tiles-attrs.csv (one row per place). */
export interface NationalValues {
  years: number[];
  /** pcode → per-year value (null: no estimate) and source (0 official, 1 model). */
  rows: Map<string, { v: (number | null)[]; s: (number | null)[] }>;
}

export function parseAttrsCsv(text: string): NationalValues {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0]!.split(",");
  const vCols = head.flatMap((h, i) => (/^v\d\d$/.test(h) ? [[i, 2000 + Number(h.slice(1))] as const] : []));
  const years = vCols.map(([, y]) => y);
  const sIdx = years.map((y) => head.indexOf(`s${String(y % 100).padStart(2, "0")}`));
  const rows = new Map<string, { v: (number | null)[]; s: (number | null)[] }>();
  for (const line of lines.slice(1)) {
    // Names are quoted and may contain commas; the pcode is first and the numbers follow the name.
    const m = /^([^,]+),("(?:[^"]|"")*"|[^,]*),(.*)$/.exec(line);
    if (!m) continue;
    const cells = [m[1]!, m[2]!, ...m[3]!.split(",")];
    const num = (i: number) => (cells[i] === "" || cells[i] == null ? null : Number(cells[i]));
    rows.set(m[1]!, { v: vCols.map(([i]) => num(i)), s: sIdx.map((i) => (i < 0 ? null : num(i))) });
  }
  return { years, rows };
}

/** Values of one source in one year, optionally keyed by pcode. */
export function valuesOf(nat: NationalValues, year: number, source: Source): Map<string, number> {
  const yi = nat.years.indexOf(year);
  const want = source === "official" ? 0 : 1;
  const out = new Map<string, number>();
  if (yi < 0) return out;
  for (const [p, r] of nat.rows) {
    const v = r.v[yi];
    if (v != null && r.s[yi] === want) out.set(p, v);
  }
  return out;
}

/** Share of the other places with a lower value (0..1), among `n` others. */
export function shareBelow(value: number, others: number[]): number {
  if (!others.length) return NaN;
  return others.filter((v) => v < value).length / others.length;
}

/**
 * Province average: weighted by WorldPop population (`inputs.pop`, published in every lgu file) when
 * every place has it, otherwise a simple mean of places. Only places whose shown value has the same
 * source as the selected place count.
 */
export function provinceAverage(lgus: LguDetail[], year: number, source: Source): { mean: number; n: number; weighted: boolean } | null {
  const pts: { v: number; w: number | null }[] = [];
  for (const l of lgus) {
    const r = l.years.find((y) => y.year === year);
    if (r?.shown && r.shown.source === source) pts.push({ v: r.shown.value, w: r.inputs?.pop ?? null });
  }
  if (!pts.length) return null;
  const weighted = pts.every((p) => p.w != null && p.w > 0);
  const sw = weighted ? pts.reduce((a, p) => a + p.w!, 0) : pts.length;
  const mean = pts.reduce((a, p) => a + p.v * (weighted ? p.w! : 1), 0) / sw;
  return { mean, n: pts.length, weighted };
}

/** Minimum number of comparable places for a national rank to be worth saying. */
export const MIN_NATIONAL = 50;

/** #2 sentence. `others`: the same-source values of every other place that year. */
export function comparisonSentence(
  args: { value: number; lo: number; hi: number; source: Source; year: number; others: number[]; province: { name: string; mean: number; n: number } | null },
  lang: Lang,
): string | null {
  const { value, lo, hi, source, year, others, province } = args;
  const ja = lang === "ja";
  const parts: string[] = [];
  if (others.length >= MIN_NATIONAL) {
    const p = shareBelow(value, others);
    if (p >= 0.95) parts.push(ja ? "全国のほぼすべての市町村より高く" : "higher than almost every town and city in the country");
    else if (p <= 0.05) parts.push(ja ? "全国のほぼすべての市町村より低く" : "lower than almost every town and city in the country");
    else if (p >= 0.5) {
      const k = Math.round(p * 10);
      parts.push(ja ? `全国の市町村の10か所中${k}か所より高く` : `higher than ${k} in 10 towns and cities in the country`);
    } else {
      const k = Math.round((1 - p) * 10);
      parts.push(ja ? `全国の市町村の10か所中${k}か所より低く` : `lower than ${k} in 10 towns and cities in the country`);
    }
  }
  if (province && province.n >= 2) {
    const m = r100(province.mean);
    const within = province.mean >= Math.max(0, lo) && province.mean <= hi;
    const rel = within ? "near" : value > province.mean ? "above" : "below";
    if (ja) {
      const avg = `${province.name}州の平均（100人あたり${m}人）`;
      parts.push(rel === "near" ? `${avg}とは誤差の範囲内です` : `${avg}を${rel === "above" ? "上回ります" : "下回ります"}`);
    } else {
      const avg = `the ${province.name} average of ${m} in 100`;
      parts.push(rel === "near" ? `within the margin of error of ${avg}` : `${rel} ${avg}`);
    }
  }
  if (!parts.length) return null;
  if (ja) {
    const basis = source === "official" ? `${year}年のPSA公式値どうしで比べると、` : `${year}年のLightsモデル推計どうしで比べると、`;
    let body = parts.join("、");
    if (!body.endsWith("す")) body += "なっています";
    return `${basis}${body}。`;
  }
  const basis = source === "official" ? `comparing PSA official figures for ${year}` : `comparing Lights model estimates for ${year}`;
  return `${cap(parts.join(", and "))} (${basis}).`;
}

// ---------------------------------------------------------------------------------------------
// #9 Why a figure is a model estimate

export function whyModelSentence(years: YearRecord[], rec: YearRecord | undefined, lang: Lang): string | null {
  const f = shownFigure(rec);
  if (!rec || !f || f.source !== "model") return null;
  const { from, kind } = rec.model!;
  const year = rec.year;
  const next = years.find((y) => y.official && y.year > year)?.year;
  const ja = lang === "ja";
  const first = ja
    ? kind === "backtest"
      ? `PSAには${year}年のこの市町村の値がなく、最後に調べたのは${from}年です。`
      : `PSAがこの市町村を最後に調べたのは${from}年です。`
    : kind === "backtest"
      ? `PSA has no ${year} figure for this place; it last measured it in ${from}.`
      : `PSA last measured this place in ${from}.`;
  const second = ja
    ? `この${year}年の値はそこを出発点に、全国の傾向と州ごとの補正を加え、州の中でこの市町村がどう動いたかを過去のPSA調査と衛星データからモデルで推定したものです。`
    : `This ${year} figure starts from that one, adds the national trend and an adjustment for the province, and estimates how the place moved within its province from past PSA rounds and satellite data.`;
  const again = next ? (ja ? `PSAは${next}年に再び調べています。` : ` PSA measured it again in ${next}.`) : "";
  return ja ? `${first}${second}${again}` : `${first} ${second}${again}`;
}

// ---------------------------------------------------------------------------------------------
// #6 Honest what-if explanation

export function whatIfExplanation(base: number, scen: number, growth: number, ndvi: number, lang: Lang): string | null {
  if (growth === 0 && ndvi === 0) return null;
  const d = scen - base;
  const ja = lang === "ja";
  const ds = Math.abs(d) < 0.05 ? "±0.0" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
  const conds: string[] = [];
  if (growth !== 0)
    conds.push(ja ? `ここの夜間光が毎年${Math.abs(growth)}%${growth > 0 ? "多く" : "少なく"}伸びていたら` : `night lights here had grown ${Math.abs(growth)} % a year ${growth > 0 ? "faster" : "slower"}`);
  if (ndvi !== 0) {
    const n = `${ndvi > 0 ? "+" : "−"}${Math.abs(ndvi).toFixed(2)}`;
    conds.push(ja ? `植生指数（NDVI）が${n}変わっていたら` : `the vegetation index (NDVI) had changed by ${n}`);
  }
  const a = r100(base);
  const b = r100(scen);
  const size = Math.abs(d) < 0.5 ? "tiny" : Math.abs(d) < 2 ? "small" : "noticeable";
  if (ja) {
    const move = a === b ? `推計は100人あたり約${a}人のままです（${ds}ポイント）。` : `推計は100人あたり${a}人から${b}人に変わります（${ds}ポイント）。`;
    const why =
      size === "noticeable"
        ? "衛星データの変化としては目立つ動きですが、あくまで仮定のシナリオで、予測ではありません。"
        : `${size === "tiny" ? "ごくわずかな" : "小さな"}変化です。モデルは衛星データよりも過去のPSAの値に大きく頼っているためです。`;
    return `${conds.join("、さらに")}、${move}${why}`;
  }
  const move = a === b ? `the estimate would stay at about ${a} in 100 (${ds} points)` : `the estimate would move from ${a} to ${b} in 100 (${ds} points)`;
  const why =
    size === "noticeable"
      ? "That's a noticeable shift for a satellite change, but it's still a hypothetical scenario, not a forecast."
      : `That's ${size}, because the model relies mostly on past PSA figures, not satellites.`;
  return `If ${conds.join(" and ")}, ${move}. ${why}`;
}

// ---------------------------------------------------------------------------------------------
// #7 Province summary and #8 national sentence

/** Median of a non-empty list. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The PSA rounds (≤ year, same method era as the latest of them) a province's change is measured over. */
export function changeWindow(rounds: number[], year: number): { from: number; to: number } | { methodBreak: number } | null {
  const upTo = rounds.filter((r) => r <= year);
  if (!upTo.length) return null;
  const to = upTo[upTo.length - 1]!;
  const same = upTo.filter((r) => eraOf(r) === eraOf(to));
  if (same.length >= 2) return { from: same[0]!, to };
  return upTo.length >= 2 ? { methodBreak: to } : null;
}

export function provinceSummary(
  args: { province: string; lgus: LguDetail[]; year: number; rounds: number[]; nationalMedian: number | null; source: Source },
  lang: Lang,
): string | null {
  const { province, lgus, year, rounds, nationalMedian, source } = args;
  const ja = lang === "ja";
  const out: string[] = [];
  const vals = lgus.flatMap((l) => {
    const r = l.years.find((y) => y.year === year);
    return r?.shown && r.shown.source === source ? [r.shown.value] : [];
  });
  if (vals.length && nationalMedian != null) {
    const k = vals.filter((v) => v > nationalMedian).length;
    const m = r100(nationalMedian);
    const src = ja ? (source === "official" ? "PSA公式値" : "Lightsモデル推計") : source === "official" ? "PSA official figures" : "Lights model estimates";
    out.push(
      ja
        ? `${province}州では、${src}のある${vals.length}市町村のうち${k}が全国の中央値（100人あたり${m}人）より貧困率が高くなっています（${year}年）。`
        : `In ${province}, ${k} of ${vals.length} towns and cities have a higher poverty rate than the typical place in the country (the national median, ${m} in 100; ${src}, ${year}).`,
    );
  }
  const w = changeWindow(rounds, year);
  if (w && "methodBreak" in w) {
    out.push(
      ja
        ? `PSAは2021年に推計方法を変えたため、${w.methodBreak}年の値はそれ以前の調査回とは比較していません。`
        : `PSA changed its method in 2021, so the ${w.methodBreak} figures are not compared with earlier rounds.`,
    );
  } else if (w) {
    let fell = 0;
    let rose = 0;
    let n = 0;
    for (const l of lgus) {
      const a = l.years.find((y) => y.year === w.from);
      const b = l.years.find((y) => y.year === w.to);
      const pa = a && pointOf(a, "official");
      const pb = b && pointOf(b, "official");
      if (!pa || !pb) continue;
      n++;
      const c = changeTest(pa, pb);
      if (c.kind === "down") fell++;
      else if (c.kind === "up") rose++;
    }
    if (n) {
      const rest = n - fell - rose;
      out.push(
        ja
          ? `PSAの${w.from}年と${w.to}年の値を比べると、貧困がはっきり減ったのは${fell}市町村、はっきり増えたのは${rose}市町村で、残りの${rest}市町村は誤差の範囲内のため判断できません。`
          : `Between PSA's ${w.from} and ${w.to} figures, poverty fell clearly in ${plural(fell)}, rose clearly in ${plural(rose)}, and in the other ${rest} we can't tell (within the margin of error).`,
      );
    }
  }
  return out.length ? out.join(ja ? "" : " ") : null;
}

function plural(n: number): string {
  return n === 0 ? "none" : n === 1 ? "1 place" : `${n} places`;
}

/** Minimum places with a value for a region to be ranked in the national sentence. */
export const MIN_REGION = 5;

export function nationalSentence(
  args: { year: number; source: Source; values: Map<string, number>; regionOf: Map<string, string>; regionName: Map<string, string> },
  lang: Lang,
): string | null {
  const { year, source, values, regionOf, regionName } = args;
  const by = new Map<string, number[]>();
  for (const [p, v] of values) {
    const r = regionOf.get(p);
    if (!r) continue;
    (by.get(r) ?? by.set(r, []).get(r)!).push(v);
  }
  const ranked: { r: string; mean: number }[] = [];
  const left: string[] = [];
  for (const r of regionName.keys()) {
    const xs = by.get(r) ?? [];
    if (xs.length >= MIN_REGION) ranked.push({ r, mean: xs.reduce((a, b) => a + b, 0) / xs.length });
    else left.push(r);
  }
  if (ranked.length < 4) return null;
  ranked.sort((a, b) => b.mean - a.mean);
  const name = (r: string) => regionShort(regionName.get(r) ?? r);
  const [h1, h2] = [name(ranked[0]!.r), name(ranked[1]!.r)];
  const [l1, l2] = [name(ranked[ranked.length - 1]!.r), name(ranked[ranked.length - 2]!.r)];
  const ja = lang === "ja";
  if (ja) {
    const src = source === "official" ? "PSA公式値" : "Lightsのモデル推計、公式統計ではありません";
    const out = `${year}年（${src}）：地域ごとの市町村の平均で見ると、貧困率が最も高いのは${h1}と${h2}、最も低いのは${l1}と${l2}です。`;
    return left.length ? `${out}${left.map(name).join("、")}は値のある市町村が少ないため除いています。` : out;
  }
  const src = source === "official" ? "PSA official figures" : "Lights model estimates, not official";
  const out = `${year} (${src}): averaging each region's towns and cities, poverty rates are highest in ${h1} and ${h2}, and lowest in ${l1} and ${l2}.`;
  return left.length ? `${out} ${left.map(name).join(", ")} ${left.length === 1 ? "is" : "are"} left out (too few places with figures).` : out;
}

// ---------------------------------------------------------------------------------------------
// #11 Copy a plain summary

export function plainSummary(args: { place: string; province: string; rec: YearRecord | undefined; year: number; url: string }, lang: Lang): string | null {
  const { place, province, rec, year, url } = args;
  const f = shownFigure(rec);
  if (!f || !rec) return null;
  const lo = r100(f.lo);
  const hi = r100(f.hi);
  const p = `${shortName(place)}, ${province}`;
  if (lang === "ja") {
    const label =
      f.source === "official"
        ? "これはPSA（フィリピン統計庁）の公式統計（小地域推計）です。"
        : `これはLightsのモデル推計で、公式統計ではありません（PSAの${rec.model!.from}年の値を出発点にしています）。`;
    return `${p}（${year}年）：${freq(f.est, lang)}が貧困線を下回る暮らしをしていました（100人あたりおそらく${lo}〜${hi}人）。${label}出典：Lights ${url}`;
  }
  const label =
    f.source === "official"
      ? "This is an official figure from the Philippine Statistics Authority (PSA small area estimate)."
      : `This is a Lights model estimate, not an official figure; it starts from PSA's ${rec.model!.from} figure.`;
  return `${p}, ${year}: ${freq(f.est, lang)} people lived below the poverty line (likely between ${lo} and ${hi} in every 100). ${label} Source: Lights, ${url}`;
}

// ---------------------------------------------------------------------------------------------
// #10 100-people picture

/** Cells of the 10×10 picture: "sure" up to the lower limit, "est" up to the estimate, "maybe" up to the upper limit. */
export function peopleCells(est: number, lo: number, hi: number): ("sure" | "est" | "maybe" | "none")[] {
  const a = r100(lo);
  const e = Math.max(a, r100(est));
  const b = Math.min(100, Math.max(e, r100(hi)));
  return Array.from({ length: 100 }, (_, i) => (i < a ? "sure" : i < e ? "est" : i < b ? "maybe" : "none"));
}

export function peopleAlt(est: number, lo: number, hi: number, lang: Lang): string {
  const e = r100(est);
  return lang === "ja"
    ? `100人の図：約${e}人が貧困線未満。実際はおそらく${r100(lo)}〜${r100(hi)}人。`
    : `Picture of 100 people: about ${e} below the poverty line; the true number is likely between ${r100(lo)} and ${r100(hi)}.`;
}
