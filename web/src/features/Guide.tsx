// #5 "How to read this map": a dismissible three-step guide shown on the first visit (colour,
// hatching, official vs model). Dismissal is remembered per visitor (app/prefs.ts); the legend has a
// button to open it again.

import { Button, Card, CardContent, CardHeader, CardTitle, LegendSwatch, T, useT } from "@abrycta/akari/react";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { useGuide } from "@/app/prefs";
import { MODEL_OPACITY, OFFICIAL_OPACITY, PLAIN_BINS } from "@/lib/honesty";

import { Term } from "./Term";

export function Guide() {
  const t = useT();
  const [open, setOpen] = useGuide();
  const [step, setStep] = useState(0);
  // Start at the first step each time the guide opens (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStep(0);
  }
  if (!open) return null;

  const steps = [
    <div key="c" className="grid gap-2">
      <p>
        <T en="Colour shows " ja="色は" />
        <Term k="incidence" />
        <T en=": the darker the area, the more people below the poverty line." ja="を表します。色が濃いほど、貧困線を下回る人が多い地域です。" />
      </p>
      <div className="flex gap-1" aria-hidden="true">
        {["bg-chart-seq-1", "bg-chart-seq-2", "bg-chart-seq-3", "bg-chart-seq-4", "bg-chart-seq-5"].map((c) => (
          <span key={c} className={`h-3 flex-1 rounded-xs ${c}`} />
        ))}
      </div>
      <p className="text-muted-foreground">{PLAIN_BINS.map((b) => `${t(b.name.en, b.name.ja)} (${t(b.range.en, b.range.ja)})`).join(" · ")}</p>
    </div>,
    <div key="h" className="grid gap-2">
      <p>
        <T
          en="Stripes mean the figure is uncertain. Light stripes: “Use with care”. Dense stripes: “Rough guess”. No stripes: “Solid”."
          ja="斜線は値が不確かなことを示します。まばらな斜線は「注意して使う値」、密な斜線は「おおよその目安」、斜線なしは「確かな値」です。"
        />
      </p>
      <div className="flex gap-2" aria-hidden="true">
        <LegendSwatch fill="seq-3" />
        <LegendSwatch fill="seq-3" hatch="sparse" />
        <LegendSwatch fill="seq-3" hatch="dense" />
      </div>
    </div>,
    <div key="o" className="grid gap-2">
      <p>
        <T en="Strong colours are official " ja="濃い色は" />
        <Term k="psa" />
        <T en=" figures (" ja="の公式値（" />
        <Term k="sae">{t("small-area estimates", "小地域推計")}</Term>
        <T en=", 2012, 2015, 2018, 2021, 2023). Lighter colours are Lights " ja="、2012・2015・2018・2021・2023年）です。淡い色はLightsの" />
        <Term k="model">{t("model estimates", "モデル推計")}</Term>
        <T en=" for the other years: not official, and always shown with an " ja="で、公式統計ではなく、必ず" />
        <Term k="interval">{t("interval", "区間")}</Term>
        <T en="." ja="を添えています。" />
      </p>
      <div className="flex gap-2" aria-hidden="true">
        <LegendSwatch fill="seq-4" opacity={OFFICIAL_OPACITY} />
        <LegendSwatch fill="seq-4" opacity={MODEL_OPACITY} />
      </div>
    </div>,
  ];
  const last = step === steps.length - 1;

  return (
    <Card size="sm" className="w-80 max-w-[calc(100vw-2rem)] text-sm shadow-md" role="dialog" aria-labelledby="guide-title" data-testid="guide">
      <CardHeader className="flex items-start justify-between gap-2">
        <CardTitle id="guide-title" className="font-display">
          <T en="How to read this map" ja="地図の読み方" /> <span className="font-mono text-xs text-muted-foreground">{step + 1}/3</span>
        </CardTitle>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7" aria-label={t("Close the guide", "ガイドを閉じる")} onClick={() => setOpen(false)}>
          <XIcon aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div aria-live="polite">{steps[step]}</div>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <T en="Back" ja="戻る" />
          </Button>
          <Button size="sm" onClick={() => (last ? setOpen(false) : setStep((s) => s + 1))}>
            {last ? <T en="Got it" ja="わかりました" /> : <T en="Next" ja="次へ" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
