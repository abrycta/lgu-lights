import type { Lang } from "./honesty";

/** One decimal, the precision of the data. */
export function num(v: number): string {
  return v.toFixed(1);
}

/** "18.0 %" (EN, non-breaking space) or "18.0%" (JA). */
export function pct(v: number, lang: Lang): string {
  return lang === "ja" ? `${num(v)}%` : `${num(v)}\u00a0%`;
}

/**
 * The model is clipped at 0, so some model estimates are exactly 0.0, which no place really has. Such an
 * estimate (anything that would print as 0.0) reads "below 1 %" instead (Kurt's decision, 2026-10-23).
 */
export function belowOne(v: number, model: boolean): boolean {
  return model && v < 0.05;
}

/** pct(), except a model estimate of 0.0 reads "below 1 % (model estimate)" / "1%未満（モデル推計）". */
export function pctShown(v: number, lang: Lang, model: boolean): string {
  if (!belowOne(v, model)) return pct(v, lang);
  return lang === "ja" ? "1%未満（モデル推計）" : "below 1\u00a0% (model estimate)";
}

/** Inside a sentence that already says it is a model estimate: "below 1 %" / "1%未満". */
export function pctInline(v: number, lang: Lang, model: boolean): string {
  if (!belowOne(v, model)) return pct(v, lang);
  return lang === "ja" ? "1%未満" : "below 1\u00a0%";
}

/** num() for table cells: a model estimate of 0.0 reads "<1". */
export function numShown(v: number, model: boolean): string {
  return belowOne(v, model) ? "<1" : num(v);
}

/**
 * PSA publishes some lower 90 % limits below zero (a symmetric interval around a small estimate).
 * Poverty incidence cannot be negative, so every view shows the lower limit clamped at 0 and the
 * About page says so. `clamped` tells the caller a limit was cut.
 */
export function interval(lo: number, hi: number, lang: Lang): { text: string; clamped: boolean } {
  const clamped = lo < 0;
  const a = num(Math.max(0, lo));
  const b = num(hi);
  return { text: lang === "ja" ? `${a}〜${b}%` : `${a}–${b}\u00a0%`, clamped };
}

export function cvText(cv: number): string {
  return Number.isFinite(cv) ? `${cv.toFixed(0)}%` : "—";
}
