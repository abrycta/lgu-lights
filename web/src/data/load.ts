// Fetching the static read models. Promises are cached per URL so React 19's `use()` can suspend on
// them and every component asking for the same file shares one request.

import { type NationalValues, parseAttrsCsv } from "@/lib/plain";

import type { Index, Latest, LguDetail, Manifest, Metrics } from "./types";

const DATA_ROOT = `${import.meta.env.BASE_URL}data/`;

const cache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
      return r.json() as Promise<T>;
    });
    // A failed request is not cached, so a retry can succeed.
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Absolute URL of the current data version folder (ends with "/"). */
let base: Promise<string> | null = null;
export function dataBase(): Promise<string> {
  if (!base) {
    base = getJson<Latest>(`${DATA_ROOT}latest.json`).then((l) => new URL(`${DATA_ROOT}${l.base}`, location.href).href);
    base.catch(() => (base = null));
  }
  return base;
}

// Stable promise per path, so React's use() sees the same promise on every render.
const inBaseCache = new Map<string, Promise<unknown>>();
function inBase<T>(path: string): Promise<T> {
  let p = inBaseCache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = dataBase().then((b) => getJson<T>(b + path));
    p.catch(() => inBaseCache.delete(path));
    inBaseCache.set(path, p);
  }
  return p;
}

export const loadManifest = () => inBase<Manifest>("manifest.json");
export const loadIndex = () => inBase<Index>("index.json");
export const loadMetrics = () => inBase<Metrics>("metrics.json");
export const loadLgu = (pcode: string) => inBase<LguDetail>(`lgu/${pcode}.json`);

/** Every LGU file of a province (the province table, the province average and summary share it). */
const provCache = new Map<string, Promise<LguDetail[]>>();
export function loadProvinceLgus(index: Index, pcode: string): Promise<LguDetail[]> {
  let p = provCache.get(pcode);
  if (!p) {
    p = Promise.all(index.lgus.filter((l) => l.pv === pcode).map((l) => loadLgu(l.p)));
    p.catch(() => provCache.delete(pcode));
    provCache.set(pcode, p);
  }
  return p;
}

/**
 * Every place's shown value, tier and source per year: `tiles-attrs.csv`, written by `lgu
 * materialise` for the tiles (~240 kB, ~70 kB compressed). Resolves to null when a data version does
 * not publish it (the comparisons are then left out rather than guessed).
 */
let national: Promise<NationalValues | null> | null = null;
export function loadNational(): Promise<NationalValues | null> {
  if (!national) {
    national = dataBase()
      .then((b) => fetch(`${b}tiles-attrs.csv`))
      .then(async (r) => {
        const text = r.ok ? await r.text() : "";
        return text.startsWith("pcode,") ? parseAttrsCsv(text) : null;
      })
      .catch(() => null);
  }
  return national;
}

/** z/x/y tile template for MapLibre (absolute, as MapLibre requires). */
export const tilesUrl = (b: string) => `${b}tiles/{z}/{x}/{y}.pbf`;

// The frozen /embed view reads everything from one pre-packed file (scripts/build-embed.mjs): seeding
// fills the caches above, so the shared components never fetch, and the tiles come from the pack.
export interface EmbedPack {
  version: string;
  manifest: Manifest;
  index: Index;
  lgus: Record<string, LguDetail>;
  /** tiles-attrs.csv cut down to the frozen year. */
  attrs: string;
  /** "z/x/y" -> base64 MVT. */
  tiles: Record<string, string>;
  /** The places /embed tours through, in order (the first is `view.lgu`). */
  tour?: string[];
}

/** An already-settled promise React's use() reads without suspending (so a tour step never flashes a fallback). */
function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

let packedTiles: Map<string, ArrayBuffer> | null = null;

/** Seed every loader from a pack; returns the (synthetic, never fetched) data base. */
export function seedFromPack(pack: EmbedPack): string {
  const b = new URL(`${DATA_ROOT}${pack.version}/`, location.href).href;
  base = settled(b);
  const put = (path: string, v: unknown) => inBaseCache.set(path, settled(v));
  put("manifest.json", pack.manifest);
  put("index.json", pack.index);
  for (const [p, d] of Object.entries(pack.lgus)) put(`lgu/${p}.json`, d);
  // The pack holds every LGU of each province it covers, so the province lists are complete.
  const byProv = new Map<string, LguDetail[]>();
  for (const d of Object.values(pack.lgus)) byProv.set(d.province.pcode, [...(byProv.get(d.province.pcode) ?? []), d]);
  for (const [pc, ls] of byProv) provCache.set(pc, settled(ls));
  national = settled(parseAttrsCsv(pack.attrs));
  packedTiles = new Map(Object.entries(pack.tiles).map(([k, v]) => [`${b}tiles/${k}.pbf`, Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer]));
  return b;
}

/** A tile from the seeded pack: its bytes, an empty tile when the pack lacks it, or null when not seeded. */
export function packedTile(url: string): ArrayBuffer | null {
  if (!packedTiles) return null;
  const t = packedTiles.get(url);
  // A copy: MapLibre transfers the buffer to its worker (detaching it), and the tour asks for tiles again.
  if (t) return t.slice(0);
  // The view needs a tile the pack lacks: the layout and scripts/build-embed.mjs disagree (e2e fails on this).
  console.warn(`embed: tile not in pack: ${url}`);
  return new ArrayBuffer(0);
}
