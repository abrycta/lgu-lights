// /embed: the portfolio's live picture of Lights. The real MapPage, fed from one pre-packed file
// (scripts/build-embed.mjs), without the Header or footer. It is wholly inert with nothing to focus (live
// embeds carry no link: the portfolio around the frame links to the app), and the map is non-interactive.
// It tours a few places (TOUR, chosen in build-embed.mjs): the same view, only the place changes, every
// DWELL_MS. It starts on the screenshot's place (the parent's poster), stays there under reduced motion,
// and pauses while the frame is out of sight.

import { AkariProvider, useLang } from "@abrycta/akari/react";
import {
  lazy,
  type RefObject,
  Suspense,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { parseUrl } from "@/app/url";
import { type EmbedPack, seedFromPack } from "@/data/load";

import { PACK_URL, TOUR, VIEW } from "./pack.gen";
import { COOKIE_DOMAIN, listenToParent, postReady } from "./parent-bridge";

const MapPage = lazy(() => import("@/pages/MapPage"));

/** Time on each place, the fades around a change (gentle out, slower in), and the map's settle ease. */
const DWELL_MS = 2200;
const FADE_OUT_MS = 300;
const FADE_IN_MS = 400;
const SETTLE_MS = 800;

const urlLang = parseUrl(location.pathname, location.search).lang;

/** `?pr=` from the parent (the frame is shown scaled down), clamped; default: the device's ratio, at most 2. */
function pixelRatio(): number {
  const pr = Number(new URLSearchParams(location.search).get("pr"));
  if (Number.isFinite(pr) && pr > 0) return Math.min(2, Math.max(0.5, pr));
  return Math.min(window.devicePixelRatio || 1, 2);
}

// The place shown: MapPage reads it from the URL, so the URL always names it (only lang and pr are kept).
// /embed is not one of the app's pages, so this writes the query itself; popstate tells useUrlState.
function showPlace(lgu: string, notify: boolean) {
  const given = new URLSearchParams(location.search);
  const q = new URLSearchParams({ year: String(VIEW.year), lgu });
  for (const k of ["lang", "pr"]) if (given.has(k)) q.set(k, given.get(k)!);
  history.replaceState(null, "", `${location.pathname}?${q}`);
  if (notify) window.dispatchEvent(new PopStateEvent("popstate"));
}
showPlace(VIEW.lgu, false);

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
      settleMs: SETTLE_MS,
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

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Steps through TOUR while the frame is in sight (IntersectionObserver: the parent scrolls it away; the
 * tab's visibility) and motion is allowed; each step fades the map and panel out, selects the next place
 * (the real app's selection: zoomed to its province, its panel open), and fades them back in.
 */
function useTour(frame: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = frame.current;
    if (!el || TOUR.length < 2) return;
    let step = 0;
    let timer: number | undefined;
    let inView = true;
    const fade = (to: number) =>
      Promise.all(
        [...el.querySelectorAll<HTMLElement>('[data-testid="map"], aside')].map(
          (n) =>
            n.animate(
              { opacity: to },
              {
                duration: to === 0 ? FADE_OUT_MS : FADE_IN_MS,
                easing: "cubic-bezier(0.4, 0, 0.2, 1)",
                fill: "forwards",
              },
            ).finished,
        ),
      ).catch(() => undefined);
    const show = (i: number) => {
      step = i;
      document.documentElement.dataset.tourStep = String(i);
      showPlace(TOUR[i]!, true);
    };
    const ready = () => "embedReady" in document.documentElement.dataset;
    const running = () =>
      inView && document.visibilityState === "visible" && !reducedMotion();
    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      if (running()) timer = window.setTimeout(advance, DWELL_MS);
    };
    async function advance() {
      if (!running()) return;
      if (!ready()) return schedule(); // the first place is still drawing
      await fade(0);
      show((step + 1) % TOUR.length);
      // Two frames for React and MapLibre to draw the new place, then back in while the map settles.
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await fade(1);
      schedule();
    }
    const io = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting;
      schedule();
    });
    io.observe(el);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      // Reduced motion: back to the first place (the poster's), statically.
      if (motion.matches && step !== 0) show(0);
      schedule();
    };
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", schedule);
    document.documentElement.dataset.tourStep = "0";
    schedule();
    return () => {
      clearTimeout(timer);
      io.disconnect();
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [frame]);
}

export function EmbedApp() {
  useEffect(() => listenToParent(), []);
  const frame = useRef<HTMLDivElement>(null);
  useTour(frame);
  return (
    <AkariProvider
      defaultLang={urlLang ?? "en"}
      toaster={false}
      sharedCookieDomain={COOKIE_DOMAIN}
      inlineScript={false}
    >
      <LangFromUrl />
      {/* Frozen view: panels are clipped at the frame like the screenshot, never scrollable (no scrollbars). */}
      <div
        ref={frame}
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
    </AkariProvider>
  );
}
