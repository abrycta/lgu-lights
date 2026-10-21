import { Badge, Button, T, useLang, useT } from "@abrycta/akari/react";
import { XIcon } from "lucide-react";
import { use, useEffect, useRef } from "react";

import { loadLgu } from "@/data/load";
import type { Manifest } from "@/data/types";
import { cvText, interval, pct } from "@/lib/format";
import { backtestNote, narrative } from "@/lib/narrative";
import { sourceLabel, TIER_LABEL } from "@/lib/honesty";

import { SeriesChart } from "./SeriesChart";
import { WhatIf } from "./WhatIf";
import { YearTable } from "./YearTable";

const CLASS_LABEL: Record<string, { en: string; ja: string }> = {
  city: { en: "City", ja: "市" },
  municipality: { en: "Municipality", ja: "町" },
  sga: { en: "Special geographic area", ja: "特別地理区域" },
};

export function LguPanel({ pcode, year, manifest, onClose, onSelectYear }: { pcode: string; year: number; manifest: Manifest; onClose: () => void; onSelectYear: (y: number) => void }) {
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
        <Button variant="ghost" size="icon" aria-label={t("Close details", "詳細を閉じる")} onClick={onClose}>
          <XIcon aria-hidden="true" />
        </Button>
      </header>

      <div className="grid gap-1">
        {shown ? (
          <>
            {shown.source === "official" ? (
              <Badge data-testid="source-badge">{sourceLabel("official", year, lang)}</Badge>
            ) : (
              <Badge variant="outline" className="border-dashed italic" data-testid="source-badge">
                {sourceLabel("model", year, lang)}
              </Badge>
            )}
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className={`font-mono text-3xl tabular ${shown.source === "model" ? "text-muted-foreground italic" : ""}`}>{pct(shown.value, lang)}</span>
              {src ? (
                <span className="text-sm">
                  <T en="90 % interval" ja="90%区間" /> <span className="font-mono">{interval(src.lo90, src.hi90, lang).text}</span>
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {TIER_LABEL[shown.tier][lang]}
              {src ? ` · CV ${cvText(src.cv)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            <T en={`No estimate for ${year}.`} ja={`${year}年の推計はありません。`} />
          </p>
        )}
      </div>

      {/* Caption-first narration: the interval and the reliability are always spoken. */}
      <p className="text-sm leading-relaxed" aria-live="polite" data-testid="narrative">
        {narrative(rec, year, lgu.name, lang)}
      </p>
      {bt ? (
        <p className="rounded-sm border border-dashed border-border p-2 text-xs italic" data-testid="backtest">
          {bt}{" "}
          <span className="not-italic text-muted-foreground">
            <T en="(A backtest: shown to judge the model, not to replace the official figure.)" ja="（検証用：モデルを評価するための表示で、公式値の代わりではありません。）" />
          </span>
        </p>
      ) : null}

      <SeriesChart years={lgu.years} selected={year} onSelectYear={onSelectYear} />

      <p className="text-xs text-muted-foreground">
        <T
          en="Method change: PSA used the ELL method for 2012–2018 and Census EB from 2021. Official figures on either side of the change are not strictly comparable."
          ja="手法の変更：PSAは2012〜2018年にELL法、2021年以降はCensus EB法を使用しています。変更の前後で公式値は厳密には比較できません。"
        />
      </p>

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

      <details open>
        <summary className="cursor-pointer text-sm font-medium">
          <T en="All years (table)" ja="全年の表" />
        </summary>
        <div className="mt-2 overflow-x-auto">
          <YearTable years={lgu.years} selected={year} onSelectYear={onSelectYear} />
        </div>
      </details>
    </article>
  );
}
