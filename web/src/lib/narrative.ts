// Caption-first narration (DECISIONS Q7): one sentence template per case, in EN and JA. Every
// sentence states the value, its 90 % interval and its reliability, and says whether it is an
// official PSA figure or a model estimate (Q11, ARCHITECTURE-RESEARCH §5).

import type { YearRecord } from "@/data/types";

import { interval, pct } from "./format";
import { estimatorLabel, type Lang, TIER_LABEL } from "./honesty";

export function narrative(rec: YearRecord | undefined, year: number, place: string, lang: Lang): string {
  const ja = lang === "ja";
  if (!rec?.shown) {
    return ja ? `${year}年の${place}の推計はありません。` : `There is no estimate for ${place} in ${year}.`;
  }
  const { shown } = rec;
  const tier = TIER_LABEL[shown.tier][lang];

  if (shown.source === "official" && rec.official) {
    const o = rec.official;
    const ci = interval(o.lo90, o.hi90, lang).text;
    return ja
      ? `${year}年、PSAは${place}の貧困率を${pct(o.estimate, lang)}と推計しています（90%信頼区間 ${ci}）。これはPSAの公式統計（小地域推計、${estimatorLabel(o.estimator)}法）です。信頼性：${tier}（CV ${o.cv.toFixed(0)}%）。`
      : `In ${year} the PSA estimated poverty in ${place} at ${pct(o.estimate, lang)} (90 % confidence interval ${ci}). This is an official figure (PSA small area estimate, ${estimatorLabel(o.estimator)}); reliability: “${tier}” (CV ${o.cv.toFixed(0)} %).`;
  }

  const m = rec.model;
  if (!m) return ja ? `${year}年の${place}の推計はありません。` : `There is no estimate for ${place} in ${year}.`;
  const iv = interval(m.lo90, m.hi90, lang).text;
  const basis = ja
    ? `${m.from}年のPSA推計と、その後の衛星データ（夜間光・植生）に基づきます。`
    : `It builds on the ${m.from} PSA round and satellite data (night lights, vegetation) since then.`;
  return ja
    ? `${year}年のモデル推計では、${place}の貧困率は${pct(m.estimate, lang)}です（90%区間 ${iv}）。これは推計値であり、公式統計ではありません。信頼性：${tier}。${basis}`
    : `In ${year} the model estimates poverty in ${place} at ${pct(m.estimate, lang)} (90 % interval ${iv}). This is an estimate, not an official figure; reliability: “${tier}”. ${basis}`;
}

/** The backtest line beside an official value: what the model said without this round. */
export function backtestNote(rec: YearRecord, lang: Lang): string | null {
  const m = rec.model;
  if (!rec.official || !m || m.kind !== "backtest") return null;
  const iv = interval(m.lo90, m.hi90, lang).text;
  return lang === "ja"
    ? `この調査回がなかった場合のモデル推計：${pct(m.estimate, lang)}（90%区間 ${iv}、${m.from}年のデータから）`
    : `Without this round the model would have said ${pct(m.estimate, lang)} (90 % interval ${iv}, from ${m.from} data).`;
}
