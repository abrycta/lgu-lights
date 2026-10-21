// MapLibre paint expressions for one year. Tiles carry v<yy> (value %), t<yy> (tier) and s<yy>
// (0 = PSA official, 1 = model estimate) per year; a missing property means no data. The colour
// classes use Akari's sequential scale with the manifest's fixed breaks, and opacity/hatching follow
// lib/honesty.ts so the map, legend and table make the same official-vs-model distinction.

import { hatchFilter as akariHatchFilter, hatchPattern as akariHatchPattern, stepColor, type Expression as AkariExpression } from "@abrycta/akari/maps";
import { flat } from "@abrycta/akari/tokens";

import type { ExpressionSpecification as Expression } from "maplibre-gl";

import { MODEL_OPACITY, OFFICIAL_OPACITY } from "@/lib/honesty";

export type ThemeKey = "light" | "dark" | "light-hc" | "dark-hc";

export function themeKey(theme: "light" | "dark", hc: boolean): ThemeKey {
  return hc ? `${theme}-hc` : theme;
}

export function tokenColor(id: string, key: ThemeKey): string {
  const t = (flat as unknown as Record<string, Record<string, string>>)[id];
  return t?.[key] ?? t?.light ?? "#888888";
}

const yy = (year: number) => String(year % 100).padStart(2, "0");

/** A numeric property, or -1 when absent/empty. */
function num(prop: string): Expression {
  return ["case", ["==", ["typeof", ["get", prop]], "number"], ["get", prop], ["to-number", ["get", prop], -1]];
}

export function valueExpr(year: number): Expression {
  return num(`v${yy(year)}`);
}
export function tierExpr(year: number): Expression {
  return num(`t${yy(year)}`);
}
export function sourceExpr(year: number): Expression {
  return num(`s${yy(year)}`);
}

export function fillColor(year: number, breaks: readonly number[], key: ThemeKey): Expression {
  const v = valueExpr(year);
  const theme = key.startsWith("dark") ? "dark" : "light";
  return ["case", ["<", v, 0], tokenColor("color.surface-subtle", key), stepColor(v as AkariExpression, breaks, { scale: "seq", theme }) as unknown as Expression];
}

/** Official figures are opaque; model estimates are lighter; no data is a faint ground. */
export function fillOpacity(year: number): Expression {
  return ["case", ["<", valueExpr(year), 0], 0.6, ["==", sourceExpr(year), 0], OFFICIAL_OPACITY, MODEL_OPACITY];
}

/** Hatch overlay (Akari's reliability hatching): tier 1 sparse, tier 2 dense, only where the year has a value. */
export function hatchFilter(year: number): Expression {
  return ["all", [">=", valueExpr(year), 0], akariHatchFilter(tierExpr(year)) as unknown as Expression];
}
/** `fill-pattern`: Akari's "hatch-sparse" / "hatch-dense" images (registered by addHatchImages). */
export function hatchPattern(year: number): Expression {
  return akariHatchPattern(tierExpr(year)) as unknown as Expression;
}

export const PH_BOUNDS: [number, number, number, number] = [116.9, 4.5, 126.6, 21.2];

/** pcode of a tile feature: the `pcode` property, else the numeric id (pcode digits). */
export function featurePcode(f: { id?: string | number; properties?: Record<string, unknown> | null }): string | null {
  const p = f.properties?.pcode;
  if (typeof p === "string" && p) return p;
  if (typeof f.id === "number") return `PH${String(f.id).padStart(7, "0")}`;
  return null;
}
