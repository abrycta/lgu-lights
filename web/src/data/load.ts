// Fetching the static read models. Promises are cached per URL so React 19's `use()` can suspend on
// them and every component asking for the same file shares one request.

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

/** z/x/y tile template for MapLibre (absolute, as MapLibre requires). */
export const tilesUrl = (b: string) => `${b}tiles/{z}/{x}/{y}.pbf`;
