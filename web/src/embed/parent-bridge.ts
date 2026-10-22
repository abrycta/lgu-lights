// The portfolio (krtmtthw.dev) frames /embed. This is the whole message protocol on the app side:
// "akari:embed-ready" out once the first full frame is drawn; "akari:theme", "akari:embed-scale" and
// "akari:embed-pause" / "akari:embed-resume" in (the parent pauses the tour while the frame is off-screen, and on
// touch devices keeps only one embed moving). Only messages from the portfolio's own window and origin count.
// Theme changes go through Akari's own (framework-free) theme store, so nothing of Akari is re-implemented here.

import {
  applyToDocument,
  cookieDomainApplies,
  readStored,
  writeContrast,
  writeTheme,
} from "@abrycta/akari/react/lib/akari-theme-store";

export const PARENT_ORIGIN = "https://krtmtthw.dev";
export const COOKIE_DOMAIN = "krtmtthw.dev";

export const framed = (): boolean => window.parent !== window;

// Paused by the parent. `?paused=1` starts the frame still (the parent always sends the state once the frame is
// ready). Unframed, nothing can resume it, so it is ignored.
let paused = framed() && new URLSearchParams(location.search).get("paused") === "1";
const PAUSE_EVENT = "lights:embed-pause";
export const pausedByParent = (): boolean => paused;
/** Calls `fn` whenever the parent pauses or resumes the frame; returns the unsubscribe function. */
export function onPauseChange(fn: () => void): () => void {
  window.addEventListener(PAUSE_EVENT, fn);
  return () => window.removeEventListener(PAUSE_EVENT, fn);
}

/** Tell the parent the first full frame is painted (only when framed). */
export function postReady(): void {
  if (framed()) window.parent.postMessage({ type: "akari:embed-ready", app: "lights" }, PARENT_ORIGIN);
}

type ThemeMsg = { type: "akari:theme"; theme: "light" | "dark" | null; contrast: "more" | "normal" | null };
type ScaleMsg = { type: "akari:embed-scale"; scale: number };
type PauseMsg = { type: "akari:embed-pause" | "akari:embed-resume" };

/** Listen to the parent; returns the unsubscribe function. */
export function listenToParent(): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    const msg = e.data as Partial<ThemeMsg | ScaleMsg | PauseMsg> | null;
    if (msg?.type === "akari:embed-pause" || msg?.type === "akari:embed-resume") {
      const next = msg.type === "akari:embed-pause";
      if (next !== paused) {
        paused = next;
        window.dispatchEvent(new Event(PAUSE_EVENT));
      }
    } else if (msg?.type === "akari:embed-scale") {
      const s = Number((msg as ScaleMsg).scale);
      if (s > 0 && s <= 1) document.documentElement.style.setProperty("--embed-scale", String(s));
    } else if (msg?.type === "akari:theme") {
      const m = msg as ThemeMsg;
      // On *.krtmtthw.dev the shared cookie already holds the parent's choice: just re-read it.
      const store = { sharedCookieDomain: COOKIE_DOMAIN };
      if (!cookieDomainApplies(location.hostname, COOKIE_DOMAIN)) {
        writeTheme(m.theme, store);
        writeContrast(m.contrast, store);
      }
      applyToDocument(readStored(store));
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
