import { useLang, useT } from "@abrycta/akari/react";
import { useState } from "react";

import type { YearRecord } from "@/data/types";
import { interval, pct, pctShown } from "@/lib/format";
import { sourceLabel } from "@/lib/honesty";
import { clearChanges } from "@/lib/plain";
import { CENSUS_EB_FROM, LAST_ELL, yearSpan } from "@/lib/rounds";

const W = 360;
const H = 190;
const M = { l: 30, r: 8, t: 10, b: 36 };

/**
 * The series over the data version's years (2012–2025 in v5): official PSA points with 90 % CI whiskers (solid ink), model estimates as a
 * dashed line with 50 % and 90 % bands (lighter, Akari sequential scale). Backtest years show the
 * model's out-of-sample value as a hollow marker next to the official point. The year table below
 * carries the same numbers for screen readers.
 */
export function SeriesChart({ years, selected, onSelectYear }: { years: YearRecord[]; selected: number; onSelectYear: (y: number) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [hover, setHover] = useState<number | null>(null);
  if (!years.length) return null;
  const first = years[0]!.year;
  const last = years[years.length - 1]!.year;
  const top = Math.max(
    10,
    ...years.flatMap((y) => [y.official ? Math.max(0, y.official.hi90) : 0, y.model?.hi90 ?? 0]),
  );
  const yMax = Math.ceil(top / 10) * 10;
  const x = (yr: number) => M.l + ((yr - first) / (last - first)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - Math.max(0, Math.min(yMax, v)) / yMax) * (H - M.t - M.b);

  // Contiguous runs of model years (bands are drawn per run).
  const runs: YearRecord[][] = [];
  for (const r of years) {
    if (!r.model) continue;
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1]!.year === r.year - 1) run.push(r);
    else runs.push([r]);
  }
  const band = (run: YearRecord[], lo: "lo50" | "lo90", hi: "hi50" | "hi90") =>
    run.map((r, i) => `${i ? "L" : "M"}${x(r.year)},${y(r.model![hi])}`).join("") +
    [...run].reverse().map((r) => `L${x(r.year)},${y(r.model![lo])}`).join("") +
    "Z";
  const line = (run: YearRecord[]) => run.map((r, i) => `${i ? "L" : "M"}${x(r.year)},${y(r.model!.estimate)}`).join("");

  const ticks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10).filter((v, _, a) => a.length <= 6 || v % 20 === 0);
  const eraX = (x(LAST_ELL) + x(CENSUS_EB_FROM)) / 2;
  // #3 Official rounds whose change from the previous round (same method) beats the margin of error.
  const clear = clearChanges(years);
  const hv = hover != null ? years.find((r) => r.year === hover) : undefined;

  const tip = (r: YearRecord) => {
    const parts: string[] = [];
    if (r.official) parts.push(`${sourceLabel("official", r.year, lang)}: ${pct(r.official.estimate, lang)} (${interval(r.official.lo90, r.official.hi90, lang).text})`);
    const c = clear.get(r.year);
    if (c) parts.push(c === "up" ? t("clear rise since the previous round", "前回調査から明らかに増加") : t("clear fall since the previous round", "前回調査から明らかに減少"));
    if (r.model) parts.push(`${r.model.kind === "backtest" ? t("Model without this round", "この調査回なしのモデル") : sourceLabel("model", r.year, lang)}: ${pctShown(r.model.estimate, lang, true)} (${interval(r.model.lo90, r.model.hi90, lang).text})`);
    return parts.length ? parts : [t("No estimate", "推計なし")];
  };

  return (
    <figure className="m-0 grid gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={t(`Poverty incidence ${yearSpan(first, last, "en")}: official PSA points with 90 % intervals and model estimates with 50 % and 90 % bands. The table below lists every value.`, `${yearSpan(first, last, "ja")}年の貧困率：PSA公式値（90%区間）とモデル推計（50%・90%帯）。下の表にすべての値があります。`)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={0.5} />
            <text x={M.l - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
              {v}
            </text>
          </g>
        ))}
        {/* ELL -> Census EB method change between the last ELL and the first Census EB round. */}
        <line x1={eraX} x2={eraX} y1={M.t} y2={H - M.b} className="stroke-muted-foreground" strokeDasharray="2 3" strokeWidth={1} />
        <text x={eraX - 3} y={M.t + 8} textAnchor="end" className="fill-muted-foreground text-[8px]">
          ELL
        </text>
        <text x={eraX + 3} y={M.t + 8} className="fill-muted-foreground text-[8px]">
          Census EB
        </text>
        {/* Selected year. */}
        <rect x={x(selected) - 7} y={M.t} width={14} height={H - M.t - M.b} className="fill-muted" />
        {runs.map((run, i) => (
          <g key={i}>
            <path d={band(run, "lo90", "hi90")} className="fill-chart-seq-2" opacity={0.7} />
            <path d={band(run, "lo50", "hi50")} className="fill-chart-seq-3" opacity={0.75} />
            <path d={line(run)} className="stroke-chart-seq-5" fill="none" strokeWidth={2} strokeDasharray="4 3" />
          </g>
        ))}
        {years.map((r) =>
          r.model?.kind === "backtest" ? (
            <circle key={`b${r.year}`} cx={x(r.year) + 5} cy={y(r.model.estimate)} r={3.5} className="fill-background stroke-chart-seq-5" strokeWidth={1.5} />
          ) : null,
        )}
        {years.map((r) =>
          r.official ? (
            <g key={`o${r.year}`}>
              <line x1={x(r.year)} x2={x(r.year)} y1={y(r.official.lo90)} y2={y(r.official.hi90)} className="stroke-foreground" strokeWidth={1.5} />
              <line x1={x(r.year) - 3} x2={x(r.year) + 3} y1={y(r.official.lo90)} y2={y(r.official.lo90)} className="stroke-foreground" strokeWidth={1.5} />
              <line x1={x(r.year) - 3} x2={x(r.year) + 3} y1={y(r.official.hi90)} y2={y(r.official.hi90)} className="stroke-foreground" strokeWidth={1.5} />
              <circle cx={x(r.year)} cy={y(r.official.estimate)} r={4} className="fill-foreground stroke-background" strokeWidth={1.5} />
            </g>
          ) : null,
        )}
        {years.map((r) => {
          const c = r.official ? clear.get(r.year) : undefined;
          if (!c || !r.official) return null;
          // A small triangle to the left of the point: ▲ clear rise, ▼ clear fall.
          const cx = x(r.year) - 8;
          const cy = y(r.official.estimate);
          const d = c === "up" ? `M${cx - 3},${cy + 2}L${cx + 3},${cy + 2}L${cx},${cy - 3}Z` : `M${cx - 3},${cy - 2}L${cx + 3},${cy - 2}L${cx},${cy + 3}Z`;
          return <path key={`c${r.year}`} d={d} className="fill-muted-foreground" data-testid={`clear-${c}-${r.year}`} />;
        })}
        {years.map((r) =>
          r.year % 2 === 0 || r.year === last ? (
            <text key={`x${r.year}`} x={x(r.year)} y={H - M.b + 12} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
              {`'${String(r.year % 100).padStart(2, "0")}`}
            </text>
          ) : null,
        )}
        {/* Hit columns: hover shows the values, click selects the year (keyboard users use the table). */}
        {years.map((r) => (
          <rect
            key={`h${r.year}`}
            x={x(r.year) - (W - M.l - M.r) / (last - first) / 2}
            y={M.t}
            width={(W - M.l - M.r) / (last - first)}
            height={H - M.t - M.b}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHover(r.year)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelectYear(r.year)}
          />
        ))}
        {hv ? <line x1={x(hv.year)} x2={x(hv.year)} y1={M.t} y2={H - M.b} className="stroke-foreground pointer-events-none" strokeWidth={0.75} /> : null}
        <g transform={`translate(${M.l}, ${H - 12})`} className="text-[9px]">
          <circle cx={4} cy={-3} r={3.5} className="fill-foreground" />
          <text x={11} y={0} className="fill-foreground">
            {t("PSA official ± 90 %", "PSA公式 ±90%")}
          </text>
          <line x1={110} x2={126} y1={-3} y2={-3} className="stroke-chart-seq-5" strokeWidth={2} strokeDasharray="4 3" />
          <text x={130} y={0} className="fill-foreground italic">
            {t("Model estimate (50/90 % bands)", "モデル推計（50/90%帯）")}
          </text>
        </g>
      </svg>
      <div className="min-h-10 text-xs" aria-hidden="true">
        {hv ? (
          <>
            <span className="font-mono">{hv.year}</span> · {tip(hv).join(" · ")}
          </>
        ) : (
          <span className="text-muted-foreground">{t("Hover a year for values; ○ = model without that round (backtest); ▲▼ = change since the previous PSA round bigger than the margin of error.", "年にカーソルを合わせると値を表示。○＝その調査回なしのモデル（検証）。▲▼＝前回のPSA調査からの変化が誤差の範囲を超えるもの。")}</span>
        )}
      </div>
    </figure>
  );
}
