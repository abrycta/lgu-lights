// /embed: the portfolio's live picture of Lights. One pre-projected pack (scripts/build-embed.mjs) drawn as SVG in
// Akari's colours: no MapLibre, no WebGL, no React. It tours the places chosen from the data (tour-select.ts), one
// every DWELL_MS, each change a cross-fade of the map (which settles from slightly closer) and its caption. Step 0
// is the still: the first view, and the only one under reduced motion. It pauses while the frame is out of sight,
// the tab is hidden, or the parent says so (parent-bridge.ts), and it is wholly inert: no link, nothing to focus.
// The map fits each province into whatever box the frame gives it, so any frame size draws a full map.
// Layouts: desktop (the portfolio's fixed 1280×800 frame, scaled to its slot: text is set in Akari's steps divided
// by that scale, so it reaches the reader at the step's size) = the map beside a caption panel; compact (≤ 1100 px:
// phones and tablets get the frame at the slot's real size) = the map over a two-line caption.
import "./style.css";

import { sparklineGeometry } from "@abrycta/akari/react/lib/akari-sparkline-geometry";

import { pct } from "@/lib/format";
import { classLabels, classOf, type Lang } from "@/lib/honesty";

import { PACK_URL } from "./pack.gen";
import { framed, listenToParent, onPauseChange, pausedByParent, postReady } from "./parent-bridge";

type Words = { source: string; tier: string; compare: string | null; headline: string | null };
interface Step {
  pcode: string;
  name: string;
  province: string;
  region: string;
  value: number | null;
  source: "official" | "model" | null;
  tier: 0 | 1 | 2 | null;
  /** [year, value, 0 official / 1 model, lo90, hi90] */
  series: [number, number, 0 | 1, number | null, number | null][];
  words: Record<Lang, Words>;
  /** The province's box, in the step's units. */
  view: [number, number, number, number];
  /** [path, value (-1: none), tier, source (0 official, 1 model)] */
  features: [string, number, number, number][];
  selected: number;
  provLines: string;
  provSelected: string;
}
interface Pack {
  version: string;
  year: number;
  breaks: number[];
  opacity: { official: number; model: number };
  steps: Step[];
}

/** Time on each place (as the live tour since #12), the cross-fade, and the map's settle. */
const DWELL_MS = 2200;
const FADE_MS = 400;
const SETTLE_MS = 800;
/** The province fit's padding (CSS px): desktop as the app's map; compact as before (lights-bugs #7: above the credit). */
const PAD_DESKTOP = 32;
const PAD_COMPACT = 12;
/** Akari's reliability hatching (maps/hatchImage): stripe spacing in CSS px, a 1 px ink line on a 2.4 px ground. */
const HATCH = { sparse: 12, dense: 6 } as const;
const CREDIT = "Boundaries: OCHA/NAMRIA/PSA (CC BY-IGO) · PSA SAE; Lights";
const SVG = "http://www.w3.org/2000/svg";

const lang: Lang = new URLSearchParams(location.search).get("lang") === "ja" ? "ja" : "en";
document.documentElement.lang = lang;
void (lang === "ja" ? import("./fonts-ja.css") : import("./fonts-en.css"));
// Framed, the portfolio sends its scale once the frame is ready; until then, its usual one.
if (framed()) document.documentElement.style.setProperty("--embed-scale", "0.48");
const compactQ = matchMedia("(max-width: 1100px)");
const motionQ = matchMedia("(prefers-reduced-motion: reduce)");
const t = (en: string, ja: string) => (lang === "ja" ? ja : en);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ---------------------------------------------------------------------------------------------- the map

type Box = { w: number; h: number };
type Pad = { x: number; top: number; bottom: number };

/** One step's map: fills merged by colour class and source, the hatching, edges, province lines, the selection. */
function drawMap(step: Step, pack: Pack, box: Box, pad: Pad, uid: number): SVGSVGElement {
  const [, , vw, vh] = step.view;
  const k = Math.min((box.w - 2 * pad.x) / vw, (box.h - pad.top - pad.bottom) / vh); // CSS px per unit
  const cx = vw / 2;
  const cy = vh / 2 + (pad.bottom - pad.top) / 2 / k;
  const [x, y, w, h] = [cx - box.w / 2 / k, cy - box.h / 2 / k, box.w / k, box.h / k];
  const svg = svgEl("svg", { viewBox: `${x} ${y} ${w} ${h}`, "aria-hidden": "true" }) as SVGSVGElement;
  svg.style.setProperty("--k", String(k));
  const defs = svgEl("defs");
  for (const [id, s] of Object.entries(HATCH)) {
    const p = svgEl("pattern", { id: `h-${id}-${uid}`, patternUnits: "userSpaceOnUse", width: s / k, height: s / k });
    const g = svgEl("g", { transform: `scale(${1 / k})` });
    const d = `M0 ${s}L${s} 0M-1 1L1 -1M${s - 1} ${s + 1}L${s + 1} ${s - 1}`;
    g.append(svgEl("path", { d, class: "hatch-ground" }), svgEl("path", { d, class: "hatch-ink" }));
    p.append(g);
    defs.append(p);
  }
  svg.append(defs);
  const fills = new Map<string, string>();
  const hatch = { sparse: "", dense: "" };
  let edges = "";
  for (const [d, v, tier, s] of step.features) {
    const cls = v < 0 ? "nd" : `c${classOf(v, pack.breaks)} ${s === 0 ? "off" : "mod"}`;
    fills.set(cls, (fills.get(cls) ?? "") + d);
    if (v >= 0 && tier >= 1) hatch[tier >= 2 ? "dense" : "sparse"] += d;
    edges += d;
  }
  for (const [cls, d] of fills) svg.append(svgEl("path", { d, class: cls }));
  for (const [id, d] of Object.entries(hatch)) if (d) svg.append(svgEl("path", { d, fill: `url(#h-${id}-${uid})` }));
  svg.append(svgEl("path", { d: edges, class: "edges" }));
  svg.append(svgEl("path", { d: step.provLines, class: "prov" }));
  svg.append(svgEl("path", { d: step.provSelected, class: "prov-sel" }));
  svg.append(svgEl("path", { d: step.features[step.selected]![0], class: "lgu-sel" }));
  return svg;
}

// ---------------------------------------------------------------------------------------------- the caption

/** The place's series (Akari's sparkline geometry): the shown line, its 90 % band, official figures as dots. */
function sparkline(step: Step, year: number): HTMLElement {
  const pts = step.series;
  const g = sparklineGeometry(
    pts.map((p) => p[1]),
    {
      width: 200,
      height: 48,
      pad: 4,
      zero: true,
      bands: [{ lo: pts.map((p) => p[3]), hi: pts.map((p) => p[4]) }],
      observations: pts.flatMap((p, index) => (p[2] === 0 ? [{ index, value: p[1] }] : [])),
    },
  );
  const svg = svgEl("svg", { class: "spark", viewBox: `0 0 ${g.width} ${g.height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  for (const d of g.bands) svg.append(svgEl("path", { d, class: "band" }));
  svg.append(svgEl("path", { d: g.line, class: "line" }));
  for (const o of g.observations) svg.append(svgEl("circle", { cx: o.x, cy: o.y, r: 2.5, class: "dot" }));
  const now = pts.findIndex((p) => p[0] === year);
  const at = now >= 0 ? g.points[now] : null;
  if (at) svg.append(svgEl("circle", { cx: at[0], cy: at[1], r: 4.5, class: "now" }));
  const wrap = el("div", "spark-wrap");
  const years = el("div", "spark-years");
  years.append(el("span", "", String(pts[0]![0])), el("span", "", String(pts[pts.length - 1]![0])));
  wrap.append(svg, years);
  return wrap;
}

function swatch(step: Step, breaks: number[]): SVGElement {
  const s = svgEl("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" });
  s.append(svgEl("rect", { width: 10, height: 10, class: step.value == null ? "nd" : `c${classOf(step.value, breaks)} ${step.source === "official" ? "off" : "mod"}` }));
  if (step.tier && step.tier >= 1) {
    const d = step.tier >= 2 ? "M0 5L5 0M0 10L10 0M5 10L10 5" : "M0 10L10 0";
    s.append(svgEl("path", { d, class: "hatch-ground" }), svgEl("path", { d, class: "hatch-ink" }));
  }
  return s;
}

function drawCard(step: Step, pack: Pack, progress: HTMLElement): HTMLElement {
  const w = step.words[lang];
  const card = el("div", "card");
  const model = step.source === "model";
  // Compact: two lines, as the app's caption.
  const one = el("p", "c-line one");
  one.append(el("b", "", step.name), el("span", "muted", ` · ${step.province}`));
  const two = el("p", "c-line two");
  if (step.value != null) {
    if (lang === "ja") two.append("貧困線未満 ");
    two.append(el("span", `mono${model ? " model" : ""}`, pct(step.value, lang)), lang === "ja" ? `・${w.source}` : ` below the poverty line · ${w.source}`);
  } else two.textContent = t(`No estimate for ${pack.year}.`, `${pack.year}年の推計はありません。`);
  // Desktop: the caption panel.
  const name = el("h2", "name", step.name);
  const where = el("div", "where", `${step.province} · ${step.region}`);
  const figure = el("div", "figure");
  if (step.value != null)
    figure.append(el("span", `value${model ? " model" : ""}`, pct(step.value, lang)), el("span", "below", t("below the poverty line", "貧困線未満")));
  const chips = el("div", "chips");
  const source = el("span", "chip");
  source.append(swatch(step, pack.breaks), w.source);
  chips.append(source);
  if (w.tier) chips.append(el("span", "chip", w.tier));
  const sentence = el("p", "sentence", w.compare ?? w.headline ?? "");
  const legend = el("div", "legend");
  const ramp = el("div", "ramp");
  const labels = el("div", "ramp-labels");
  // The app's class labels (lib/honesty.ts) without the unit, which the note below gives once.
  classLabels(pack.breaks).forEach((label, i) => {
    ramp.append(el("span", `r${i}`));
    labels.append(el("span", "", label.replace(/\s*%$/, "").replace(/([<≥])\s+/, "$1")));
  });
  legend.append(
    ramp,
    labels,
    el("div", "", t("% below the poverty line · lighter: model estimate · hatched: less certain", "貧困線未満の割合（%）・淡い色：モデル推計・斜線：不確か")),
  );
  card.append(one, two, name, where, figure, chips, sparkline(step, pack.year), sentence, legend, progress);
  return card;
}

// ---------------------------------------------------------------------------------------------- the tour

const sizeOf = (e: Element) => {
  const r = e.getBoundingClientRect();
  return `${Math.round(r.width)}×${Math.round(r.height)}`;
};

async function start() {
  const app = document.getElementById("app")!;
  const res = await fetch(PACK_URL);
  if (!res.ok) throw new Error(`${res.status}: ${PACK_URL}`);
  const pack = (await res.json()) as Pack;
  app.style.setProperty("--official", String(pack.opacity.official));
  app.style.setProperty("--model", String(pack.opacity.model));
  const map = el("div", "map");
  const credit = el("div", "credit", CREDIT);
  const panel = el("div", "panel");
  map.append(credit);
  app.append(map, panel);

  let step = 0; // step 0 is the still (tour-select.ts)
  let current: { svg: SVGSVGElement; card: HTMLElement } | null = null;
  let clock: Animation | null = null;
  let uid = 0;
  let inView = true;
  const running = () => inView && document.visibilityState === "visible" && !pausedByParent() && !motionQ.matches;

  const sync = () => {
    document.documentElement.toggleAttribute("data-embed-paused", !running());
    if (!clock) return;
    if (running()) {
      if (clock.playState === "paused") clock.play();
    } else if (clock.playState === "running") clock.pause();
  };

  /** Draws step i; `animate`: cross-fade from the current one. The dwell clock is the progress bar's own animation. */
  const render = (i: number, animate: boolean, elapsed = 0) => {
    const compact = compactQ.matches;
    const { width, height } = map.getBoundingClientRect();
    const pad = compact ? { x: PAD_COMPACT, top: PAD_COMPACT, bottom: PAD_COMPACT + credit.offsetHeight } : { x: PAD_DESKTOP, top: PAD_DESKTOP, bottom: PAD_DESKTOP };
    const s = pack.steps[i]!;
    const svg = drawMap(s, pack, { w: width, h: height }, pad, uid++);
    const bar = el("div", "progress");
    bar.append(el("i"));
    const card = drawCard(s, pack, bar);
    map.insertBefore(svg, credit);
    panel.append(card);
    step = i;
    document.documentElement.dataset.tourStep = String(i);
    const prev = current;
    current = { svg, card };
    if (animate && prev) {
      const ease = "cubic-bezier(0.4, 0, 0.2, 1)";
      svg.animate([{ transform: "scale(1.035)" }, { transform: "scale(1)" }], { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      for (const n of [svg, card]) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: ease });
      const out = [prev.svg, prev.card].map((n) => n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: ease, fill: "forwards" }));
      void Promise.all(out.map((a) => a.finished))
        .catch(() => undefined)
        .then(() => (prev.svg.remove(), prev.card.remove()));
    } else if (prev) {
      prev.svg.remove();
      prev.card.remove();
    }
    clock?.cancel();
    clock = null;
    if (motionQ.matches || pack.steps.length < 2) return;
    clock = bar.firstElementChild!.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DWELL_MS, easing: "linear", fill: "forwards" });
    clock.currentTime = elapsed;
    const mine = clock;
    mine.finished.then(() => mine === clock && render((i + 1) % pack.steps.length, true)).catch(() => undefined);
    sync();
  };

  render(step, false);
  listenToParent();
  // Ready once the first place is painted (fonts may still swap: the layout does not depend on them).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.documentElement.dataset.embedReady = "";
      postReady();
    }),
  );

  new IntersectionObserver(([e]) => {
    inView = !!e?.isIntersecting;
    sync();
  }).observe(app);
  document.addEventListener("visibilitychange", sync);
  onPauseChange(sync);
  // Reduced motion: back to the still, statically.
  motionQ.addEventListener("change", () => render(motionQ.matches ? 0 : step, false));
  // A resize or a layout switch redraws the current place at once, keeping the clock.
  let raf = 0;
  let last = sizeOf(map);
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const size = sizeOf(map);
      if (size === last) return;
      last = size;
      render(step, false, Number(clock?.currentTime ?? 0));
    });
  }).observe(map);
}

void start();
