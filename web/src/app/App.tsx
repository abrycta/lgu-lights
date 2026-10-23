import { AkariProvider } from "@abrycta/akari/react";
import { lazy, Suspense } from "react";

import { ErrorBoundary } from "./ErrorBoundary";
import { Shell } from "./Shell";
import { parseUrl, useUrlState } from "./url";

/** Theme and contrast are shared with every *.krtmtthw.dev app (index.html loads the matching theme-init.js). */
export const THEME_COOKIE_DOMAIN = "krtmtthw.dev";

const MapPage = lazy(() => import("@/pages/MapPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

function initialLang(): "en" | "ja" {
  const fromUrl = parseUrl(location.pathname, location.search).lang;
  if (fromUrl) return fromUrl;
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** While a page's code loads: the shell (Header, footer) shows at once and this keeps the page's room, so the footer
 * does not jump; no loading screen (Kurt, 2026-10-23). */
function PageSpace() {
  return <div className="min-h-[calc(100dvh-var(--ak-layout-header-height))]" />;
}

function Pages() {
  const { page } = useUrlState();
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSpace />}>{page === "about" ? <AboutPage /> : page === "notfound" ? <NotFoundPage /> : <MapPage />}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <AkariProvider defaultLang={initialLang()} toaster={false} sharedCookieDomain={THEME_COOKIE_DOMAIN} inlineScript={false}>
      <Shell>
        <Pages />
      </Shell>
    </AkariProvider>
  );
}
