import { T, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, useLang, useT } from "@abrycta/akari/react";

import type { YearRecord } from "@/data/types";
import { cvText, interval, numShown } from "@/lib/format";
import { combinedNote, estimatorLabel, TIER_LABEL } from "@/lib/honesty";

/** Every year with value, interval, CV, tier, source and method. Backtest years show both lines. */
export function YearTable({ years, selected, onSelectYear, pcode }: { years: YearRecord[]; selected: number; onSelectYear: (y: number) => void; pcode?: string }) {
  const t = useT();
  const { lang } = useLang();
  const combined = combinedNote(pcode, lang);
  return (
    <Table className="text-xs" data-testid="year-table">
      <TableCaption className="text-left">
        <T
          en="Official rows are PSA Small Area Estimates (90 % confidence interval). Model rows are Lights estimates (90 % prediction interval). Lower limits below 0 are shown as 0."
          ja="公式の行はPSA小地域推計（90%信頼区間）。モデルの行はLightsの推計（90%予測区間）。0未満の下限は0と表示。"
        />
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Year", "年")}</TableHead>
          <TableHead>{t("Source", "出典")}</TableHead>
          <TableHead className="text-right">%</TableHead>
          <TableHead>{t("90 % interval", "90%区間")}</TableHead>
          <TableHead className="text-right">CV</TableHead>
          <TableHead>{t("Reliability", "信頼性")}</TableHead>
          <TableHead>{t("Method", "手法")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {years.map((r) => {
          const lines: { key: string; source: string; italic: boolean; v: number; lo: number; hi: number; cv: number; tier: 0 | 1 | 2; method: string }[] = [];
          if (r.official)
            lines.push({ key: "o", source: combined ? t("PSA, districts combined", "PSA（地区を合算）") : t("PSA official", "PSA公式"), italic: false, v: r.official.estimate, lo: r.official.lo90, hi: r.official.hi90, cv: r.official.cv, tier: r.official.tier, method: combined ? `${combined.charAt(0).toUpperCase()}${combined.slice(1)} · ${estimatorLabel(r.official.estimator)}` : `SAE · ${estimatorLabel(r.official.estimator)}` });
          if (r.model)
            lines.push({
              key: "m",
              source: r.model.kind === "backtest" ? t("Model without this round", "この調査回なしのモデル") : t("Model estimate", "モデル推計"),
              italic: true,
              v: r.model.estimate,
              lo: r.model.lo90,
              hi: r.model.hi90,
              cv: r.model.cv,
              tier: r.model.tier,
              method: t(`model from ${r.model.from}`, `${r.model.from}年から推計`),
            });
          const current = r.year === selected;
          if (!lines.length)
            return (
              <TableRow key={r.year} data-state={current ? "selected" : undefined}>
                <TableCell>
                  <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => onSelectYear(r.year)} aria-current={current ? "true" : undefined}>
                    {r.year}
                  </button>
                </TableCell>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {t("No estimate", "推計なし")}
                </TableCell>
              </TableRow>
            );
          return lines.map((l, i) => (
            <TableRow key={`${r.year}${l.key}`} data-state={current ? "selected" : undefined} className={i ? "border-t-0" : ""}>
              <TableCell>
                {i === 0 ? (
                  <button type="button" className="font-mono underline-offset-4 hover:underline" onClick={() => onSelectYear(r.year)} aria-current={current ? "true" : undefined}>
                    {r.year}
                  </button>
                ) : null}
              </TableCell>
              <TableCell className={l.italic ? "italic text-muted-foreground" : "font-medium"}>{l.source}</TableCell>
              <TableCell className={`text-right font-mono tabular ${l.italic ? "italic text-muted-foreground" : ""}`}>{numShown(l.v, l.italic)}</TableCell>
              <TableCell className="font-mono tabular">{interval(l.lo, l.hi, lang).text}</TableCell>
              <TableCell className="text-right font-mono tabular">{cvText(l.cv)}</TableCell>
              <TableCell>{TIER_LABEL[l.tier][lang]}</TableCell>
              <TableCell className="text-muted-foreground">{l.method}</TableCell>
            </TableRow>
          ));
        })}
      </TableBody>
    </Table>
  );
}
