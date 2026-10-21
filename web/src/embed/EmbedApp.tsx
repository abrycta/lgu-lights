// /embed: one frozen view of the map (the portfolio's picture of Lights). The real MapPage, fed from one
// pre-packed file (scripts/build-embed.mjs), without the Header or footer; everything but the
// "Open the live app" link is inert, and the map is non-interactive.

import { AkariProvider, Button, T, useLang } from "@abrycta/akari/react";
import { lazy, Suspense, use, useEffect, useMemo, useRef } from "react";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { parseUrl } from "@/app/url";
import { type EmbedPack, seedFromPack } from "@/data/load";

import { PACK_URL, VIEW } from "./pack.gen";
import { COOKIE_DOMAIN, listenToParent, postReady } from "./parent-bridge";

const MapPage = lazy(() => import("@/pages/MapPage"));

export const LIVE_URL = `https://lights.krtmtthw.dev/?year=${VIEW.year}&lgu=${VIEW.lgu}`;

const urlLang = parseUrl(location.pathname, location.search).lang;

/** `?pr=` from the parent (the frame is shown scaled down), clamped; default: the device's ratio, at most 2. */
function pixelRatio(): number {
  const pr = Number(new URLSearchParams(location.search).get("pr"));
  if (Number.isFinite(pr) && pr > 0) return Math.min(2, Math.max(0.5, pr));
  return Math.min(window.devicePixelRatio || 1, 2);
}

// The one view: MapPage reads it from the URL, so the URL always names it (only lang and pr are kept).
{
  const given = new URLSearchParams(location.search);
  const q = new URLSearchParams({ year: String(VIEW.year), lgu: VIEW.lgu });
  for (const k of ["lang", "pr"]) if (given.has(k)) q.set(k, given.get(k)!);
  history.replaceState(null, "", `${location.pathname}?${q}`);
}

let pack: Promise<void> | null = null;
function loadPack(): Promise<void> {
  pack ??= fetch(PACK_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}: ${PACK_URL}`);
      return r.json() as Promise<EmbedPack>;
    })
    .then((p) => void seedFromPack(p));
  return pack;
}

function Frozen() {
  use(loadPack());
  const sent = useRef(false);
  const embed = useMemo(
    () => ({
      pixelRatio: pixelRatio(),
      onReady: () => {
        if (sent.current) return;
        sent.current = true;
        document.documentElement.dataset.embedReady = "";
        postReady();
      },
    }),
    [],
  );
  return <MapPage embed={embed} />;
}

function LangFromUrl() {
  const { lang, setLang } = useLang();
  useEffect(() => {
    if (urlLang && urlLang !== lang) setLang(urlLang);
    // Only once: ?lang= wins over a stored choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function EmbedApp() {
  useEffect(() => listenToParent(), []);
  return (
    <AkariProvider defaultLang={urlLang ?? "en"} toaster={false} sharedCookieDomain={COOKIE_DOMAIN} inlineScript={false}>
      <LangFromUrl />
      {/* Frozen view: panels are clipped at the frame like the screenshot, never scrollable (no scrollbars). */}
      <div
        inert
        className="h-dvh overflow-hidden [&_*]:[scrollbar-width:none] [&_aside]:!overflow-y-hidden"
        data-testid="embed-frame"
      >
        <ErrorBoundary>
          <Suspense fallback={null}>
            <Frozen />
          </Suspense>
        </ErrorBoundary>
      </div>
      <Button
        asChild
        variant="outline"
        className="fixed right-[calc(12px/var(--embed-scale,1))] bottom-[calc(12px/var(--embed-scale,1))] z-50 h-auto min-h-[calc(28px/var(--embed-scale,1))] bg-background px-[calc(10px/var(--embed-scale,1))] py-[calc(4px/var(--embed-scale,1))] text-[calc(14px/var(--embed-scale,1))] shadow-sm"
      >
        <a href={LIVE_URL} target="_blank" rel="noopener" data-testid="open-live">
          <T en="Open the live app ↗" ja="ライブ版を開く ↗" />
        </a>
      </Button>
    </AkariProvider>
  );
}
