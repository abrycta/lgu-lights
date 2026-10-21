import { AppShell, ContrastToggle, Header, LangSwitch, Logo, T, ThemeToggle, useLang, useT } from "@abrycta/akari/react";
import { ArrowLeftIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, Suspense, use, useEffect } from "react";

import { loadManifest } from "@/data/load";

import { formatUrl, navigate, type Page, useUrlState } from "./url";

const PORTFOLIO_URL = "https://krtmtthw.dev";

/** In-app link: a real href (open in new tab works), client-side navigation on plain clicks. */
export function PageLink({ page, className, children, current }: { page: Page; className?: string; children: ReactNode; current?: boolean }) {
  const url = useUrlState();
  const href = formatUrl({ ...url, page });
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate({ page });
    window.scrollTo(0, 0);
  };
  return (
    <a href={href} onClick={onClick} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

/** Keeps ?lang= in shared links in step with the language switch. */
function useLangParam() {
  const { lang, setLang } = useLang();
  const url = useUrlState();
  useEffect(() => {
    if (url.lang && url.lang !== lang) setLang(url.lang);
    // Only on load / history navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
    if (url.lang && url.lang !== lang) navigate({ lang }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
}

function FooterData() {
  const m = use(loadManifest());
  const asOf = m.provenance?.data_as_of ?? m.provenance?.as_of;
  return (
    <>
      <span>
        <T en="Data version" ja="データ版" /> <span className="font-mono">{m.version}</span>
      </span>
      <span>
        <T en="generated" ja="生成" /> <span className="font-mono">{m.generated_at}</span>
      </span>
      <span>
        <T en="data commit" ja="データのコミット" /> <span className="font-mono">{m.git_sha.slice(0, 7)}</span>
      </span>
      {typeof asOf === "string" ? (
        <span>
          <T en="data as of" ja="データ時点" /> <span className="font-mono">{asOf}</span>
        </span>
      ) : null}
    </>
  );
}

const PORTFOLIO_LINK = "inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/** Back to the author's portfolio, in the same tab (as in Typhoon Replay). On phones only the arrow shows; screen readers hear whose site it is. */
function PortfolioLink() {
  const t = useT();
  return (
    <a href={PORTFOLIO_URL} className={PORTFOLIO_LINK} data-testid="portfolio-link">
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      <span className="hidden sm:inline">krtmtthw.dev</span>
      <span className="sr-only"> ({t("Kurt's portfolio", "Kurtのポートフォリオ")})</span>
    </a>
  );
}

const NAV_LINK = "rounded-sm px-1 py-0.5 whitespace-nowrap hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline underline-offset-4";

export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const { page } = useUrlState();
  useLangParam();
  return (
    <AppShell
      header={
        <Header
          brand={
            <>
              <PageLink page="map" className="rounded-sm">
                <Logo name="Lights" glyph="光" size="sm" />
                <span className="sr-only"> {t("home", "ホーム")}</span>
              </PageLink>
              <nav aria-label={t("Main", "メイン")} className="flex items-center gap-3 text-sm text-muted-foreground">
                <PageLink page="map" className={NAV_LINK} current={page === "map"}>
                  <T en="Map" ja="地図" />
                </PageLink>
                <PageLink page="about" className={NAV_LINK} current={page === "about"}>
                  <T en="About & method" ja="概要と手法" />
                </PageLink>
              </nav>
            </>
          }
          actions={
            <>
              <PortfolioLink />
              <LangSwitch />
              <ThemeToggle variant="compact" />
              <ContrastToggle />
            </>
          }
        />
      }
      footer={
        <footer className="border-t border-border">
          <div className="mx-auto grid max-w-[1120px] gap-2 px-4 py-6 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Suspense fallback={null}>
                <FooterData />
              </Suspense>
              <span>
                <T en="app" ja="アプリ" /> <span className="font-mono">{__COMMIT_SHA__.slice(0, 7)}</span>
              </span>
            </div>
            <p>
              <T
                en="Poverty estimates: PSA Small Area Estimates (official) and Lights model estimates (not official). Boundaries: OCHA/NAMRIA/PSA COD-AB, CC BY-IGO, indicative."
                ja="貧困推計：PSA小地域推計（公式）とLightsのモデル推計（非公式）。境界：OCHA/NAMRIA/PSA COD-AB（CC BY-IGO、参考）。"
              />{" "}
              <PageLink page="about" className="underline underline-offset-4">
                <T en="Sources and licences" ja="出典とライセンス" />
              </PageLink>
            </p>
            <p>
              <T en="A project by" ja="制作：" />{" "}
              <a href={PORTFOLIO_URL} className="underline underline-offset-4 hover:text-foreground">
                Kurt · krtmtthw.dev
              </a>
            </p>
          </div>
        </footer>
      }
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:p-2">
        {t("Skip to content", "本文へ移動")}
      </a>
      <div id="main" tabIndex={-1} className="outline-none">
        {children}
      </div>
    </AppShell>
  );
}
