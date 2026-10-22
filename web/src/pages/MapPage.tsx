import { Button, T, useContrast, useLang, useT, useTheme } from "@abrycta/akari/react";
import { lazy, Suspense, use, useCallback, useMemo, useState } from "react";

import { navigate, useUrlState } from "@/app/url";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { dataBase, loadIndex, loadManifest, loadNational } from "@/data/load";
import type { Index } from "@/data/types";
import { nationalSentence, valuesOf } from "@/lib/plain";
import { Legend } from "@/features/Legend";
import { LguSearch } from "@/features/LguSearch";
import { ProvincePicker } from "@/features/ProvincePicker";
import { Guide } from "@/features/Guide";
import { ProvinceView } from "@/features/ProvinceTable";
import { GlyphLoading } from "@/features/GlyphLoading";
import { Glossary } from "@/features/Term";
import { YearControl } from "@/features/YearControl";
import { MapGlyph } from "@/map/MapGlyph";
import type { MapViewProps } from "@/map/MapView";
import { themeKey } from "@/map/style";
import { EmbedCaption } from "@/panel/EmbedCaption";
import { LguPanel } from "@/panel/LguPanel";

const MapView = lazy(() => import("@/map/MapView"));

function Loading() {
  return (
    <p className="px-ak-gutter py-4 text-sm text-muted-foreground">
      <GlyphLoading />
    </p>
  );
}

function SyntheticBanner({ version }: { version: string }) {
  if (!/synthetic|^v0/.test(version)) return null;
  return (
    <p role="note" className="border-b border-seal bg-seal/10 px-ak-gutter py-2 text-xs" data-testid="synthetic-banner">
      <T
        en={`Development data (${version}): satellite inputs are synthetic, so the model estimates are placeholders, not real results. PSA figures are real.`}
        ja={`開発用データ（${version}）：衛星データは合成のため、モデル推計は仮の値で実際の結果ではありません。PSAの値は実データです。`}
      />
    </p>
  );
}

/** #8 One descriptive sentence per year: highest and lowest regions, by the average of their places. */
function NationalLine({ index, year, isRound }: { index: Index; year: number; isRound: boolean }) {
  const { lang } = useLang();
  const national = use(loadNational());
  const regionOf = useMemo(() => new Map(index.lgus.map((l) => [l.p, l.r])), [index]);
  const regionName = useMemo(() => new Map(index.regions.map((r) => [r.p, r.n])), [index]);
  if (!national) return null;
  const source = isRound ? "official" : "model";
  const s = nationalSentence({ year, source, values: valuesOf(national, year, source), regionOf, regionName }, lang);
  return s ? (
    <p className="border-b border-border px-ak-gutter py-2 text-xs leading-relaxed" data-testid="national-sentence">
      {s}
    </p>
  ) : null;
}

function Intro() {
  return (
    <div className="grid gap-3 text-sm" data-testid="intro">
      <h2 className="font-display text-xl">
        <T en="Poverty in every city and municipality" ja="すべての市町村の貧困率" />
      </h2>
      <p>
        <T
          en="PSA publishes official small-area poverty estimates only every few years (2012, 2015, 2018, 2021, 2023). Between and after those rounds, Lights fills the gaps with model estimates built on past PSA rounds, PSA's provincial poverty survey and satellite data (night-time lights, vegetation)."
          ja="PSAの公式な小地域貧困推計は数年ごと（2012・2015・2018・2021・2023年）にしか公表されません。その間と以後の年は、過去のPSA調査、PSAの州別貧困調査、衛星データ（夜間光・植生）に基づくモデル推計で補っています。"
        />
      </p>
      <p>
        <T
          en="Model estimates are not official statistics. They are drawn lighter, labelled “Model estimate”, and always come with an interval. Stripes mark figures to “Use with care” (CV over 10 %) and “Rough guesses” (over 20 %); figures without stripes are “Solid”."
          ja="モデル推計は公式統計ではありません。淡い色で描き、「モデル推計」と表示し、必ず区間を添えています。斜線は「注意して使う値」（CV 10%超）と「おおよその目安」（20%超）を示し、斜線のない値は「確かな値」です。"
        />
      </p>
      <Glossary />
      <p className="text-muted-foreground">
        <T en="Choose a province (map or list), then a city or municipality, or search by name." ja="地図か一覧で州を選び、次に市町村を選ぶか、名前で検索してください。" />
      </p>
    </div>
  );
}

/** `embed`: the frozen /embed view (src/embed): the full viewport, no first-visit guide, a frozen map. */
export default function MapPage({ embed }: { embed?: MapViewProps["frozen"] } = {}) {
  const t = useT();
  const { lang } = useLang();
  const { resolvedTheme } = useTheme();
  const { active: hc } = useContrast();
  const manifest = use(loadManifest());
  const index = use(loadIndex());
  const base = use(dataBase());
  const url = useUrlState();
  const [announce, setAnnounce] = useState("");

  const lastRound = manifest.rounds[manifest.rounds.length - 1]!;
  const year = url.year != null && manifest.years.includes(url.year) ? url.year : lastRound;
  const province = useMemo(() => index.provinces.find((p) => p.pcode === url.prov) ?? null, [index, url.prov]);
  const names = useMemo(() => new Map(index.lgus.map((l) => [l.p, l.n])), [index]);

  const selectLgu = useCallback(
    (pcode: string) => {
      navigate({ prov: pcode.slice(0, 7), lgu: pcode });
      setAnnounce(t(`Selected ${names.get(pcode) ?? pcode}`, `${names.get(pcode) ?? pcode}を選択`));
    },
    [names, t],
  );
  const selectProvince = useCallback(
    (pcode: string | null) => {
      navigate({ prov: pcode, lgu: null });
      const p = index.provinces.find((x) => x.pcode === pcode);
      setAnnounce(p ? t(`Province ${p.name}`, `${p.name}州`) : t("Whole country", "全国"));
    },
    [index, t],
  );
  // Map click: national view picks the province first; inside a province it picks the LGU.
  const onPick = useCallback(
    (pcode: string) => {
      const prov = pcode.slice(0, 7);
      if (!url.prov) selectProvince(prov);
      else selectLgu(pcode);
    },
    [url.prov, selectLgu, selectProvince],
  );
  const setYear = useCallback((y: number) => navigate({ year: y }, { replace: true }), []);

  // The compact /embed (phones and tablets: the frame is the portfolio's picture slot at its real size): the map
  // above a two-line caption, no controls or side panel. Never the desktop view scaled down.
  if (embed?.compact)
    return (
      <div className="flex h-dvh flex-col" data-layout="compact">
        <div className="relative min-h-0 flex-1">
          <ErrorBoundary>
            <Suspense fallback={<MapGlyph />}>
              <MapView base={base} year={year} breaks={manifest.breaks} theme={themeKey(resolvedTheme, hc)} lang={lang} province={province} lgu={url.lgu} names={names} onPick={onPick} frozen={embed} />
            </Suspense>
          </ErrorBoundary>
        </div>
        {/* Fixed height (scripts/build-embed.mjs packs the tiles for the map box above it). */}
        <aside className="h-[52px] shrink-0 overflow-hidden border-t border-border px-3 py-1.5" aria-label={t("Details", "詳細")}>
          <ErrorBoundary>
            <Suspense fallback={null}>{url.lgu ? <EmbedCaption pcode={url.lgu} year={year} /> : null}</Suspense>
          </ErrorBoundary>
        </aside>
      </div>
    );

  return (
    <>
      <SyntheticBanner version={manifest.version} />
      <div className={`flex flex-col lg:flex-row ${embed ? "h-dvh" : "lg:h-[calc(100dvh-81px)]"}`}>
        <section className="flex min-w-0 flex-1 flex-col" aria-label={t("Map and controls", "地図と操作")}>
          <div className="grid gap-3 border-b border-border px-ak-gutter py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
            <YearControl years={manifest.years} rounds={manifest.rounds} year={year} onChange={setYear} />
            <ProvincePicker index={index} value={url.prov} onChange={selectProvince} />
            <LguSearch index={index} value={url.lgu} onSelect={selectLgu} />
          </div>
          <Suspense fallback={null}>
            <NationalLine index={index} year={year} isRound={manifest.rounds.includes(year)} />
          </Suspense>
          <div className="relative min-h-[55vh] flex-1">
            <ErrorBoundary>
              <Suspense fallback={<MapGlyph />}>
                <MapView base={base} year={year} breaks={manifest.breaks} theme={themeKey(resolvedTheme, hc)} lang={lang} province={province} lgu={url.lgu} names={names} onPick={onPick} frozen={embed} />
              </Suspense>
            </ErrorBoundary>
            <div className="pointer-events-none absolute bottom-8 left-ak-gutter hidden max-w-[70%] md:block [&>*]:pointer-events-auto">
              <Legend breaks={manifest.breaks} year={year} isRound={manifest.rounds.includes(year)} />
            </div>
            {embed ? null : (
              <div className="absolute top-2 right-2 z-10">
                <Guide />
              </div>
            )}
            {province ? (
              <div className="absolute top-2 left-ak-gutter">
                <Button variant="outline" size="sm" className="bg-background" onClick={() => selectProvince(null)}>
                  <T en="← Whole country" ja="← 全国" />
                </Button>
              </div>
            ) : null}
          </div>
          {/* Small screens: the key goes under the map instead of covering it. */}
          <div className="border-t border-border px-ak-gutter py-2 md:hidden">
            <Legend breaks={manifest.breaks} year={year} isRound={manifest.rounds.includes(year)} />
          </div>
        </section>
        <aside className="w-full min-w-0 overflow-x-hidden overflow-y-auto border-t border-border px-ak-gutter py-4 lg:w-[460px] lg:border-t-0 lg:border-l" aria-label={t("Details", "詳細")}>
          <ErrorBoundary>
            <Suspense fallback={<Loading />}>
              {url.lgu ? (
                <LguPanel pcode={url.lgu} year={year} manifest={manifest} index={index} onClose={() => navigate({ lgu: null })} onSelectYear={setYear} />
              ) : province ? (
                <ProvinceView index={index} province={province} year={year} rounds={manifest.rounds} onSelect={selectLgu} />
              ) : (
                <Intro />
              )}
            </Suspense>
          </ErrorBoundary>
        </aside>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </>
  );
}
