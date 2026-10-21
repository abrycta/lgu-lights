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
