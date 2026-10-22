#!/usr/bin/env node
// SPIKE (lt-embed-spike): packs the /embed-lite tour, a MapLibre-free SVG renderer, into ONE immutable file:
//   node scripts/build-embed-lite.mjs [data-dir] [geometry-dir]
// data-dir: a materialised data version root (default public/data, following latest.json);
// geometry-dir: the boundaries step's newline GeoJSON (adm3.geojsonl, adm2.geojsonl; default ../data/build/dev-*).
// Each tour step carries its province's view pre-projected (Web Mercator, quantised to Q units across the
// province, simplified), every LGU in reach with the frozen year's value, tier and source, the province lines, and
// the caption's words precomputed with src/lib/plain.ts (the app's own sentences), in English and Japanese.
// Writes public/embed-data/lite-<hash>.json and src/embed-lite/pack.gen.ts.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rolldown } from "rolldown";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const YEAR = 2023;
const yy = String(YEAR % 100).padStart(2, "0");
// The same tour as today's /embed (src/embed/pack.gen.ts), so the comparison is like for like.
const TOUR = JSON.parse(/TOUR = (\[[^\]]*\])/.exec(readFileSync(join(web, "src/embed/pack.gen.ts"), "utf8"))[1]);
/** Units across the province's longer side (one unit is about 0.4 CSS px in the 1280×800 desktop frame). */
const Q = 1000;
/** Douglas–Peucker tolerance, in units. */
const TOL = 0.8;
/** The widest and tallest map boxes the pack must fill (width / height): desktop 1.35, phones up to about 2.4. */
const ASPECT_MAX = 2.6;
const ASPECT_MIN = 1.0;

const root = resolve(process.argv[2] ?? join(web, "public/data"));
const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
const dir = join(root, latest.base);
const json = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const geomDir = resolve(process.argv[3] ?? join(web, "../data/build"));
const geo = (names) => {
  for (const n of names) {
    try {
      return readFileSync(join(geomDir, n), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    } catch {
      /* next name */
    }
  }
  throw new Error(`none of ${names.join(", ")} in ${geomDir}`);
};
const adm3 = geo(["adm3.geojsonl", "dev-adm3.geojsonl"]);
const adm2 = geo(["adm2.geojsonl", "dev-adm2.geojsonl"]);

const manifest = json("manifest.json");
const index = json("index.json");

// The app's own sentences (src/lib/plain.ts), bundled once for Node.
const tmp = join(tmpdir(), `plain-${process.pid}.mjs`);
const bundle = await rolldown({ input: join(web, "src/lib/plain.ts"), resolve: { alias: { "@": join(web, "src") } }, logLevel: "silent" });
await bundle.write({ file: tmp, format: "esm" });
const plain = await import(pathToFileURL(tmp).href);
rmSync(tmp);
const honesty = { sourceLabel: (s, y, l) => (s === "official" ? (l === "ja" ? `PSA公式統計（${y}年）` : `PSA official (${y})`) : l === "ja" ? `モデル推計（${y}年）` : `Model estimate (${y})`) };
const TIER = [
  { en: "Solid", ja: "確かな値" },
  { en: "Use with care", ja: "注意して使う値" },
  { en: "Rough guess", ja: "おおよその目安" },
];

// The frozen year's value, tier and source for every place (tiles-attrs.csv), and the national values for the comparisons.
const csvText = readFileSync(join(dir, "tiles-attrs.csv"), "utf8");
const nat = plain.parseAttrsCsv(csvText);
const csv = csvText.trim().split(/\r?\n/);
const head = csv[0].split(",");
const col = (k) => head.indexOf(k) - 2;
const [vi, ti, si] = [col(`v${yy}`), col(`t${yy}`), col(`s${yy}`)];
if (vi < 0 || ti < 0 || si < 0) throw new Error(`tiles-attrs.csv has no ${YEAR} columns`);
const attr = new Map();
for (const line of csv.slice(1)) {
  const m = /^([^,]+),("(?:[^"]|"")*"|[^,]*),(.*)$/.exec(line);
  if (!m) continue;
  const c = m[3].split(",");
  const v = c[vi] === "" ? -1 : Number(c[vi]);
  attr.set(m[1], { v, t: c[ti] === "" ? 0 : Number(c[ti]), s: c[si] === "" ? 0 : Number(c[si]) });
}

const mx = (lon) => (lon + 180) / 360;
const my = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
function bboxOf(g) {
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys(g)) for (const [x, y] of p[0]) [a, b, c, d] = [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)];
  return [a, b, c, d];
}
for (const f of [...adm3, ...adm2]) f.bbox = bboxOf(f.geometry);

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len;
      if (d > best) [best, at] = [d, k];
    }
    if (best > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Sutherland–Hodgman: a ring clipped to [x0, y0, x1, y1] (fills only; the cut edges lie outside every view). */
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
  if (out.length) out.push(out[0]);
  return out;
}

/** One SVG path ("M x y l dx dy …z" per ring, relative, integer units) for a geometry in a step's frame. */
function pathOf(geometry, tf, tol = TOL) {
  let out = "";
  for (const poly of polys(geometry))
    for (const ring of poly) {
      const q = [];
      const projected = clip(ring.slice(0, -1).map(([lon, lat]) => [(mx(lon) - tf.x0) * tf.k, (my(lat) - tf.y0) * tf.k]), tf.clip);
      for (const [px, py] of projected) {
        const p = [Math.round(px), Math.round(py)];
        const l = q[q.length - 1];
        if (!l || l[0] !== p[0] || l[1] !== p[1]) q.push(p);
      }
      // A closed ring starts and ends on one point: split it at the point farthest from the start.
      let far = 0;
      for (let i = 1; i < q.length; i++) if (Math.hypot(q[i][0] - q[0][0], q[i][1] - q[0][1]) > Math.hypot(q[far][0] - q[0][0], q[far][1] - q[0][1])) far = i;
      const s = [...simplify(q.slice(0, far + 1), tol), ...simplify(q.slice(far), tol).slice(1)];
      if (s.length < 4) continue;
      let area = 0;
      for (let i = 1; i < s.length; i++) area += s[i - 1][0] * s[i][1] - s[i][0] * s[i - 1][1];
      if (Math.abs(area) < 4) continue; // under about 2×2 units: invisible
      let d = `M${s[0][0]} ${s[0][1]}l`;
      for (let i = 1; i < s.length - 1; i++) {
        const dx = s[i][0] - s[i - 1][0];
        const dy = s[i][1] - s[i - 1][1];
        d += `${i > 1 && dx >= 0 ? " " : ""}${dx}${dy >= 0 ? " " : ""}${dy}`;
      }
      out += `${d}z`;
    }
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;
const steps = [];
for (const pcode of TOUR) {
  const lgu = json(`lgu/${pcode}.json`);
  const province = index.provinces.find((p) => p.pcode === lgu.province.pcode);
  const [w, s, e, n] = province.bbox;
  const pw = mx(e) - mx(w);
  const ph = my(s) - my(n);
  const k = Q / Math.max(pw, ph);
  const tf = { x0: mx(w), y0: my(n), k };
  // Everything a view of the province can show, from a tall box (ASPECT_MIN) to a wide one (ASPECT_MAX), plus 12 %.
  const rw = Math.max(pw, ph * ASPECT_MAX) * 1.06;
  const rh = Math.max(ph, pw / ASPECT_MIN) * 1.06;
  const [cx, cy] = [(mx(w) + mx(e)) / 2, (my(n) + my(s)) / 2];
  const region = [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2];
  tf.clip = [(region[0] - tf.x0) * k, (region[1] - tf.y0) * k, (region[2] - tf.x0) * k, (region[3] - tf.y0) * k];
  const inRegion = (b) => mx(b[2]) >= region[0] && mx(b[0]) <= region[2] && my(b[1]) >= region[1] && my(b[3]) <= region[3];
  // Features: [path, value (-1: none), tier, source (0 official, 1 model)], grouped by the renderer.
  const features = [];
  let selected = -1;
  let valued = 0;
  for (const f of adm3) {
    if (!inRegion(f.bbox)) continue;
    const p = pathOf(f.geometry, tf);
    if (!p) continue;
    const a = attr.get(f.properties.pcode) ?? { v: -1, t: 0, s: 0 };
    features.push([p, a.v, a.t, a.s]);
    if (f.properties.pcode === pcode) selected = features.length - 1;
    if (a.v >= 0 && f.properties.pcode.startsWith(province.pcode)) valued++;
  }
  let provLines = "";
  let provSelected = "";
  for (const f of adm2) {
    if (!inRegion(f.bbox)) continue;
    const p = pathOf(f.geometry, tf, TOL * 1.5);
    provLines += p;
    if (f.properties.pcode === province.pcode) provSelected = p;
  }
  // The caption: the app's own sentences (src/lib/plain.ts), the place's series, its figure.
  const rec = lgu.years.find((y) => y.year === YEAR);
  const f = plain.shownFigure(rec);
  const provLgus = index.lgus.filter((l) => l.pv === province.pcode).map((l) => json(`lgu/${l.p}.json`));
  const avg = f ? plain.provinceAverage(provLgus, YEAR, f.source) : null;
  const others = f ? [...plain.valuesOf(nat, YEAR, f.source)].filter(([p]) => p !== pcode).map(([, v]) => v) : [];
  const words = {};
  for (const lang of ["en", "ja"]) {
    const compare = f
      ? plain.comparisonSentence({ value: f.est, lo: f.lo, hi: f.hi, source: f.source, year: YEAR, others, province: avg ? { name: province.name, mean: avg.mean, n: avg.n } : null }, lang)
      : null;
    words[lang] = {
      source: f ? honesty.sourceLabel(f.source, YEAR, lang) : "",
      tier: f ? TIER[f.tier][lang] : "",
      headline: plain.headline(rec, YEAR, lgu.name, lang),
      compare,
      change: plain.changeSentence(lgu.years, rec, lang),
      why: plain.whyModelSentence(lgu.years, rec, lang),
    };
  }
  steps.push({
    pcode,
    name: lgu.name,
    province: province.name,
    region: lgu.region?.name ?? "",
    value: f ? r1(f.est) : null,
    source: f?.source ?? null,
    tier: f?.tier ?? null,
    // The series for the sparkline: [year, value, 0 official / 1 model, lo90, hi90].
    series: lgu.years.filter((y) => y.shown).map((y) => {
      const g = plain.shownFigure(y);
      return [y.year, r1(y.shown.value), y.shown.source === "official" ? 0 : 1, g ? r1(Math.max(0, g.lo)) : null, g ? r1(g.hi) : null];
    }),
    words,
    view: [0, 0, Math.round(pw * k), Math.round(ph * k)], // the province's box in units: the renderer fits it
    unitsPerWorld: Math.round(k),
    features,
    selected,
    provLines,
    provSelected,
    valued,
  });
}
// The reduced-motion still: the densest step (most places with a figure in the province in view).
const still = steps.reduce((b, s, i) => (s.valued > steps[b].valued ? i : b), 0);

const pack = { version: manifest.version, year: YEAR, breaks: manifest.breaks, still, steps };
const body = JSON.stringify(pack);
const name = `lite-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
const outDir = join(web, "public/embed-data");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^lite-[0-9a-f]+\.json$/.test(f) && f !== name) rmSync(join(outDir, f));
writeFileSync(join(outDir, name), body);
writeFileSync(
  join(web, "src/embed-lite/pack.gen.ts"),
  `// Written by scripts/build-embed-lite.mjs from data ${manifest.version}; do not edit.\nexport const PACK_URL = "/embed-data/${name}";\n`,
);
const html = join(web, "embed-lite.html");
writeFileSync(html, readFileSync(html, "utf8").replace(/href="\/embed-data\/lite-[^"]*"/, `href="/embed-data/${name}"`));
console.log(
  `${name}: ${(body.length / 1024).toFixed(0)} kB, ${steps.length} steps (${steps.map((s) => `${s.name} ${s.features.length}`).join(", ")}), still ${still}, data ${manifest.version}`,
);
