// What-if (DECISIONS Q11, S5): two sliders feed the WASM model in a Web Worker. The output is always
// labelled "Hypothetical scenario", drawn in its own dashed style, carries the widened interval and
// is never drawn on the main map.

import { Badge, Button, T, useLang, useT } from "@abrycta/akari/react";
import { useEffect, useId, useState } from "react";

import type { YearRecord } from "@/data/types";
import { interval, pct } from "@/lib/format";
import { TIER_LABEL } from "@/lib/honesty";
import { runWhatIf } from "@/whatif/client";
import type { WasmEstimate } from "@/whatif/wasm";

const GROWTH = { min: -20, max: 30, step: 1 };
const NDVI = { min: -0.1, max: 0.1, step: 0.01 };

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
  const [result, setResult] = useState<{ key: string; est: WasmEstimate | null } | { key: string; error: string } | null>(null);
  const year = rec.year;
  const model = rec.model!;
  const key = `${pcode}|${year}|${growth}|${ndvi}`;

  // Debounced so dragging a slider sends one request per pause, not one per pixel.
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      runWhatIf(pcode, year, growth, ndvi).then(
        (est) => live && setResult({ key, est }),
        (e: unknown) => live && setResult({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [pcode, year, growth, ndvi, key]);

  const est = result && "est" in result ? result.est : null;
  const stale = result?.key !== key;
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
        <input id={gid} type="range" className="range" {...GROWTH} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} aria-valuetext={t(`${signed(growth, 0)} percent per year`, `年${signed(growth, 0)}%`)} />
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
          onChange={(e) => setNdvi(Math.round(Number(e.target.value) * 100) / 100)}
          aria-valuetext={signed(ndvi, 2)}
        />
      </div>
      <div aria-live="polite" className="min-h-12 text-sm" data-testid="whatif-result" aria-busy={stale}>
        {result && "error" in result ? (
          <p className="text-destructive">
            <T en="The what-if model could not run: " ja="仮定モデルを実行できません：" />
            <span className="font-mono text-xs">{result.error}</span>
          </p>
        ) : est ? (
          <p className={stale ? "opacity-60" : ""}>
            <T
              en={`Hypothetical: ${zero ? "with no change" : `with night lights ${signed(growth, 0)} %/yr and NDVI ${signed(ndvi, 2)}`}, the model would put poverty in ${name} in ${year} at `}
              ja={`仮定：${zero ? "変化なしの場合" : `夜間光 年${signed(growth, 0)}%、NDVI ${signed(ndvi, 2)}の場合`}、${year}年の${name}の貧困率は `}
            />
            <strong className="font-mono">{pct(est.value, lang)}</strong>
            <T en=" (widened 90 % interval " ja="（拡張90%区間 " />
            <span className="font-mono">{interval(est.lo90, est.hi90, lang).text}</span>
            <T en={`; ${TIER_LABEL[est.tier][lang]}). ` } ja={`、${TIER_LABEL[est.tier][lang]}）。`} />
            {!zero ? (
              <T
                en={`That is ${signed(est.value - model.estimate, 1)} points from the model estimate (${pct(model.estimate, lang)}).`}
                ja={`モデル推計（${pct(model.estimate, lang)}）との差は${signed(est.value - model.estimate, 1)}ポイント。`}
              />
            ) : null}
          </p>
        ) : result ? (
          <p className="text-muted-foreground">
            <T en="No scenario estimate for this place and year." ja="この地域と年の仮定推計はありません。" />
          </p>
        ) : (
          <p className="text-muted-foreground">…</p>
        )}
        {import.meta.env.DEV && zero && est ? (
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
