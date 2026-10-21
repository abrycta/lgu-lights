// Per-visitor conveniences kept in localStorage: the Simple/Detailed view and the dismissed
// first-visit guide. Every access is wrapped in try/catch (private windows, blocked storage), and the
// app works the same without storage: it just forgets.

import { useSyncExternalStore } from "react";

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: keep the in-memory value only */
  }
}

/** A small shared store per key, so every component reading a preference updates together. */
function prefStore<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  const get = (): T => {
    if (value == null) {
      const v = readPref(key) as T | null;
      value = v && allowed.includes(v) ? v : fallback;
    }
    return value;
  };
  const set = (v: T) => {
    value = v;
    writePref(key, v);
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return { get, set, subscribe };
}

export type ViewMode = "simple" | "detailed";
const viewStore = prefStore<ViewMode>("lights.view", "simple", ["simple", "detailed"]);

/** Simple (default) or Detailed panel. */
export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const v = useSyncExternalStore(viewStore.subscribe, viewStore.get, () => "simple" as const);
  return [v, viewStore.set];
}

const guideStore = prefStore<"open" | "dismissed">("lights.guide", "open", ["open", "dismissed"]);

/** The first-visit "How to read this map" guide: open until dismissed, reopened from the legend. */
export function useGuide(): [boolean, (open: boolean) => void] {
  const v = useSyncExternalStore(guideStore.subscribe, guideStore.get, () => "dismissed" as const);
  return [v === "open", (open) => guideStore.set(open ? "open" : "dismissed")];
}
