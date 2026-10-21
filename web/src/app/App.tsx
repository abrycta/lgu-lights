import { AkariProvider } from "@abrycta/akari/react";
import { lazy, Suspense } from "react";

import { ErrorBoundary } from "./ErrorBoundary";
import { Shell } from "./Shell";
import { parseUrl, useUrlState } from "./url";

/** Theme and contrast are shared with every *.krtmtthw.dev app (index.html loads the matching theme-init.js). */
export const THEME_COOKIE_DOMAIN = "krtmtthw.dev";

const MapPage = lazy(() => import("@/pages/MapPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));

function initialLang(): "en" | "ja" {
  const fromUrl = parseUrl(location.pathname, location.search).lang;
  if (fromUrl) return fromUrl;
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function Pages() {
  const { page } = useUrlState();
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">…</div>}>{page === "about" ? <AboutPage /> : <MapPage />}</Suspense>
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
