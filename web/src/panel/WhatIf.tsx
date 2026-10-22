// What-if (DECISIONS Q11, S5): two sliders feed the WASM model in a Web Worker. The output is always
// labelled "Hypothetical scenario", drawn in its own dashed style, carries the widened interval and
// is never drawn on the main map. The model (WASM + snapshot + forest, about 1 MB on the wire) loads on
// the first slider interaction; until then the zero scenario is the published estimate, widened.

import { Badge, Button, T, useLang, useT } from "@abrycta/akari/react";
import { useEffect, useId, useState } from "react";

import type { YearRecord } from "@/data/types";
import { interval, pct } from "@/lib/format";
import { TIER_LABEL, tierOf } from "@/lib/honesty";
import { whatIfExplanation } from "@/lib/plain";
import { runWhatIf, whatIfLoaded } from "@/whatif/client";
import type { WasmEstimate } from "@/whatif/wasm";

const GROWTH = { min: -20, max: 30, step: 1 };
const NDVI = { min: -0.1, max: 0.1, step: 0.01 };

/** The zero scenario without the model: the published estimate with its intervals widened by `widen`
 * (the same arithmetic as lgu-core's estimate_from_row, which clamps to 0–100 after widening). */
function publishedZero(m: NonNullable<YearRecord["model"]>, widen: number): WasmEstimate {
  const v = m.estimate;
  const h50 = Math.max(m.hi50 - v, v - m.lo50) * widen;
  const h90 = Math.max(m.hi90 - v, v - m.lo90) * widen;
  const cv = m.cv * widen;
  return {
    value: v,
    lo50: Math.max(0, v - h50),
    hi50: Math.min(100, v + h50),
    lo90: Math.max(0, v - h90),
    hi90: Math.min(100, v + h90),
    cv,
    tier: tierOf(cv),
    prevYear: m.from,
  };
}

type Run = { key: string; growth: number; ndvi: number } & ({ est: WasmEstimate | null } | { error: string });

function signed(v: number, digits: number) {
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;
}

export function WhatIf({ pcode, name, rec, widen }: { pcode: string; name: string; rec: YearRecord; widen: number }) {
  const t = useT();
  const { lang } = useLang();
  const gid = useId();
  const nid = useId();
  const [growth, setGrowth] = useState(0);
  const [ndvi, setNdvi] = useState(0);
  // Nothing is downloaded until the reader touches a slider (pointer, key or change).
  const [armed, setArmed] = useState(false);
  const arm = () => setArmed(true);
  const [result, setResult] = useState<Run | null>(null);
  const year = rec.year;
  const model = rec.model!;
  const key = `${pcode}|${year}|${growth}|${ndvi}`;

  // Debounced so dragging a slider sends one request per pause, not one per pixel.
  useEffect(() => {
    if (!armed) return;
    let live = true;
    const h = setTimeout(() => {
      runWhatIf(pcode, year, growth, ndvi).then(
        (est) => live && setResult({ key, growth, ndvi, est }),
        (e: unknown) => live && setResult({ key, growth, ndvi, error: e instanceof Error ? e.message : String(e) }),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [armed, pcode, year, growth, ndvi, key]);

  // What the result line shows: the last model run, or (before the model has answered) the published
  // estimate as the zero scenario. The text describes the inputs of what is shown, not the live sliders.
  const run = armed ? result : null;
  const est = run ? ("est" in run ? run.est : null) : publishedZero(model, widen);
  const stale = armed && result?.key !== key;
  const loading = stale && !whatIfLoaded();
  const shownGrowth = run?.growth ?? 0;
  const shownNdvi = run?.ndvi ?? 0;
  const shownZero = shownGrowth === 0 && shownNdvi === 0;
  const zero = growth === 0 && ndvi === 0;

  return (
    <section className="hypothetical grid gap-3 rounded-sm p-3" aria-labelledby={`${gid}-h`} data-testid="whatif">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${gid}-h`} className="text-sm font-medium">
          <T en={`What if… (${year})`} ja={`もしも…（${year}年）`} />
        </h3>
        <Badge variant="outline" className="border-dashed border-seal text-seal-text">
          <T en="Hypothetical scenario" ja="仮定のシナリオ" />
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        <T
          en={`Change the satellite inputs for ${year} and see what the model would say. Not a forecast and not an official figure; the interval is widened ×${widen}.`}
          ja={`${year}年の衛星データを変えると、モデルがどう推計するかを示します。予測でも公式統計でもありません。区間は×${widen}に広げています。`}
        />
      </p>
      <div className="grid gap-1">
        <label htmlFor={gid} className="flex justify-between text-xs">
          <span>
            <T en="Extra night-light growth since the last round" ja="前回調査以降の夜間光の追加成長" />
          </span>
          <output htmlFor={gid} className="font-mono tabular">
            {signed(growth, 0)} %/{t("yr", "年")}
          </output>
        </label>
        <input id={gid} type="range" className="range" {...GROWTH} value={growth} onPointerDown={arm} onKeyDown={arm} onChange={(e) => (arm(), setGrowth(Number(e.target.value)))} aria-valuetext={t(`${signed(growth, 0)} percent per year`, `年${signed(growth, 0)}%`)} />
      </div>
      <div className="grid gap-1">
        <label htmlFor={nid} className="flex justify-between text-xs">
          <span>
            <T en={`Vegetation (NDVI) change in ${year}`} ja={`${year}年の植生指数（NDVI）の変化`} />
          </span>
          <output htmlFor={nid} className="font-mono tabular">
            {signed(ndvi, 2)}
          </output>
        </label>
        <input
          id={nid}
          type="range"
          className="range"
          {...NDVI}
          value={ndvi}
          onPointerDown={arm}
          onKeyDown={arm}
          onChange={(e) => (arm(), setNdvi(Math.round(Number(e.target.value) * 100) / 100))}
          aria-valuetext={signed(ndvi, 2)}
        />
      </div>
      <div
        aria-live="polite"
        className="relative min-h-12 text-sm"
        data-testid="whatif-result"
        data-state={loading ? "loading" : run ? "scenario" : "published"}
        aria-busy={stale}
      >
        {run && "error" in run ? (
          <p className="text-destructive">
            <T en="The what-if model could not run: " ja="仮定モデルを実行できません：" />
            <span className="font-mono text-xs">{run.error}</span>
          </p>
        ) : est ? (
          <p className={stale ? "opacity-60" : ""}>
            <T
              en={`Hypothetical: ${shownZero ? "with no change" : `with night lights ${signed(shownGrowth, 0)} %/yr and NDVI ${signed(shownNdvi, 2)}`}, the model would put poverty in ${name} in ${year} at `}
              ja={`仮定：${shownZero ? "変化なしの場合" : `夜間光 年${signed(shownGrowth, 0)}%、NDVI ${signed(shownNdvi, 2)}の場合`}、${year}年の${name}の貧困率は `}
            />
            <strong className="font-mono">{pct(est.value, lang)}</strong>
            <T en=" (widened 90 % interval " ja="（拡張90%区間 " />
            <span className="font-mono">{interval(est.lo90, est.hi90, lang).text}</span>
            <T en={`; ${TIER_LABEL[est.tier][lang]}).`} ja={`、${TIER_LABEL[est.tier][lang]}）。`} />
            {!shownZero ? <>{lang === "ja" ? "" : " "}{whatIfExplanation(model.estimate, est.value, shownGrowth, shownNdvi, lang)}</> : null}
          </p>
        ) : run ? (
          <p className="text-muted-foreground">
            <T en="No scenario estimate for this place and year." ja="この地域と年の仮定推計はありません。" />
          </p>
        ) : (
          <p className="text-muted-foreground">…</p>
        )}
        {loading ? (
          // Overlaid on the dimmed published figure, so the panel keeps its height while the model loads.
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid="whatif-loading">
            <span className="rounded-sm border bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm">
              <T en="Loading the scenario model…" ja="シナリオモデルを読み込み中…" />
            </span>
          </span>
        ) : null}
        {import.meta.env.DEV && run && shownZero && est ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground" data-testid="whatif-zero-check">
            dev check: zero scenario {est.value.toFixed(2)} vs materialised model {model.estimate.toFixed(2)} → {Math.abs(est.value - model.estimate) < 0.01 ? "match" : "MISMATCH"}
          </p>
        ) : null}
      </div>
      {!zero ? (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            setGrowth(0);
            setNdvi(0);
          }}
        >
          <T en="Reset scenario" ja="シナリオをリセット" />
        </Button>
      ) : null}
    </section>
  );
}
