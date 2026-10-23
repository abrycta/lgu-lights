import { Button, MapLegend, MapLegendKey, T, useT } from "@abrycta/akari/react";

import { useGuide } from "@/app/prefs";
import { classLabels, MODEL_OPACITY, OFFICIAL_OPACITY, PLAIN_BINS } from "@/lib/honesty";

import { Term } from "./Term";

const SPAN = ["col-span-1", "col-span-2"] as const;

/** The map key: Akari's stepped ramp plus the honesty keys (official vs model, reliability, no data). */
export function Legend({ breaks, year, isRound }: { breaks: readonly number[]; year: number; isRound: boolean }) {
  const t = useT();
  const [, setGuide] = useGuide();
  const ticks = ["0", ...breaks.map(String), "100%"];
  return (
    <div className="seq-ramp grid w-72 max-w-full gap-2 rounded-sm border border-border bg-background/95 p-3 text-xs shadow-sm" data-testid="legend">
      <MapLegend
        title={
          <>
            <Term k="incidence" /> · {year}
          </>
        }
        labels={ticks}
      />
      {/* Plain names under the ramp, one column per colour class (High spans two). */}
      <ul className="grid grid-cols-5 gap-x-1 text-[10px] leading-tight text-muted-foreground" aria-label={t("Plain names for the colours", "色の目安")} data-testid="plain-bins">
        {PLAIN_BINS.map((b) => (
          <li key={b.name.en} className={SPAN[b.span - 1]}>
            <span className="block font-medium text-foreground">{t(b.name.en, b.name.ja)}</span>
            {t(b.range.en, b.range.ja)}
          </li>
        ))}
      </ul>
      <p className="sr-only">
        <T en={`Classes: ${classLabels(breaks).join(", ")}.`} ja={`階級：${classLabels(breaks).join("、")}`} />
      </p>
      <MapLegendKey
        items={[
          { fill: "seq-4", opacity: OFFICIAL_OPACITY, label: <T en="PSA official (solid)" ja="PSA公式統計（濃い色）" /> },
          { fill: "seq-4", opacity: MODEL_OPACITY, italic: true, label: <T en="Model estimate (lighter)" ja="モデル推計（淡い色）" /> },
          { fill: "seq-3", label: <T en="Solid (CV ≤ 10 %): no stripes" ja="確かな値（CV 10%以下）：斜線なし" /> },
          { fill: "seq-3", hatch: "sparse", label: <T en="Moderate range (CV 10–20 %)" ja="幅がやや広い値（CV 10〜20%）" /> },
          { fill: "seq-3", hatch: "dense", label: <T en="Wide range (CV > 20 %)" ja="幅が広い値（CV 20%超）" /> },
          { fill: "var(--ak-map-no-data)", label: <T en="No estimate" ja="推計なし" /> },
        ]}
      />
      {!isRound ? (
        <p className="max-w-[16rem] text-muted-foreground italic">
          <T en={`${year} is not a PSA round: the map shows model estimates.`} ja={`${year}年はPSA調査年ではないため、地図はモデル推計を表示しています。`} />
        </p>
      ) : null}
      <Button variant="link" size="sm" className="h-auto justify-self-start p-0 text-xs" onClick={() => setGuide(true)} data-testid="guide-open">
        <T en="How to read this map" ja="地図の読み方" />
      </Button>
    </div>
  );
}
