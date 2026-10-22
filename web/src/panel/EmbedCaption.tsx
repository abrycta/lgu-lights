import { useLang } from "@abrycta/akari/react";
import { use } from "react";

import { loadLgu } from "@/data/load";
import { pct } from "@/lib/format";
import { sourceLabel } from "@/lib/honesty";

/**
 * The compact /embed's caption (phones and tablets, where the frame is the portfolio's picture slot at its real
 * size): the place and its figure in two short lines under the map, instead of the side panel.
 */
export function EmbedCaption({ pcode, year }: { pcode: string; year: number }) {
  const { lang } = useLang();
  const lgu = use(loadLgu(pcode));
  const shown = lgu.years.find((y) => y.year === year)?.shown ?? null;
  const model = shown?.source === "model";
  return (
    <div className="grid min-w-0 gap-0.5 leading-snug" data-testid="embed-caption">
      <p className="truncate text-sm">
        <span className="font-semibold">{lgu.name}</span>
        <span className="text-muted-foreground"> · {lgu.province.name}</span>
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {shown ? (
          <>
            {lang === "ja" ? "貧困線未満 " : null}
            <span className={`font-mono tabular text-foreground ${model ? "italic" : ""}`}>{pct(shown.value, lang)}</span>
            {lang === "ja" ? "・" : " below the poverty line · "}
            {sourceLabel(shown.source, year, lang)}
          </>
        ) : lang === "ja" ? (
          `${year}年の推計はありません。`
        ) : (
          `No estimate for ${year}.`
        )}
      </p>
    </div>
  );
}
