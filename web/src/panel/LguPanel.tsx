import { Button, SourceBadge, T, ToggleGroup, ToggleGroupItem, useLang, useT } from "@abrycta/akari/react";
import { XIcon } from "lucide-react";
import { use, useEffect, useRef } from "react";

import { useViewMode } from "@/app/prefs";
import { loadLgu } from "@/data/load";
import type { Index, Manifest } from "@/data/types";
import { Glossary } from "@/features/Term";
import { cvText, interval, pctInline } from "@/lib/format";
import { backtestNote, narrative } from "@/lib/narrative";
import { TIER_LABEL } from "@/lib/honesty";
import { reliabilitySentence, shownFigure } from "@/lib/plain";
import { CENSUS_EB_FROM, LAST_ELL, yearSpan } from "@/lib/rounds";

import { PeopleGrid } from "./PeopleGrid";
import { PlainWords } from "./PlainWords";

import { SeriesChart } from "./SeriesChart";
import { WhatIf } from "./WhatIf";
import { YearTable } from "./YearTable";

const CLASS_LABEL: Record<string, { en: string; ja: string }> = {
  city: { en: "City", ja: "市" },
  municipality: { en: "Municipality", ja: "町" },
  sga: { en: "Special geographic area", ja: "特別地理区域" },
};

/** Simple (default) or Detailed: Detailed adds intervals, CV, the technical sentence, method notes and the full table. */
function ViewSwitch() {
  const t = useT();
  const [mode, setMode] = useViewMode();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={mode}
      onValueChange={(v) => v && setMode(v as typeof mode)}
      aria-label={t("Level of detail", "表示の詳しさ")}
      data-testid="view-switch"
    >
      <ToggleGroupItem value="simple">{t("Simple", "シンプル")}</ToggleGroupItem>
      <ToggleGroupItem value="detailed">{t("Detailed", "詳細")}</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function LguPanel({
  pcode,
  year,
  manifest,
  index,
  onClose,
  onSelectYear,
}: {
  pcode: string;
  year: number;
  manifest: Manifest;
  index: Index;
  onClose: () => void;
  onSelectYear: (y: number) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const lgu = use(loadLgu(pcode));
  const heading = useRef<HTMLHeadingElement>(null);
  // Move focus to the new panel so keyboard and screen-reader users land on what they selected.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [pcode]);

  const rec = lgu.years.find((y) => y.year === year);
  const shown = rec?.shown ?? null;
  const lastRound = Math.max(...lgu.years.filter((y) => y.official).map((y) => y.year), -Infinity);
  const canWhatIf = !!rec?.model && year > lastRound;
  const bt = rec ? backtestNote(rec, lang) : null;
  const src = shown?.source === "official" ? rec?.official : rec?.model;
  const cls = CLASS_LABEL[lgu.class];
  const fig = shownFigure(rec);
  const [mode] = useViewMode();
  const detailed = mode === "detailed";

  return (
    <article className="grid min-w-0 gap-4 [&>*]:min-w-0" data-testid="lgu-panel" aria-labelledby="lgu-name">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 id="lgu-name" ref={heading} tabIndex={-1} className="font-display text-xl outline-none">
            {lgu.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {cls ? cls[lang] : lgu.class} · {lgu.province.name} · {lgu.region.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ViewSwitch />
          <Button variant="ghost" size="icon" aria-label={t("Close details", "詳細を閉じる")} onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          {shown ? (
            <>
              {shown.source === "official" ? (
                <SourceBadge source="official" year={year} label={<T en="PSA official" ja="PSA公式統計" />} data-testid="source-badge" />
              ) : (
                <SourceBadge source="estimate" year={year} data-testid="source-badge" />
              )}
              <p className="flex flex-wrap items-baseline gap-x-3">
                {/* The badge above already says "Model estimate", so a 0.0 estimate reads just "below 1 %" (no duplicate facts). */}
                <span className={`font-mono text-3xl tabular ${shown.source === "model" ? "text-muted-foreground italic" : ""}`}>{pctInline(shown.value, lang, shown.source === "model")}</span>
                {src && detailed ? (
                  <span className="text-sm">
                    <T en="90 % interval" ja="90%区間" /> <span className="font-mono">{interval(src.lo90, src.hi90, lang).text}</span>
                  </span>
                ) : null}
              </p>
              {/* #4 Reliability in plain words (both views); CV in Detailed only. */}
              <p className="text-xs" data-testid="reliability">
                {src ? reliabilitySentence(shown.tier, src.lo90, src.hi90, lang) : TIER_LABEL[shown.tier][lang]}
                {src && detailed ? <span className="text-muted-foreground"> · CV {cvText(src.cv)}</span> : null}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              <T en={`No estimate for ${year}.`} ja={`${year}年の推計はありません。`} />
            </p>
          )}
        </div>
        {fig ? <PeopleGrid est={fig.est} lo={fig.lo} hi={fig.hi} model={fig.source === "model"} /> : null}
      </div>

      <PlainWords lgu={lgu} rec={rec} year={year} index={index} />

      {detailed ? (
        <>
          {/* Caption-first narration: the interval and the reliability are always spoken. */}
          <p className="text-sm leading-relaxed" data-testid="narrative">
            {narrative(rec, year, lgu.name, lang, lgu.pcode)}
          </p>
          {bt ? (
            <p className="rounded-sm border border-dashed border-border p-2 text-xs italic" data-testid="backtest">
              {bt}{" "}
              <span className="not-italic text-muted-foreground">
                <T en="(A backtest: shown to judge the model, not to replace the official figure.)" ja="（検証用：モデルを評価するための表示で、公式値の代わりではありません。）" />
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <p className="sr-only" aria-live="polite">
          {narrative(rec, year, lgu.name, lang, lgu.pcode)}
        </p>
      )}

      <SeriesChart years={lgu.years} selected={year} onSelectYear={onSelectYear} />

      {detailed ? (
        <p className="text-xs text-muted-foreground">
          <T
            en={`Method change: PSA used the ELL method for ${yearSpan(manifest.rounds[0]!, LAST_ELL, "en")} and Census EB from ${CENSUS_EB_FROM}. Official figures on either side of the change are not strictly comparable.`}
            ja={`手法の変更：PSAは${yearSpan(manifest.rounds[0]!, LAST_ELL, "ja")}年にELL法、${CENSUS_EB_FROM}年以降はCensus EB法を使用しています。変更の前後で公式値は厳密には比較できません。`}
          />
        </p>
      ) : null}

      {canWhatIf && rec ? (
        <WhatIf key={`${pcode}-${year}`} pcode={pcode} name={lgu.name} rec={rec} widen={manifest.model.whatif_widen} />
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="whatif-unavailable">
          <T
            en={`What-if scenarios are available for model years after the last PSA round${Number.isFinite(lastRound) ? ` (${lastRound})` : ""}.`}
            ja={`仮定のシナリオは、最後のPSA調査${Number.isFinite(lastRound) ? `（${lastRound}年）` : ""}より後のモデル推計年で使えます。`}
          />{" "}
          {manifest.years
            .filter((y) => y > lastRound)
            .map((y) => (
              <Button key={y} variant="link" size="sm" className="h-auto p-0 px-1" onClick={() => onSelectYear(y)}>
                {y}
              </Button>
            ))}
        </p>
      )}

      <Glossary />

      {detailed ? (
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            <T en="All years (table)" ja="全年の表" />
          </summary>
          <div className="mt-2 overflow-x-auto">
            <YearTable years={lgu.years} selected={year} onSelectYear={onSelectYear} pcode={lgu.pcode} />
          </div>
        </details>
      ) : null}
    </article>
  );
}
