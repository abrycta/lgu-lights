#!/usr/bin/env node
// Packs the /embed tour (src/embed, drawn as SVG) into ONE immutable file from a materialised data version:
//   node scripts/build-embed.mjs [data-dir] [outlines]
// data-dir: a data version root (default public/data, following its latest.json).
// outlines: the pipeline's simplified boundaries (`lgu outlines`: one coverage, so neighbours share their edges;
//   default ../data/build/outlines.geojsonl; a data run publishes it in the features-<version> release as
//   outlines.geojsonl.gz).
// The tour is chosen from the data by src/embed/tour-select.ts (its header states the rule). Each step carries its
// province's view pre-projected (Web Mercator, quantised to Q units across the province), every place within
// reach of any frame shape with the frozen year's value, tier and source, the province lines, and the caption:
// the app's own sentences (src/lib/plain.ts, src/lib/honesty.ts) in English and Japanese, and the place's series.
// Shared edges are simplified once (topology-aware), so neighbours never open a gap between them.
// Writes public/embed-data/lights-<hash>.json, src/embed/pack.gen.ts (its URL) and the preload in embed.html.
// All three are committed; re-run after a data release.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runnerImport } from "vite";

import { chooseTour } from "../src/embed/tour-select.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const YEAR = 2023;
/** Units across the province's longer side (one unit is about 0.6 CSS px in the 1280×800 desktop frame). */
const Q = 1000;
/** Douglas–Peucker tolerance in units, inside the province's box and (coarser) around it. */
const TOL = 0.8;
const TOL_AROUND = 3;
/** The frame shapes the pack must fill (map box width / height): a portrait phone (0.45) to the phone slot's strip (2.6). */
const ASPECT_MAX = 2.6;
const ASPECT_MIN = 0.45;
/** Margin around the reach, as a share of it (the fit's padding and the tour's settle). */
const MARGIN = 0.06;

const root = resolve(process.argv[2] ?? join(web, "public/data"));
const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
const dir = join(root, latest.base);
const json = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const outlinesPath = resolve(process.argv[3] ?? join(web, "../data/build/outlines.geojsonl"));
const outlines = readFileSync(outlinesPath, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const adm3 = outlines.filter((f) => f.properties.level === 3);
const adm2 = outlines.filter((f) => f.properties.level === 2);

const manifest = json("manifest.json");
const index = json("index.json");

// The app's own sentences and labels, loaded through Vite (they use the app's "@/" imports).
const load = async (p) =>
  (await runnerImport(join(web, p), { configFile: false, logLevel: "silent", resolve: { alias: { "@": join(web, "src") } } })).module;
const plain = await load("src/lib/plain.ts");
const honesty = await load("src/lib/honesty.ts");

// The tour (rule 27): the richest moments, chosen from the data; step 0 is the still.
const chosen = chooseTour(index, (p) => json(`lgu/${p}.json`).years.find((y) => y.year === YEAR));
for (const [i, c] of chosen.picks.entries())
  console.log(`tour ${i}: ${c.pcode} ${c.name}, ${c.province}: ${c.official} % official; ${c.places} places, ${c.low}–${c.highest} %, ${c.solid} solid`);

// The frozen year's value, tier and source for every place (tiles-attrs.csv), and the national values for the comparisons.
const csvText = readFileSync(join(dir, "tiles-attrs.csv"), "utf8");
const nat = plain.parseAttrsCsv(csvText);
const yi = nat.years.indexOf(YEAR);
if (yi < 0) throw new Error(`tiles-attrs.csv has no ${YEAR} columns`);
const attrOf = (pcode) => {
  const r = nat.rows.get(pcode);
  const v = r?.v[yi];
  if (v == null || Number.isNaN(v)) return { v: -1, t: 0, s: 0 };
  return { v, t: (nat.tiers ? r.t[yi] : 0) ?? 0, s: r.s[yi] ?? 0 };
};

// ------------------------------------------------------------------------------------------------ geometry

const mx = (lon) => (lon + 180) / 360;
const my = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
for (const f of outlines) {
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys(f.geometry)) for (const [x, y] of p[0]) [a, b, c, d] = [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)];
  f.bbox = [a, b, c, d];
}

/** Sutherland–Hodgman: a ring clipped to [x0, y0, x1, y1] (the cut edges lie outside every view). */
function clip(ring, [x0, y0, x1, y1]) {
  let out = ring;
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      if (inside(a)) {
        out.push(a);
        if (!inside(b)) out.push(cut(a, b));
      } else if (inside(b)) out.push(cut(a, b));
    }
    if (!out.length) return out;
  }
  return out;
}

/** Douglas–Peucker on an open run (both ends kept). */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = len ? Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
      if (d > best) [best, at] = [d, k];
    }
    if (best > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

const key = (p) => p[0] * 1e6 + p[1];
const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * Topology-aware simplification of every ring in a step (integer units). A point where the set of rings
 * through it changes is a junction and is kept; each run between junctions is simplified once, in a canonical
 * direction, so the two rings sharing an edge get exactly the same points. `tolOf(run)` picks the tolerance.
 */
function simplifyRings(rings, tolOf) {
  const owners = new Map();
  rings.forEach((ring, r) => {
    for (const p of ring) {
      const k = key(p);
      const o = owners.get(k);
      if (!o) owners.set(k, [r]);
      else if (o[o.length - 1] !== r) o.push(r);
    }
  });
  const sig = (p) => owners.get(key(p)).join(",");
  return rings.map((ring) => {
    const n = ring.length;
    const fixed = [];
    for (let i = 0; i < n; i++) {
      const s = sig(ring[i]);
      if (s !== sig(ring[(i + n - 1) % n]) || s !== sig(ring[(i + 1) % n])) fixed.push(i);
    }
    if (!fixed.length) {
      // A ring shared whole (or by nobody): start at its smallest point and split at the farthest from it.
      let lo = 0;
      for (let i = 1; i < n; i++) if (less(ring[i], ring[lo])) lo = i;
      let far = lo;
      const d = (i) => Math.hypot(ring[i][0] - ring[lo][0], ring[i][1] - ring[lo][1]);
      for (let i = 0; i < n; i++) if (d(i) > d(far) || (d(i) === d(far) && less(ring[i], ring[far]))) far = i;
      fixed.push(...[lo, far].sort((a, b) => a - b));
    }
    const out = [];
    for (let f = 0; f < fixed.length; f++) {
      const i = fixed[f];
      const j = fixed[(f + 1) % fixed.length];
      const run = [];
      for (let k = i; ; k = (k + 1) % n) {
        run.push(ring[k]);
        if (k === j && run.length > 1) break;
      }
      // Canonical direction: from the smaller end (or, for a closed run, the smaller second point).
      const [a, b] = run.length > 2 && key(run[0]) === key(run[run.length - 1]) ? [run[1], run[run.length - 2]] : [run[0], run[run.length - 1]];
      const flip = less(b, a);
      const s = simplify(flip ? [...run].reverse() : run, tolOf(run));
      if (flip) s.reverse();
      out.push(...s.slice(0, -1));
    }
    return out;
  });
}

/** One SVG path ("M x y l dx dy …z" per ring, relative, integer units). */
function pathOf(rings) {
  let out = "";
  for (const s of rings) {
    if (s.length < 3) continue;
    let d = `M${s[0][0]} ${s[0][1]}l`;
    for (let i = 1; i < s.length; i++) {
      const dx = s[i][0] - s[i - 1][0];
      const dy = s[i][1] - s[i - 1][1];
      d += `${i > 1 && dx >= 0 ? " " : ""}${dx}${dy >= 0 ? " " : ""}${dy}`;
    }
    out += `${d}z`;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the steps

const r1 = (v) => Math.round(v * 10) / 10;
const steps = [];
for (const pcode of chosen.tour) {
  const lgu = json(`lgu/${pcode}.json`);
  const province = index.provinces.find((p) => p.pcode === lgu.province.pcode);
  const [w, s, e, n] = province.bbox;
  const pw = mx(e) - mx(w);
  const ph = my(s) - my(n);
  const k = Q / Math.max(pw, ph);
  const x0 = mx(w);
  const y0 = my(n);
  // Everything a view of the province can show, from a tall box (ASPECT_MIN) to a wide one (ASPECT_MAX).
  const rw = Math.max(pw, ph * ASPECT_MAX) * (1 + MARGIN);
  const rh = Math.max(ph, pw / ASPECT_MIN) * (1 + MARGIN);
  const [cx, cy] = [(mx(w) + mx(e)) / 2, (my(n) + my(s)) / 2];
  const region = [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
  const box = [(region[0] - x0) * k, (region[1] - y0) * k, (region[2] - x0) * k, (region[3] - y0) * k];
  const inner = [0, 0, pw * k, ph * k];
  const inRegion = (b) => mx(b[2]) >= region[0] && mx(b[0]) <= region[2] && my(b[1]) >= region[1] && my(b[3]) <= region[3];

  // Every ring in reach, projected, clipped and quantised; then simplified together.
  const rings = [];
  const ringsOf = (f) => {
    const ids = [];
    for (const poly of polys(f.geometry))
      for (const ring of poly) {
        const q = [];
        for (const [px, py] of clip(ring.slice(0, -1).map(([lon, lat]) => [(mx(lon) - x0) * k, (my(lat) - y0) * k]), box)) {
          const p = [Math.round(px), Math.round(py)];
          const l = q[q.length - 1];
          if (!l || l[0] !== p[0] || l[1] !== p[1]) q.push(p);
        }
        while (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
        if (q.length >= 3) ids.push(rings.push(q) - 1);
      }
    return ids;
  };
  const places = adm3.filter((f) => inRegion(f.bbox)).map((f) => ({ pcode: f.properties.pcode, ids: ringsOf(f) }));
  const provs = adm2.filter((f) => inRegion(f.bbox)).map((f) => ({ pcode: f.properties.pcode, ids: ringsOf(f) }));
  const inside = (run) => run.some(([x, y]) => x >= inner[0] && x <= inner[2] && y >= inner[1] && y <= inner[3]);
  const simple = simplifyRings(rings, (run) => (inside(run) ? TOL : TOL_AROUND));
  const area = (r) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
    return Math.abs(a) / 2;
  };
  // Islets under about 2×2 units are invisible: dropped, unless an edge is shared (a neighbour would show a hole).
  const shared = new Set();
  {
    const seen = new Map();
    simple.forEach((r, i) => r.forEach((p) => (seen.has(key(p)) && seen.get(key(p)) !== i ? (shared.add(i), shared.add(seen.get(key(p)))) : seen.set(key(p), i))));
  }
  const keep = (i) => simple[i].length >= 3 && (area(simple[i]) >= 2 || shared.has(i));

  // Features: [path, value (-1: none), tier, source (0 official, 1 model)].
  const features = [];
  let selected = -1;
  for (const p of places) {
    const d = pathOf(p.ids.filter(keep).map((i) => simple[i]));
    if (!d) continue;
    const a = attrOf(p.pcode);
    if (p.pcode === pcode) selected = features.length;
    features.push([d, a.v, a.t, a.s]);
  }
  if (selected < 0) throw new Error(`${pcode} drew no shape`);
  let provLines = "";
  let provSelected = "";
  for (const p of provs) {
    const d = pathOf(p.ids.filter(keep).map((i) => simple[i]));
    provLines += d;
    if (p.pcode === province.pcode) provSelected = d;
  }

  // The caption: the app's own sentences, the place's series, its figure.
  const rec = lgu.years.find((y) => y.year === YEAR);
  const f = plain.shownFigure(rec);
  const provLgus = index.lgus.filter((l) => l.pv === province.pcode).map((l) => json(`lgu/${l.p}.json`));
  const avg = f ? plain.provinceAverage(provLgus, YEAR, f.source) : null;
  const others = f ? [...plain.valuesOf(nat, YEAR, f.source)].filter(([p]) => p !== pcode).map(([, v]) => v) : [];
  const words = {};
  for (const lang of ["en", "ja"])
    words[lang] = {
      source: f ? honesty.sourceLabel(f.source, YEAR, lang) : "",
      tier: f ? honesty.TIER_LABEL[f.tier][lang] : "",
      compare: f
        ? plain.comparisonSentence(
            { value: f.est, lo: f.lo, hi: f.hi, source: f.source, year: YEAR, others, province: avg ? { name: province.name, mean: avg.mean, n: avg.n } : null },
            lang,
          )
        : null,
      headline: plain.headline(rec, YEAR, lgu.name, lang),
    };
  steps.push({
    pcode,
    name: lgu.name,
    province: province.name,
    region: lgu.region?.name ?? "",
    // The shown figure as the app's caption shows it (src/lib/format.ts rounds it the same way at display).
    value: rec?.shown?.value ?? null,
    source: rec?.shown?.source ?? null,
    tier: f?.tier ?? null,
    // The series for the sparkline: [year, value, 0 official / 1 model, lo90, hi90].
    series: lgu.years
      .filter((y) => y.shown)
      .map((y) => {
        const g = plain.shownFigure(y);
        return [y.year, r1(y.shown.value), y.shown.source === "official" ? 0 : 1, g ? r1(Math.max(0, g.lo)) : null, g ? r1(g.hi) : null];
      }),
    words,
    view: [0, 0, Math.round(pw * k), Math.round(ph * k)], // the province's box in units: the renderer fits it
    features,
    selected,
    provLines,
    provSelected,
  });
}

const pack = { version: manifest.version, year: YEAR, breaks: manifest.breaks, opacity: { official: honesty.OFFICIAL_OPACITY, model: honesty.MODEL_OPACITY }, steps };
const body = JSON.stringify(pack);
const name = `lights-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
const outDir = join(web, "public/embed-data");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^lights-.*\.json$/.test(f) && f !== name) rmSync(join(outDir, f));
writeFileSync(join(outDir, name), body);
writeFileSync(
  join(web, "src/embed/pack.gen.ts"),
  `// Written by scripts/build-embed.mjs from data ${manifest.version}; do not edit.\nexport const PACK_URL = "/embed-data/${name}";\n` +
    `/** The tour (tour-select.ts), for the tests: the pack's steps are these places in this order; step 0 is the still. */\n` +
    `export const TOUR = ${JSON.stringify(chosen.tour)} as const;\n`,
);
const html = join(web, "embed.html");
writeFileSync(
  html,
  readFileSync(html, "utf8").replace(
    /(<!-- embed-pack[^>]*-->\n)[\s\S]*?(\s*<!-- \/embed-pack -->)/,
    `$1    <link rel="preload" href="/embed-data/${name}" as="fetch" crossorigin="anonymous" />$2`,
  ),
);
console.log(`${name}: ${(body.length / 1024).toFixed(0)} kB, ${steps.length} steps (${steps.map((s) => `${s.name} ${s.features.length}`).join(", ")}), data ${manifest.version}`);
