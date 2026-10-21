// The portfolio (krtmtthw.dev) frames /embed. This is the whole message protocol on the app side:
// "akari:embed-ready" out once the first full frame is drawn, "akari:theme" and "akari:embed-scale" in.
// Theme changes go through Akari's own store, so nothing of Akari is re-implemented here.

import { cookieDomainApplies, THEME_STORE_EVENT, writeContrast, writeTheme } from "@abrycta/akari/react";

export const PARENT_ORIGIN = "https://krtmtthw.dev";
export const COOKIE_DOMAIN = "krtmtthw.dev";

const framed = () => window.parent !== window;

/** Tell the parent the first full frame is painted (only when framed). */
export function postReady(): void {
  if (framed()) window.parent.postMessage({ type: "akari:embed-ready", app: "lights" }, PARENT_ORIGIN);
}

type ThemeMsg = { type: "akari:theme"; theme: "light" | "dark" | null; contrast: "more" | "normal" | null };
type ScaleMsg = { type: "akari:embed-scale"; scale: number };

/** Listen to the parent; returns the unsubscribe function. */
export function listenToParent(): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    const msg = e.data as Partial<ThemeMsg | ScaleMsg> | null;
    if (msg?.type === "akari:embed-scale") {
      const s = Number((msg as ScaleMsg).scale);
      if (s > 0 && s <= 1) document.documentElement.style.setProperty("--embed-scale", String(s));
    } else if (msg?.type === "akari:theme") {
      const m = msg as ThemeMsg;
      // On *.krtmtthw.dev the shared cookie already holds the parent's choice: just re-read it.
      if (cookieDomainApplies(location.hostname, COOKIE_DOMAIN)) window.dispatchEvent(new Event(THEME_STORE_EVENT));
      else {
        writeTheme(m.theme, {});
        writeContrast(m.contrast, {});
      }
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
