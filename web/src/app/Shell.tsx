import { AppShell, Header, HEADER_PORTFOLIO, T, useLang, useT } from "@abrycta/akari/react";
import { type MouseEvent, type ReactNode, Suspense, use, useEffect } from "react";

import { loadManifest } from "@/data/load";

import { formatUrl, navigate, type Page, type UrlState, useUrlState } from "./url";

/** In-app link: a real href (open in new tab works), client-side navigation on plain clicks. */
export function PageLink({ page, className, children, current }: { page: Exclude<Page, "notfound">; className?: string; children: ReactNode; current?: boolean }) {
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

/** Akari's Header, the same menu bar as krtmtthw.dev and every other app: data only; client-side navigation on plain clicks. */
export function LightsHeader({ url }: { url: UrlState }) {
  const t = useT();
  const href = (p: Page) => formatUrl({ ...url, page: p });
  return (
    <Header
      brand={{ name: "Lights", glyph: "光", href: href("map"), srSuffix: t("home", "ホーム") }}
      navLabel={t("Main", "メイン")}
      nav={[
        { href: href("map"), label: t("Map", "地図"), match: "exact" },
        { href: href("about"), label: t("About & method", "概要と手法"), match: "section" },
      ]}
      location={url.page === "notfound" ? undefined : { pathname: href(url.page) }}
      base={import.meta.env.BASE_URL}
      portfolioLink
      languages
      width="full"
      renderLink={(p) => (
        <a
          {...p}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate({ page: p.href === href("about") ? "about" : "map" });
            window.scrollTo(0, 0);
          }}
        />
      )}
    />
  );
}

/** The centred column of the text pages (About, not found): the same 1120px column and 16px gutter as Akari's Page and Replay's content pages. The map page stays full width. */
export const TEXT_COLUMN = "mx-auto max-w-[1120px] px-4";

export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const url = useUrlState();
  useLangParam();
  return (
    <AppShell
      header={<LightsHeader url={url} />}
      footer={
        <footer className="border-t border-border">
          <div className={`grid gap-2 py-6 text-xs text-muted-foreground ${url.page === "map" ? "px-ak-gutter" : TEXT_COLUMN}`}>
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
                en="Poverty estimates: PSA Small Area Estimates (official) and Lights model estimates. Boundaries: OCHA/NAMRIA/PSA COD-AB, CC BY-IGO, indicative."
                ja="貧困推計：PSA小地域推計（公式）とLightsのモデル推計。境界：OCHA/NAMRIA/PSA COD-AB（CC BY-IGO、参考）。"
              />{" "}
              <PageLink page="about" className="underline underline-offset-4">
                <T en="Sources and licences" ja="出典とライセンス" />
              </PageLink>
            </p>
            <p>
              <T en="A project by" ja="制作：" />{" "}
              <a href={HEADER_PORTFOLIO.href} className="underline underline-offset-4 hover:text-foreground">
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
