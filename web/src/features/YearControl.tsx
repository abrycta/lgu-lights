import { Button, T, useT } from "@abrycta/akari/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useId } from "react";

export function YearControl({ years, rounds, year, onChange }: { years: number[]; rounds: number[]; year: number; onChange: (y: number) => void }) {
  const t = useT();
  const id = useId();
  const min = years[0]!;
  const max = years[years.length - 1]!;
  const isRound = rounds.includes(year);
  const step = (d: number) => onChange(Math.min(max, Math.max(min, year + d)));
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          <T en="Year" ja="年" /> <span className="font-mono text-lg tabular">{year}</span>
        </label>
        <span className={isRound ? "text-xs" : "text-xs text-muted-foreground italic"} data-testid="year-mode">
          {isRound ? (
            <T en="PSA round: official figures where published" ja="PSA調査年：公表値は公式統計" />
          ) : (
            <T en="Model estimates, not official" ja="モデル推計（非公式）" />
          )}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t("Previous year", "前の年")} disabled={year <= min} onClick={() => step(-1)}>
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <input
          id={id}
          type="range"
          className="range"
          min={min}
          max={max}
          step={1}
          value={year}
          list={`${id}-rounds`}
          aria-valuetext={isRound ? t(`${year}, PSA round`, `${year}年、PSA調査年`) : t(`${year}, model estimates`, `${year}年、モデル推計`)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <datalist id={`${id}-rounds`}>
          {rounds.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Button variant="ghost" size="icon" aria-label={t("Next year", "次の年")} disabled={year >= max} onClick={() => step(1)}>
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="flex justify-between px-10 font-mono text-[11px] text-muted-foreground" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
