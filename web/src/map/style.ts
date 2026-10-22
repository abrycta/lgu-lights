// MapLibre paint expressions for one year. Each place's value % (v<yy>), tier (t<yy>) and source
// (s<yy>: 0 = PSA official, 1 = model estimate) per year come from the data version's tiles-attrs.csv,
// looked up by the tile feature's id (the pcode digits): from data v4 on, the tiles carry geometry and
// pcode only. Without the CSV (or a column of it), the tile's own properties are read, as v1–v3 tiles
// and the embed packs carry them. No value means no data. The colour classes use Akari's sequential
// scale with the manifest's fixed breaks, and opacity/hatching follow lib/honesty.ts so the map,
// legend and table make the same official-vs-model distinction.

import { hatchFilter as akariHatchFilter, hatchPattern as akariHatchPattern, stepColor, type Expression as AkariExpression } from "@abrycta/akari/maps";
import { flat } from "@abrycta/akari/tokens";

import type { ExpressionSpecification as Expression } from "maplibre-gl";

import { MODEL_OPACITY, OFFICIAL_OPACITY } from "@/lib/honesty";
import type { NationalValues } from "@/lib/plain";

export type ThemeKey = "light" | "dark" | "light-hc" | "dark-hc";

export function themeKey(theme: "light" | "dark", hc: boolean): ThemeKey {
  return hc ? `${theme}-hc` : theme;
}

export function tokenColor(id: string, key: ThemeKey): string {
  const t = (flat as unknown as Record<string, Record<string, string>>)[id];
  return t?.[key] ?? t?.light ?? "#888888";
}

const yy = (year: number) => String(year % 100).padStart(2, "0");

/** A numeric tile property, or -1 when absent/empty. */
function num(prop: string): Expression {
  return ["case", ["==", ["typeof", ["get", prop]], "number"], ["get", prop], ["to-number", ["get", prop], -1]];
}

/** Tile feature id of a pcode (its digits), as the tiles number their features. */
export function pcodeId(pcode: string): number {
  return Number.parseInt(pcode.slice(2), 10);
}

type Kind = "v" | "t" | "s";
const csvCache = new WeakMap<NationalValues, Map<string, Expression | null>>();

/** `match` on the feature id: every place's number of this kind in this year (ids grouped by value), else -1. Null when the CSV lacks the column. */
function fromCsv(nat: NationalValues, kind: Kind, year: number): Expression | null {
  let byKey = csvCache.get(nat);
  if (!byKey) csvCache.set(nat, (byKey = new Map()));
  const key = `${kind}${year}`;
  if (byKey.has(key)) return byKey.get(key)!;
  const yi = nat.years.indexOf(year);
  let out: Expression | null = null;
  if (yi >= 0 && (kind !== "t" || nat.tiers)) {
    const groups = new Map<number, number[]>();
    for (const [p, r] of nat.rows) {
      const x = r[kind][yi];
      if (x == null || Number.isNaN(x)) continue;
      const ids = groups.get(x);
      if (ids) ids.push(pcodeId(p));
      else groups.set(x, [pcodeId(p)]);
    }
    const branches = [...groups].flatMap(([x, ids]) => [ids, x]);
    out = branches.length ? (["match", ["id"], ...branches, -1] as unknown as Expression) : (["literal", -1] as unknown as Expression);
  }
  byKey.set(key, out);
  return out;
}

function attr(kind: Kind, year: number, nat: NationalValues | null): Expression {
  return (nat && fromCsv(nat, kind, year)) ?? num(`${kind}${yy(year)}`);
}

export function valueExpr(year: number, nat: NationalValues | null): Expression {
  return attr("v", year, nat);
}
export function tierExpr(year: number, nat: NationalValues | null): Expression {
  return attr("t", year, nat);
}
export function sourceExpr(year: number, nat: NationalValues | null): Expression {
  return attr("s", year, nat);
}

export function fillColor(year: number, breaks: readonly number[], key: ThemeKey, nat: NationalValues | null): Expression {
  const v = valueExpr(year, nat);
  const theme = key.startsWith("dark") ? "dark" : "light";
  return ["case", ["<", v, 0], tokenColor("color.surface-subtle", key), stepColor(v as AkariExpression, breaks, { scale: "seq", theme }) as unknown as Expression];
}

/** Official figures are opaque; model estimates are lighter; no data is a faint ground. */
export function fillOpacity(year: number, nat: NationalValues | null): Expression {
  return ["case", ["<", valueExpr(year, nat), 0], 0.6, ["==", sourceExpr(year, nat), 0], OFFICIAL_OPACITY, MODEL_OPACITY];
}

/** Hatch overlay (Akari's reliability hatching): tier 1 sparse, tier 2 dense, only where the year has a value. */
export function hatchFilter(year: number, nat: NationalValues | null): Expression {
  return ["all", [">=", valueExpr(year, nat), 0], akariHatchFilter(tierExpr(year, nat)) as unknown as Expression];
}
/** `fill-pattern`: Akari's "hatch-sparse" / "hatch-dense" images (registered by addHatchImages). */
export function hatchPattern(year: number, nat: NationalValues | null): Expression {
  return akariHatchPattern(tierExpr(year, nat)) as unknown as Expression;
}

/** One place's value, tier and source in a year: from the CSV when it has them, else from the tile feature's properties. */
export function placeYear(
  pcode: string | null,
  props: Record<string, unknown>,
  year: number,
  nat: NationalValues | null,
): { v: number | null; t: number | null; s: number | null } {
  const tile = (k: Kind) => {
    const x = props[`${k}${yy(year)}`];
    return x === "" || x == null || Number.isNaN(Number(x)) ? null : Number(x);
  };
  const yi = nat ? nat.years.indexOf(year) : -1;
  const row = nat && pcode && yi >= 0 ? nat.rows.get(pcode) : undefined;
  if (nat && yi >= 0) {
    return { v: row?.v[yi] ?? null, s: row?.s[yi] ?? null, t: nat.tiers ? (row?.t[yi] ?? null) : tile("t") };
  }
  return { v: tile("v"), t: tile("t"), s: tile("s") };
}

export const PH_BOUNDS: [number, number, number, number] = [116.9, 4.5, 126.6, 21.2];

/** pcode of a tile feature: the `pcode` property, else the numeric id (pcode digits). */
export function featurePcode(f: { id?: string | number; properties?: Record<string, unknown> | null }): string | null {
  const p = f.properties?.pcode;
  if (typeof p === "string" && p) return p;
  if (typeof f.id === "number") return `PH${String(f.id).padStart(7, "0")}`;
  return null;
}
