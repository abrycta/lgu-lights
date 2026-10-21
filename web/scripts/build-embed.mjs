#!/usr/bin/env node
// Packs the /embed tour (src/embed) into ONE immutable file from a materialised data version:
//   node scripts/build-embed.mjs [data-dir]      (default: public/data, following its latest.json)
// Writes public/embed-data/lights-<hash>.json (manifest, index, each tour province's LGU files, the
// year's national values and the vector tiles under each province's view), src/embed/pack.gen.ts (its
// URL and the tour) and the preload link in embed.html. All three are committed; re-run after a data release.
// There is no basemap image: Lights draws no basemap (its ground is the theme's background colour).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VectorTile } from "@mapbox/vector-tile";
import { fromVectorTileJs } from "@maplibre/vt-pbf";
import { PbfReader } from "pbf";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const YEAR = 2023;
// The tour: one place per step, each shown zoomed to its province with its panel open (the real app's
// selection). Chosen from the 2023 data (v3) to show contrast across the islands; re-check after a data release.
const TOUR = [
  // Occidental Mindoro (Mimaropa, Luzon): the portfolio screenshot's view, so the first paint matches the poster.
  "PH1705101", // Abra de Ilog: 37.8 %, official, solid
  // Zamboanga del Norte (Mindanao): the highest official 2023 figure in the country.
  "PH0907215", // Siayan: 67.8 %, official, solid
  // Negros Occidental (Western Visayas): a striped "use with care" official figure (CV over 10 %).
  "PH0604532", // Salvador Benedicto: 41.7 %, official, use with care
  // Pampanga (Central Luzon): one of the lowest official 2023 figures.
  "PH0305416", // City of San Fernando: 4.0 %, official, solid
  // Leyte (Eastern Visayas): PSA published no 2023 figure, so the map shows Lights' model estimate.
  "PH0803747", // Tacloban City: 15.6 %, model estimate, rough guess
  // Davao del Norte (Davao Region, Mindanao): the lowest official 2023 figure in Mindanao.
  "PH1102319", // City of Tagum: 8.5 %, official, solid
];
const VIEW = { year: YEAR, lgu: TOUR[0] };
// The map box of /embed at the portfolio's fixed 1280×800 frame (measured: 1280 − the 460 px panel,
// 800 − the controls and the national sentence). Tiles get a small margin (M).
const MAP_W = 820;
const MAP_H = 609;
const PAD = 32; // MapView's province fitBounds padding
const MAX_ZOOM = 10;
const SOURCE_MAXZOOM = 10;

const root = resolve(process.argv[2] ?? join(web, "public/data"));
const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
const dir = join(root, latest.base);
const json = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));

const manifest = json("manifest.json");
const index = json("index.json");
const provinces = [...new Set(TOUR.map((p) => p.slice(0, 7)))].map((pc) => {
  const province = index.provinces.find((p) => p.pcode === pc);
  if (!province) throw new Error(`no province ${pc}`);
  return province;
});
// The tour's places keep their whole file (the panel's figure, words and chart); their province-mates
// only feed the province average, so they keep just the frozen year's shown value and population.
const lgus = {};
for (const { pcode: pc } of provinces)
  for (const l of index.lgus.filter((x) => x.pv === pc)) {
    const d = json(`lgu/${l.p}.json`);
    lgus[l.p] = TOUR.includes(l.p)
      ? d
      : { ...d, years: d.years.filter((y) => y.year === YEAR).map((y) => ({ year: y.year, shown: y.shown, inputs: { pop: y.inputs?.pop ?? null }, model: null, official: null })) };
  }
for (const p of TOUR) if (!lgus[p]) throw new Error(`no LGU ${p}`);

// tiles-attrs.csv, only the frozen year's value and source (what the comparisons read).
const yy = String(YEAR % 100).padStart(2, "0");
const csv = readFileSync(join(dir, "tiles-attrs.csv"), "utf8").trim().split(/\r?\n/);
const head = csv[0].split(",");
const vi = head.indexOf(`v${yy}`) - 2;
const si = head.indexOf(`s${yy}`) - 2;
const attrs = [`pcode,n,v${yy},s${yy}`];
for (const line of csv.slice(1)) {
  const m = /^([^,]+),("(?:[^"]|"")*"|[^,]*),(.*)$/.exec(line);
  if (!m) continue;
  const cells = m[3].split(",");
  attrs.push(`${m[1]},,${cells[vi]},${cells[si]}`);
}

// Which tiles each view needs: MapLibre's fitBounds (512 px tiles), then the covering tiles at floor(zoom).
// The map's settle ease (src/map/MapView.tsx) starts zoomed in within the same tile zoom, so it needs no more.
const mx = (lon) => ((lon + 180) / 360) * 512;
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * 512;
// Each tile keeps only the features that reach into a view (plus margin), with only the frozen year's
// properties (v/t/s<yy>) and the pcode, its geometry quantised from 4096 to 1024 units per tile, without
// repeated points. A tile is drawn at most 1024 CSS px wide, and the portfolio shows the 1280 px frame
// scaled to about half (its ?pr= follows), so one unit stays at about a device pixel (2048: +28 % bytes).
const KEEP = new Set(["pcode", `v${yy}`, `t${yy}`, `s${yy}`]);
const EXTENT = 1024;
function slim(buf, rects) {
  const layers = {};
  for (const [name, l] of Object.entries(new VectorTile(new PbfReader(buf)).layers)) {
    const q = EXTENT / l.extent;
    const feats = [];
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      const raw = f.loadGeometry();
      const [x0, y0, x1, y1] = f.bbox();
      const r = (v) => v / l.extent; // tile units -> fraction of the tile
      if (!rects.some(([a, b, c, d]) => r(x1) >= a && r(x0) <= c && r(y1) >= b && r(y0) <= d)) continue;
      const geometry = [];
      for (const ring of raw) {
        const out = [];
        for (const pt of ring) {
          const x = Math.round(pt.x * q);
          const y = Math.round(pt.y * q);
          const last = out[out.length - 1];
          if (!last || last.x !== x || last.y !== y) out.push({ x, y });
        }
        // Polygons need 4 points (closed) to keep an area; lines need 2.
        if (out.length >= (f.type === 3 ? 4 : f.type === 2 ? 2 : 1)) geometry.push(out);
      }
      if (!geometry.length) continue;
      const properties = Object.fromEntries(Object.entries(f.properties).filter(([key]) => KEEP.has(key)));
      feats.push({ id: f.id, type: f.type, properties, geometry, loadGeometry: () => geometry });
    }
    layers[name] = { version: 2, name, extent: EXTENT, length: feats.length, feature: (i) => feats[i] };
  }
  return fromVectorTileJs({ layers });
}

const M = 24; // px of margin, against rounding
const need = new Map(); // "z/x/y" -> the views' rectangles in that tile, as fractions of the tile
const zooms = [];
for (const province of provinces) {
  const [w, s, e, n] = province.bbox;
  const zoom = Math.min(MAX_ZOOM, Math.log2(Math.min((MAP_W - 2 * PAD) / (mx(e) - mx(w)), (MAP_H - 2 * PAD) / (my(s) - my(n)))));
  const z = Math.min(SOURCE_MAXZOOM, Math.floor(zoom));
  zooms.push(`${province.name} z${z}`);
  const k = 2 ** zoom;
  const cx = ((mx(w) + mx(e)) / 2) * k;
  const cy = ((my(n) + my(s)) / 2) * k;
  const ts = (512 / 2 ** z) * k; // one tile in frame px
  const [L, T, R, B] = [cx - MAP_W / 2 - M, cy - MAP_H / 2 - M, cx + MAP_W / 2 + M, cy + MAP_H / 2 + M].map((v) => v / ts);
  for (let x = Math.floor(L); x <= Math.floor(R); x++)
    for (let y = Math.floor(T); y <= Math.floor(B); y++) {
      const key = `${z}/${x}/${y}`;
      if (!need.has(key)) need.set(key, []);
      need.get(key).push([L - x, T - y, R - x, B - y]);
    }
}
const tiles = {};
for (const [key, rects] of need) {
  const f = join(dir, "tiles", `${key}.pbf`);
  if (existsSync(f)) tiles[key] = Buffer.from(slim(readFileSync(f), rects)).toString("base64");
}

// The index without the label points (x, y): nothing in the frozen view reads them.
const slimIndex = { ...index, lgus: index.lgus.map(({ x: _x, y: _y, ...l }) => l) };
const pack = { version: manifest.version, view: VIEW, tour: TOUR, manifest, index: slimIndex, lgus, attrs: attrs.join("\n") + "\n", tiles };
const body = JSON.stringify(pack);
const name = `lights-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
const outDir = join(web, "public/embed-data");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^lights-[0-9a-f]+\.json$/.test(f) && f !== name) rmSync(join(outDir, f));
writeFileSync(join(outDir, name), body);

writeFileSync(
  join(web, "src/embed/pack.gen.ts"),
  `// Written by scripts/build-embed.mjs from data ${manifest.version}; do not edit.\nexport const PACK_URL = "/embed-data/${name}";\nexport const VIEW = ${JSON.stringify(VIEW)} as const;\nexport const TOUR = ${JSON.stringify(TOUR)} as const;\n`,
);
const html = join(web, "embed.html");
writeFileSync(
  html,
  readFileSync(html, "utf8").replace(/(<!-- embed-pack[^>]*-->\s*<link rel="preload" href=")[^"]*(")/, `$1/embed-data/${name}$2`),
);
console.log(`${name}: ${(body.length / 1024).toFixed(0)} kB, ${Object.keys(tiles).length} tiles (${zooms.join(", ")}), ${Object.keys(lgus).length} LGU files, data ${manifest.version}`);
