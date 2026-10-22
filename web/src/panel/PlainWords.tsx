// "In plain words": the everyday headline (#1), why a figure is a model estimate (#9), the national
// and province comparison (#2), whether it really changed (#3) and "Copy a plain summary" (#11).
// The sentences come from lib/plain.ts; this file only lays them out and loads what they compare with.

import { Button, T, useLang, useT } from "@abrycta/akari/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Suspense, use, useState } from "react";

import { formatUrl } from "@/app/url";
import { loadNational, loadProvinceLgus } from "@/data/load";
import type { Index, LguDetail, YearRecord } from "@/data/types";
import { changeSentence, comparisonSentence, headline, plainSummary, provinceAverage, shownFigure, valuesOf, whyModelSentence } from "@/lib/plain";

function Comparison({ lgu, rec, year, index }: { lgu: LguDetail; rec: YearRecord; year: number; index: Index }) {
  const { lang } = useLang();
  const national = use(loadNational());
  const provLgus = use(loadProvinceLgus(index, lgu.province.pcode));
  const f = shownFigure(rec);
  if (!f) return null;
  // Same source only: official figures against official figures, model estimates against model estimates.
  const others = national ? [...valuesOf(national, year, f.source)].filter(([p]) => p !== lgu.pcode).map(([, v]) => v) : [];
  const avg = provinceAverage(provLgus, year, f.source);
  const s = comparisonSentence(
    { value: f.est, lo: f.lo, hi: f.hi, source: f.source, year, others, province: avg ? { name: lgu.province.name, mean: avg.mean, n: avg.n } : null },
    lang,
  );
  return s ? <p data-testid="plain-compare">{s}</p> : null;
}

/** Copies the plain summary; falls back to a hidden textarea, and shows the text to copy by hand if both fail. */
function CopySummary({ text }: { text: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      let ok: boolean;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      setState(ok ? "copied" : "manual");
    }
  };
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy} data-testid="copy-summary">
          {state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          <T en="Copy a plain summary" ja="わかりやすい要約をコピー" />
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {state === "copied" ? t("Copied.", "コピーしました。") : ""}
        </span>
      </div>
      {state === "manual" ? (
        <textarea readOnly className="min-h-20 w-full rounded-sm border border-border bg-background p-2 text-xs" value={text} aria-label={t("Summary to copy", "コピーする要約")} onFocus={(e) => e.currentTarget.select()} />
      ) : null}
    </div>
  );
}

export function PlainWords({ lgu, rec, year, index }: { lgu: LguDetail; rec: YearRecord | undefined; year: number; index: Index }) {
  const { lang } = useLang();
  const head = headline(rec, year, lgu.name, lang);
  if (!head || !rec) return null;
  const why = whyModelSentence(lgu.years, rec, lang);
  const change = changeSentence(lgu.years, rec, lang);
  const url = `${location.origin}${formatUrl({ page: "map", year, prov: lgu.province.pcode, lgu: lgu.pcode, lang })}`;
  const summary = plainSummary({ place: lgu.name, province: lgu.province.name, rec, year, url, pcode: lgu.pcode }, lang);
  return (
    <section className="grid gap-2 rounded-sm border border-border bg-muted/40 p-3 text-sm leading-relaxed" aria-labelledby="plain-h" data-testid="plain-words">
      <h3 id="plain-h" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <T en="In plain words" ja="かんたんに言うと" />
      </h3>
      <p className="font-medium" data-testid="plain-headline">
        {head}
      </p>
      {why ? (
        <p className="text-muted-foreground" data-testid="plain-why">
          {why}
        </p>
      ) : null}
      <Suspense fallback={null}>
        <Comparison lgu={lgu} rec={rec} year={year} index={index} />
      </Suspense>
      {change ? <p data-testid="plain-change">{change}</p> : null}
      {summary ? <CopySummary key={summary} text={summary} /> : null}
    </section>
  );
}
