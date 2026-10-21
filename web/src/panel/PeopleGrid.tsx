import { useLang } from "@abrycta/akari/react";

import { peopleAlt, peopleCells } from "@/lib/plain";

const FILL = { sure: "fill-chart-seq-5", est: "fill-chart-seq-4", maybe: "fill-chart-seq-2", none: "fill-muted" } as const;

/**
 * #10 The 100-people picture: dark up to the lower limit, a middle shade up to the estimate, a light
 * shade for the rest of the uncertain range, empty above the upper limit. A model estimate gets dashed
 * outlines, like its line in the chart. The text alternative carries the same numbers.
 */
export function PeopleGrid({ est, lo, hi, model }: { est: number; lo: number; hi: number; model: boolean }) {
  const { lang } = useLang();
  const cells = peopleCells(est, lo, hi);
  const s = 10;
  const g = 2;
  const size = 10 * s + 9 * g;
  return (
    <figure className="m-0 grid shrink-0 justify-items-start gap-1" data-testid="people-grid">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-20 sm:w-24" role="img" aria-label={peopleAlt(est, lo, hi, lang)}>
        {cells.map((c, i) => (
          <rect
            key={i}
            x={(i % 10) * (s + g)}
            y={Math.floor(i / 10) * (s + g)}
            width={s}
            height={s}
            rx={s / 2}
            className={`${FILL[c]} ${model && c !== "none" ? "stroke-chart-seq-5" : ""}`}
            strokeWidth={model && c !== "none" ? 1 : 0}
            strokeDasharray={model ? "2 1.5" : undefined}
          />
        ))}
      </svg>
      <figcaption className="text-[10px] leading-tight text-muted-foreground" aria-hidden="true">
        {lang === "ja" ? "濃い色＝推計、淡い色＝不確かな範囲" : "dark = estimate, light = uncertain range"}
      </figcaption>
    </figure>
  );
}
