// Plain definitions for the words the map uses. A Popover (not a hover-only tooltip) so it works with
// a keyboard (Enter/Space on the term), on touch (tap) and with a mouse (it also opens on hover).

import { Popover, PopoverContent, PopoverTrigger, useLang } from "@abrycta/akari/react";
import { type ReactNode, use, useRef, useState } from "react";

import { loadManifest } from "@/data/load";
import { yearList } from "@/lib/rounds";

export type TermKey = "incidence" | "psa" | "sae" | "model" | "interval";

/**
 * The poverty threshold is PSA's 2023 full-year figure: PhP 13,873 a month for a family of five,
 * nationally (https://psa.gov.ph/statistics/poverty/node/1684064929). Provincial thresholds differ.
 */
const definitions = (rounds: readonly number[]): Record<TermKey, { term: { en: string; ja: string }; en: string; ja: string }> => ({
  incidence: {
    term: { en: "Poverty incidence", ja: "貧困率" },
    en: "The share of people whose family income is below PSA's official poverty threshold: the money a family needs for basic food and non-food needs. In 2023 that was ₱13,873 a month for a family of five, nationally (it varies by province).",
    ja: "家族の所得がPSAの公式貧困線（食料と基本的な生活費に必要な額）を下回る人の割合です。2023年の全国の貧困線は5人家族で月13,873ペソでした（州によって異なります）。",
  },
  psa: {
    term: { en: "PSA", ja: "PSA" },
    en: "The Philippine Statistics Authority, the government's statistics office. It publishes the official poverty figures.",
    ja: "フィリピン統計庁。政府の統計機関で、公式の貧困統計を公表しています。",
  },
  sae: {
    term: { en: "Small-area estimate", ja: "小地域推計" },
    en: `PSA's official poverty figure for each city and municipality. A household survey is too small to measure every town directly, so PSA combines it with the census. Published for ${yearList(rounds, "en", true)}.`,
    ja: `PSAが市町村ごとに出す公式の貧困率です。家計調査だけでは市町村ごとに測るには標本が小さいため、国勢調査と組み合わせて推計します。${yearList(rounds, "ja")}年に公表。`,
  },
  model: {
    term: { en: "Model estimate", ja: "モデル推計" },
    en: "Lights' own estimate for a year without a PSA figure. It starts from the last PSA figure and adds a trend learned from past rounds and satellite data. Not an official statistic.",
    ja: "PSAの値がない年についてのLights独自の推計です。直近のPSAの値を出発点に、過去の調査と衛星データから学んだ傾向を加えます。公式統計ではありません。",
  },
  interval: {
    term: { en: "Interval", ja: "区間" },
    en: "The range the true figure probably lies in. For PSA figures it is the 90 % confidence interval, for model estimates the 90 % prediction interval: about 9 times in 10 the true figure is inside it.",
    ja: "実際の値がおそらく入る範囲です。PSAの値では90%信頼区間、モデル推計では90%予測区間で、10回に9回ほどは実際の値がこの中に入ります。",
  },
});

export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const d = definitions(use(loadManifest()).rounds)[k];
  const hover = (o: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (o) setOpen(true);
    else closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="cursor-help underline decoration-dotted decoration-1 underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
      >
        {children ?? d.term[lang]}
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs leading-relaxed" onPointerEnter={hover(true)} onPointerLeave={hover(false)} onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="mb-1 font-medium">{d.term[lang]}</p>
        <p>{d[lang]}</p>
      </PopoverContent>
    </Popover>
  );
}

/** One row of all the definitions, for the panel. */
export function Glossary() {
  const { lang } = useLang();
  const keys: TermKey[] = ["incidence", "psa", "sae", "model", "interval"];
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="glossary">
      <span>{lang === "ja" ? "用語：" : "What the words mean:"}</span>
      {keys.map((k) => (
        <Term key={k} k={k} />
      ))}
    </p>
  );
}
