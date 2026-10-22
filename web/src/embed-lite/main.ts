// SPIKE (lt-embed-spike): /embed-lite, the portfolio's live picture of Lights drawn as SVG from one pre-projected
// pack (scripts/build-embed-lite.mjs). No MapLibre, no WebGL, no React: the tour's six places are known at build
// time, so each is a handful of merged <path>s in Akari's colours, cross-faded (compositor-only opacity and
// transform) with a caption that holds DWELL_MS. Same parent protocol as src/embed/parent-bridge.ts; reduced
// motion shows one still, the densest step. Layout: desktop = the 1280×800 frame (map + caption panel); compact
// (≤ 1100 px: phones and tablets at the slot's real size) = map over a two-line caption.
import "./style.css";

import { PACK_URL } from "./pack.gen";

type Lang = "en" | "ja";
interface Words { source: string; tier: string; headline: string | null; compare: string | null; change: string | null; why: string | null }
interface Step {
  pcode: string;
  name: string;
  province: string;
  region: string;
  value: number | null;
  source: "official" | "model" | null;
  tier: 0 | 1 | 2 | null;
  series: [number, number, 0 | 1, number | null, number | null][];
  words: Record<Lang, Words>;
  view: [number, number, number, number];
  features: [string, number, number, number][];
  selected: number;
  provLines: string;
  provSelected: string;
}
interface Pack { version: string; year: number; breaks: number[]; still: number; steps: Step[] }

/** How long each place holds (rule 27: long enough to read), and the cross-fade and settle around a change. */
const DWELL_MS = 6500;
const FADE_MS = 700;
const SETTLE_MS = 1400;
const PARENT_ORIGIN = "https://krtmtthw.dev";
const COOKIE_DOMAIN = "krtmtthw.dev";
const SVG = "http://www.w3.org/2000/svg";

const params = new URLSearchParams(location.search);
const lang: Lang = params.get("lang") === "ja" ? "ja" : "en";
document.documentElement.lang = lang;
const framed = window.parent !== window;
let paused = framed && params.get("paused") === "1";
const compactQ = matchMedia("(max-width: 1100px)");
const motionQ = matchMedia("(prefers-reduced-motion: reduce)");

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svgEl = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const pct = (v: number) => (lang === "ja" ? `${v.toFixed(1)}%` : `${v.toFixed(1)}\u00a0%`);
const classOf = (v: number, breaks: number[]) => breaks.reduce((c, b) => (v >= b ? c + 1 : c), 0);

// ---------------------------------------------------------------------------------------------- the map

/** One step's map: fills merged by colour class and source, the hatching, edges, province lines, selection. */
function drawMap(step: Step, breaks: number[], box: { w: number; h: number }, pad: { x: number; top: number; bottom: number }, uid: string): SVGSVGElement {
  const [, , vw, vh] = step.view;
  const k = Math.min((box.w - 2 * pad.x) / vw, (box.h - pad.top - pad.bottom) / vh); // CSS px per unit
  const cx = vw / 2;
  const cy = vh / 2 + (pad.bottom - pad.top) / 2 / k;
  const svg = svgEl("svg", { viewBox: `${cx - box.w / 2 / k} ${cy - box.h / 2 / k} ${box.w / k} ${box.h / k}`, "aria-hidden": "true", preserveAspectRatio: "xMidYMid meet" }) as SVGSVGElement;
  // Akari's reliability hatching (maps/hatchImage): a 1 px ink line on a 2.4 px ground halo, 12 px (sparse) or 6 px (dense) apart.
  const defs = svgEl("defs");
  for (const [id, s] of [["sparse", 12], ["dense", 6]] as const) {
    const p = svgEl("pattern", { id: `h-${id}-${uid}`, patternUnits: "userSpaceOnUse", width: s / k, height: s / k });
    const g = svgEl("g", { transform: `scale(${1 / k})` });
    const d = `M0 ${s}L${s} 0M-1 1L1 -1M${s - 1} ${s + 1}L${s + 1} ${s - 1}`;
    g.append(svgEl("path", { d, class: "hatch-ground", "stroke-width": 2.4 }), svgEl("path", { d, class: "hatch-ink", "stroke-width": 1 }));
    p.append(g);
    defs.append(p);
  }
  svg.append(defs);
  svg.append(svgEl("rect", { x: cx - box.w / 2 / k, y: cy - box.h / 2 / k, width: box.w / k, height: box.h / k, fill: "var(--ak-bg)" }));
  const fills = new Map<string, string>();
  const hatch = { sparse: "", dense: "" };
  let edges = "";
  for (const [d, v, t, s] of step.features) {
    const key = v < 0 ? "nd" : `c${classOf(v, breaks)} ${s === 0 ? "off" : "mod"}`;
    fills.set(key, (fills.get(key) ?? "") + d);
    if (v >= 0 && t >= 1) hatch[t >= 2 ? "dense" : "sparse"] += d;
    edges += d;
  }
  for (const [cls, d] of fills) svg.append(svgEl("path", { d, class: cls }));
  for (const [id, d] of Object.entries(hatch)) if (d) svg.append(svgEl("path", { d, fill: `url(#h-${id}-${uid})` }));
  svg.append(svgEl("path", { d: edges, class: "edges" }));
  svg.append(svgEl("path", { d: step.provLines, class: "prov" }));
  svg.append(svgEl("path", { d: step.provSelected, class: "prov-sel" }));
  if (step.selected >= 0) svg.append(svgEl("path", { d: step.features[step.selected]![0], class: "lgu-sel" }));
  return svg;
}

// ---------------------------------------------------------------------------------------------- the caption

function sparkline(step: Step, year: number): HTMLElement {
  const W = 200;
  const H = 50;
  const pts = step.series;
  const y0 = pts[0]![0];
  const y1 = pts[pts.length - 1]![0];
  const top = Math.max(10, ...pts.map((p) => p[4] ?? p[1])) * 1.05;
  const X = (y: number) => ((y - y0) / Math.max(1, y1 - y0)) * W;
  const Y = (v: number) => H - (Math.min(v, top) / top) * H;
  const svg = svgEl("svg", { class: "spark", viewBox: `0 -6 ${W} ${H + 12}`, preserveAspectRatio: "none", "aria-hidden": "true" }) as SVGSVGElement;
  const band = pts.filter((p) => p[3] != null && p[4] != null);
  if (band.length > 1)
    svg.append(svgEl("path", { class: "band", d: `M${band.map((p) => `${X(p[0])} ${Y(p[4]!)}`).join("L")}L${[...band].reverse().map((p) => `${X(p[0])} ${Y(p[3]!)}`).join("L")}Z` }));
  svg.append(svgEl("path", { class: "line", d: `M${pts.map((p) => `${X(p[0])} ${Y(p[1])}`).join("L")}` }));
  for (const p of pts) svg.append(svgEl("circle", { cx: X(p[0]), cy: Y(p[1]), r: p[2] === 0 ? 2.6 : 2.2, class: p[2] === 0 ? "dot-off" : "dot-mod" }));
  const now = pts.find((p) => p[0] === year);
  if (now) svg.append(svgEl("circle", { cx: X(now[0]), cy: Y(now[1]), r: 5, class: "now" }));
  const wrap = el("div", "spark-wrap");
  const years = el("div", "spark-years");
  years.append(el("span", "", String(y0)), el("span", "", String(y1)));
  wrap.append(svg, years);
  return wrap;
}

function swatch(step: Step, breaks: number[]): SVGSVGElement {
  const s = svgEl("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" }) as SVGSVGElement;
  s.append(svgEl("rect", { width: 10, height: 10, class: step.value == null ? "nd" : `c${classOf(step.value, breaks)} ${step.source === "official" ? "off" : "mod"}` }));
  if (step.tier && step.tier >= 1) {
    const g = step.tier >= 2 ? "M0 5L5 0M0 10L10 0M5 10L10 5" : "M0 10L10 0";
    s.append(svgEl("path", { d: g, class: "hatch-ground", "stroke-width": 2 }), svgEl("path", { d: g, class: "hatch-ink", "stroke-width": 0.8 }));
  }
  return s;
}

function drawCard(step: Step, pack: Pack, progress: HTMLElement): HTMLElement {
  const w = step.words[lang];
  const card = el("div", "card");
  // Compact: two lines (the phone caption).
  const one = el("p", "c-line one");
  one.append(el("b", "", step.name), ` · ${step.province}`);
  const two = el("p", "c-line two");
  if (step.value != null) {
    two.append(el("span", `mono${step.source === "model" ? " model" : ""}`, pct(step.value)), lang === "ja" ? `・${w.source}` : ` below the poverty line · ${w.source}`);
  } else two.textContent = lang === "ja" ? `${pack.year}年の推計はありません。` : `No estimate for ${pack.year}.`;
  // Desktop: the caption panel.
  const eyebrow = el("div", "eyebrow", lang === "ja" ? `貧困率・${pack.year}年` : `Poverty incidence · ${pack.year}`);
  const name = el("h2", "name", step.name);
  const where = el("div", "where", `${step.province} · ${step.region}`);
  const figure = el("div", "figure");
  if (step.value != null) figure.append(el("span", `value${step.source === "model" ? " model" : ""}`, pct(step.value)), el("span", "below", lang === "ja" ? "貧困線未満" : "below the poverty line"));
  const chips = el("div", "chips");
  const c1 = el("span", "chip");
  c1.append(swatch(step, pack.breaks), w.source);
  chips.append(c1, el("span", "chip", w.tier));
  const sentence = el("p", "sentence", w.compare ?? w.headline ?? "");
  const legend = el("div", "legend");
  const ramp = el("div", "ramp");
  for (let i = 0; i < 5; i++) {
    const sp = el("span", `c${i}`);
    sp.style.background = `var(--ak-seq-${i + 1})`;
    ramp.append(sp);
  }
  const labels = el("div", "ramp-labels");
  for (const t of [`<${pack.breaks[0]}`, `${pack.breaks[0]}–${pack.breaks[1]}`, `${pack.breaks[1]}–${pack.breaks[2]}`, `${pack.breaks[2]}–${pack.breaks[3]}`, `≥${pack.breaks[3]}`]) labels.append(el("span", "", t));
  legend.append(ramp, labels, el("div", "", lang === "ja" ? "% 貧困線未満 · 淡色 = モデル推計 · 斜線 = 不確か" : "% below the poverty line · lighter = model estimate · hatched = less certain"));
  card.append(one, two, eyebrow, name, where, figure, chips, sparkline(step, pack.year), sentence);
  card.append(legend, progress);
  return card;
}

// ---------------------------------------------------------------------------------------------- the tour

function applyTheme(theme: string | null, contrast: string | null) {
  const d = document.documentElement;
  if (theme === "light" || theme === "dark") {
    d.setAttribute("data-theme", theme);
    d.classList.remove(theme === "dark" ? "light" : "dark");
    d.classList.add(theme);
    d.style.colorScheme = theme;
  } else {
    d.removeAttribute("data-theme");
    d.classList.remove("light", "dark");
    d.style.colorScheme = "";
  }
  if (contrast === "more" || contrast === "normal") d.setAttribute("data-contrast", contrast);
  else d.removeAttribute("data-contrast");
}
const cookie = (k: string) => {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${k}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
};

async function start() {
  const app = document.getElementById("app")!;
  const pack = (await (await fetch(PACK_URL)).json()) as Pack;
  const map = el("div", "map");
  const attr = el("div", "attr");
  const panel = el("div", "panel");
  app.append(map, panel);
  let step = motionQ.matches ? pack.still : 0;
  let current: { svg: SVGSVGElement; card: HTMLElement } | null = null;
  let progress: Animation | null = null;
  let uid = 0;

  const layout = () => {
    const compact = compactQ.matches;
    attr.textContent = "Boundaries: OCHA/NAMRIA/PSA (CC BY-IGO) · PSA SAE; Lights";
    const { width: w, height: h } = map.getBoundingClientRect();
    // Compact keeps the province clear of the attribution strip (lights-bugs #7).
    return { box: { w, h }, pad: compact ? { x: 12, top: 12, bottom: 12 + attr.offsetHeight } : { x: 32, top: 32, bottom: 32 } };
  };

  const render = (i: number, animate: boolean) => {
    const { box, pad } = layout();
    const s = pack.steps[i]!;
    const svg = drawMap(s, pack.breaks, box, pad, String(uid++));
    const bar = el("div", "progress");
    bar.append(el("i"));
    const card = drawCard(s, pack, bar);
    map.insertBefore(svg, attr);
    panel.append(card);
    document.documentElement.dataset.tourStep = String(i);
    const prev = current;
    current = { svg, card };
    if (animate && prev) {
      const ease = "cubic-bezier(0.4, 0, 0.2, 1)";
      svg.animate([{ opacity: 0, transform: "scale(1.035)" }, { opacity: 1, transform: "scale(1)" }], { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", composite: "replace" });
      svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: ease });
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: ease });
      const out = [prev.svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: ease, fill: "forwards" }), prev.card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: ease, fill: "forwards" })];
      void Promise.all(out.map((a) => a.finished)).then(() => (prev.svg.remove(), prev.card.remove())).catch(() => undefined);
    } else if (prev) {
      prev.svg.remove();
      prev.card.remove();
    }
    if (motionQ.matches) return;
    // The dwell clock is the progress bar's own animation: pausing it pauses the tour.
    progress = bar.firstElementChild!.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DWELL_MS, easing: "linear", fill: "forwards" });
    progress.finished.then(() => render((i + 1) % pack.steps.length, true)).catch(() => undefined);
    step = i;
    sync();
  };

  let inView = true;
  const running = () => inView && document.visibilityState === "visible" && !paused && !motionQ.matches;
  const sync = () => {
    if (!progress) return;
    if (running()) {
      if (progress.playState === "paused") progress.play();
    } else if (progress.playState === "running") progress.pause();
    document.documentElement.toggleAttribute("data-embed-paused", !running());
  };

  map.append(attr);
  render(step, false);
  // Ready once the first place is painted (fonts may still swap: the layout does not depend on them).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.documentElement.dataset.embedReady = "";
      if (framed) window.parent.postMessage({ type: "akari:embed-ready", app: "lights" }, PARENT_ORIGIN);
    }),
  );

  new IntersectionObserver(([e]) => {
    inView = !!e?.isIntersecting;
    sync();
  }).observe(app);
  document.addEventListener("visibilitychange", sync);
  motionQ.addEventListener("change", () => {
    progress?.cancel();
    progress = null;
    render(motionQ.matches ? pack.still : step, false);
  });
  // A resize or a layout switch redraws the current place at once (no animation), keeping the clock.
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!current) return;
      const t = progress?.currentTime;
      progress?.cancel();
      progress = null;
      render(step, false);
      if (progress && typeof t === "number") (progress as Animation).currentTime = t;
    });
  }).observe(map);

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
    const msg = e.data as { type?: string; scale?: number; theme?: string | null; contrast?: string | null } | null;
    if (msg?.type === "akari:embed-pause" || msg?.type === "akari:embed-resume") {
      paused = msg.type === "akari:embed-pause";
      sync();
    } else if (msg?.type === "akari:embed-scale") {
      const s = Number(msg.scale);
      if (s > 0 && s <= 1) document.documentElement.style.setProperty("--embed-scale", String(s));
    } else if (msg?.type === "akari:theme") {
      const own = location.hostname === COOKIE_DOMAIN || location.hostname.endsWith(`.${COOKIE_DOMAIN}`);
      if (own) applyTheme(cookie("theme"), cookie("contrast"));
      else applyTheme(msg.theme ?? null, msg.contrast ?? null);
    }
  });
}

void start();
