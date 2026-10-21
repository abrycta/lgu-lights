import { MapLegend, T } from "@abrycta/akari/react";

import { classLabels, MODEL_OPACITY, OFFICIAL_OPACITY } from "@/lib/honesty";
import { HATCH_SIZES, hatchCss } from "@/map/hatch";

/** The map key: Akari's stepped ramp plus the honesty keys (official vs model, reliability, no data). */
export function Legend({ breaks, year, isRound }: { breaks: readonly number[]; year: number; isRound: boolean }) {
  const ticks = ["0", ...breaks.map(String), "100%"];
  return (
    <div className="grid gap-2 rounded-sm border border-border bg-background/95 p-3 text-xs shadow-sm" data-testid="legend">
      <MapLegend
        title={
          <>
            <T en="Poverty incidence" ja="貧困率" /> · {year}
          </>
        }
        labels={ticks}
      />
      <p className="sr-only">
        <T en={`Classes: ${classLabels(breaks).join(", ")}.`} ja={`階級：${classLabels(breaks).join("、")}`} />
      </p>
      <ul className="grid gap-1">
        <li className="flex items-center gap-2">
          <span className="swatch bg-chart-seq-4" style={{ opacity: OFFICIAL_OPACITY }} aria-hidden="true" />
          <T en="PSA official (solid)" ja="PSA公式統計（濃い色）" />
        </li>
        <li className="flex items-center gap-2">
          <span className="swatch bg-chart-seq-4" style={{ opacity: MODEL_OPACITY }} aria-hidden="true" />
          <span className="italic">
            <T en="Model estimate (lighter, not official)" ja="モデル推計（淡い色、非公式）" />
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="swatch bg-chart-seq-3" style={{ backgroundImage: hatchCss(HATCH_SIZES.sparse * 1.4) }} aria-hidden="true" />
          <T en="Use with caution (CV 10–20 %)" ja="注意して使用（CV 10〜20%）" />
        </li>
        <li className="flex items-center gap-2">
          <span className="swatch bg-chart-seq-3" style={{ backgroundImage: hatchCss(HATCH_SIZES.dense * 1.4) }} aria-hidden="true" />
          <T en="Unreliable (CV > 20 %)" ja="信頼性が低い（CV 20%超）" />
        </li>
        <li className="flex items-center gap-2">
          <span className="swatch bg-muted" aria-hidden="true" />
          <T en="No estimate" ja="推計なし" />
        </li>
      </ul>
      {!isRound ? (
        <p className="max-w-[16rem] text-muted-foreground italic">
          <T en={`${year} is not a PSA round: the map shows model estimates.`} ja={`${year}年はPSA調査年ではないため、地図はモデル推計を表示しています。`} />
        </p>
      ) : null}
    </div>
  );
}
