// URL state without a router library: two pages (/ and /about; any other path is "notfound") and the map selection in the query
// string (?year=2024&prov=PH01028&lgu=PH0102801&lang=ja), so every view is a shareable link.
// Selections push a history entry (Back undoes them); the year slider replaces the current one.

import { useSyncExternalStore } from "react";

export type Page = "map" | "about" | "notfound";

export interface UrlState {
  page: Page;
  year: number | null;
  prov: string | null;
  lgu: string | null;
  lang: "en" | "ja" | null;
}

const PCODE = /^PH\d{7}$/;
const PROV = /^PH\d{5}$/;

const BASE = import.meta.env.BASE_URL;

function pageOf(rel: string): Page {
  const p = rel.replace(/^\/+|\/+$/g, "").replace(/(^|\/)index\.html$/, "");
  return p === "" ? "map" : p === "about" ? "about" : "notfound";
}

export function parseUrl(pathname: string, search: string): UrlState {
  const q = new URLSearchParams(search);
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, "");
  const y = Number(q.get("year"));
  const lgu = q.get("lgu");
  const prov = q.get("prov");
  const lang = q.get("lang");
  return {
    page: pageOf(rel),
    year: Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null,
    lgu: lgu && PCODE.test(lgu) ? lgu : null,
    // An LGU implies its province (pcode prefix).
    prov: prov && PROV.test(prov) ? prov : lgu && PCODE.test(lgu) ? lgu.slice(0, 7) : null,
    lang: lang === "en" || lang === "ja" ? lang : null,
  };
}

export function formatUrl(s: UrlState): string {
  const q = new URLSearchParams();
  if (s.page === "map") {
    if (s.year != null) q.set("year", String(s.year));
    if (s.prov) q.set("prov", s.prov);
    if (s.lgu) q.set("lgu", s.lgu);
  }
  if (s.lang) q.set("lang", s.lang);
  const qs = q.toString();
  // "notfound" keeps the unknown path as it is (only ?lang= changes).
  const path = s.page === "notfound" && typeof location !== "undefined" ? location.pathname : `${BASE}${s.page === "about" ? "about" : ""}`;
  return `${path}${qs ? `?${qs}` : ""}`;
}

const listeners = new Set<() => void>();
let current: UrlState | null = null;
let currentKey = "";

function snapshot(): UrlState {
  const key = location.pathname + location.search;
  if (!current || key !== currentKey) {
    current = parseUrl(location.pathname, location.search);
    currentKey = key;
  }
  return current;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onPop = () => fn();
  window.addEventListener("popstate", onPop);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", onPop);
  };
}

export function useUrlState(): UrlState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Update the URL state; `replace` for continuous controls such as the year slider. */
export function navigate(patch: Partial<UrlState>, { replace = false } = {}) {
  const next = { ...snapshot(), ...patch };
  const url = formatUrl(next);
  if (url === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  for (const fn of listeners) fn();
}
