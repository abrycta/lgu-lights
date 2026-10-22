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

import { chooseTour } from "../src/embed/tour-select.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const YEAR = 2023;
// The map box of /embed at the portfolio's fixed 1280×800 frame (measured: 1280 − the 460 px panel,
// 800 − the controls and the national sentence). Tiles get a small margin (M).
const MAP_W = 820;
const MAP_H = 609;
const PAD = 32; // MapView's province fitBounds padding
// The compact layout (phones and tablets, src/embed/layout.ts): the frame is the portfolio's picture slot at
// its real size (16:10, about 356×222 on a phone up to 958×598), the map above a CAPTION_H caption strip,
// fitted with COMPACT_PAD. Phones and tablets each get their own pack (the tiles differ by zoom), so a phone
// never downloads a larger view's tiles.
const COMPACT_MAX_W = 1100; // = COMPACT_QUERY's max-width in src/embed/layout.ts
const SMALL_MAX_W = 600; // = SMALL_QUERY's max-width there: phones get a smaller pack than tablets
const CAPTION_H = 53; // the caption strip (52 px) and its top border
const COMPACT_PAD = 12;
function compactViews(from, to) {
  const views = [];
  for (let w = from; w <= to; w += 4) {
    const h = Math.round((w + 2) * 0.625) - 2 - CAPTION_H; // the slot is 16:10; the frame sits 1 px inside its border
    for (const dh of [-16, 0, 16]) views.push([w, Math.max(80, h + dh)]);
  }
  return views;
}
const MAX_ZOOM = 10;
const SOURCE_MAXZOOM = 10;

const root = resolve(process.argv[2] ?? join(web, "public/data"));
const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
const dir = join(root, latest.base);
const json = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));

const manifest = json("manifest.json");
const index = json("index.json");
// The tour: one place per step, each shown zoomed to its province with its panel open (the real app's
// selection), chosen from this data version by src/embed/tour-select.ts (its header states the rule).
// Step 0 is the densest province: the first paint and the reduced-motion still.
const fileOf = (p) => json(`lgu/${p}.json`);
const chosen = chooseTour(index, (p) => fileOf(p).years.find((y) => y.year === YEAR));
const TOUR = chosen.tour;
const VIEW = { year: YEAR, lgu: chosen.still };
for (const [i, c] of chosen.picks.entries())
  console.log(`tour ${i}: ${c.pcode} ${c.name}, ${c.province}: ${c.official} % official; ${c.places} places, ${c.low}–${c.highest} %, ${c.solid} solid`);
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

// tiles-attrs.csv, only the frozen year's value, tier and source (what the map and the comparisons read; from data
// v4 on the tiles carry geometry and pcode only, so the tier, which draws the hatching, comes from here too).
const yy = String(YEAR % 100).padStart(2, "0");
const csv = readFileSync(join(dir, "tiles-attrs.csv"), "utf8").trim().split(/\r?\n/);
const head = csv[0].split(",");
const vi = head.indexOf(`v${yy}`) - 2;
const ti = head.indexOf(`t${yy}`) - 2;
const si = head.indexOf(`s${yy}`) - 2;
const attrs = [ti >= 0 ? `pcode,n,v${yy},t${yy},s${yy}` : `pcode,n,v${yy},s${yy}`];
for (const line of csv.slice(1)) {
  const m = /^([^,]+),("(?:[^"]|"")*"|[^,]*),(.*)$/.exec(line);
  if (!m) continue;
  const cells = m[3].split(",");
  attrs.push(ti >= 0 ? `${m[1]},,${cells[vi]},${cells[ti]},${cells[si]}` : `${m[1]},,${cells[vi]},${cells[si]}`);
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
// Douglas-Peucker on one quantised ring or line, in tile units (its ends stay; a closed ring stays closed).
function simplify(pts, tol) {
  if (!tol || pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i];
    const b = pts[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k];
      // Distance to the segment's line, or to its start when the segment is a point (a closed ring's ends).
      const d = len ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len : Math.hypot(p.x - a.x, p.y - a.y);
      if (d > best) [best, at] = [d, k];
    }
    if (best > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
function slim(buf, rects, extent = EXTENT, tol = 0) {
  const layers = {};
  for (const [name, l] of Object.entries(new VectorTile(new PbfReader(buf)).layers)) {
    const q = extent / l.extent;
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
        out.splice(0, out.length, ...simplify(out, tol));
        // Polygons need 4 points (closed) to keep an area; lines need 2.
        if (out.length >= (f.type === 3 ? 4 : f.type === 2 ? 2 : 1)) geometry.push(out);
      }
      if (!geometry.length) continue;
      const properties = Object.fromEntries(Object.entries(f.properties).filter(([key]) => KEEP.has(key)));
      feats.push({ id: f.id, type: f.type, properties, geometry, loadGeometry: () => geometry });
    }
    layers[name] = { version: 2, name, extent, length: feats.length, feature: (i) => feats[i] };
  }
  return fromVectorTileJs({ layers });
}

const M = 24; // px of margin, against rounding
/** The packed tiles for these map boxes ([w, h] in CSS px) and padding, each slimmed to the views that use it. */
function tilesFor(views, pad, zooms, extent = EXTENT, tolPx = 0) {
  const need = new Map(); // "z/x/y" -> province -> its views' rectangle in that tile, as fractions of the tile
  const widest = new Map(); // "z/x/y" -> the widest it is drawn, in CSS px
  for (const province of provinces) {
    const [w, s, e, n] = province.bbox;
    const zs = new Set();
    for (const [W, H] of views) {
      const zoom = Math.min(MAX_ZOOM, Math.log2(Math.min((W - 2 * pad) / (mx(e) - mx(w)), (H - 2 * pad) / (my(s) - my(n)))));
      const z = Math.min(SOURCE_MAXZOOM, Math.floor(zoom));
      zs.add(z);
      const k = 2 ** zoom;
      const cx = ((mx(w) + mx(e)) / 2) * k;
      const cy = ((my(n) + my(s)) / 2) * k;
      const ts = (512 / 2 ** z) * k; // one tile in frame px
      const [L, T, R, B] = [cx - W / 2 - M, cy - H / 2 - M, cx + W / 2 + M, cy + H / 2 + M].map((v) => v / ts);
      for (let x = Math.floor(L); x <= Math.floor(R); x++)
        for (let y = Math.floor(T); y <= Math.floor(B); y++) {
          const key = `${z}/${x}/${y}`;
          if (!need.has(key)) need.set(key, new Map());
          widest.set(key, Math.max(widest.get(key) ?? 0, ts));
          // One rectangle per province and tile: the bounding box of its views there (thousands of near-identical views).
          const r = [L - x, T - y, R - x, B - y];
          const a = need.get(key).get(province.pcode);
          need.get(key).set(province.pcode, a ? [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])] : r);
        }
    }
    zooms.push(`${province.name} z${[...zs].sort((a, b) => a - b).join("-")}`);
  }
  const tiles = {};
  for (const [key, rects] of need) {
    const f = join(dir, "tiles", `${key}.pbf`);
    if (existsSync(f)) tiles[key] = Buffer.from(slim(readFileSync(f), [...rects.values()], extent, (tolPx * extent) / widest.get(key))).toString("base64");
  }
  return tiles;
}

// The index without the label points (x, y): nothing in the frozen view reads them.
const slimIndex = { ...index, lgus: index.lgus.map(({ x: _x, y: _y, ...l }) => l) };
const outDir = join(web, "public/embed-data");
mkdirSync(outDir, { recursive: true });
const written = [];
// The compact layout has no search, province list or national line: its index keeps only the packed provinces' LGUs.
const packed = new Set(provinces.map((p) => p.pcode));
const compactIndex = { ...slimIndex, lgus: slimIndex.lgus.filter((l) => packed.has(l.pv)) };
function writePack(prefix, tiles, zooms, idx = slimIndex) {
  const pack = { version: manifest.version, view: VIEW, tour: TOUR, manifest, index: idx, lgus, attrs: attrs.join("\n") + "\n", tiles };
  const body = JSON.stringify(pack);
  const name = `${prefix}-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
  writeFileSync(join(outDir, name), body);
  written.push(name);
  console.log(`${name}: ${(body.length / 1024).toFixed(0)} kB, ${Object.keys(tiles).length} tiles (${zooms.join(", ")}), ${Object.keys(lgus).length} LGU files, data ${manifest.version}`);
  return name;
}
const desktopZooms = [];
const name = writePack("lights", tilesFor([[MAP_W, MAP_H]], PAD, desktopZooms), desktopZooms);
// Phones draw the tiles at most about 600 CSS px wide: half the precision (512 units a tile) is still about a CSS px.
const smallZooms = [];
const smallName = writePack("lights-small", tilesFor(compactViews(300, SMALL_MAX_W), COMPACT_PAD, smallZooms, 512, Number(process.env.TOL ?? 1.5)), smallZooms, compactIndex);
const mediumZooms = [];
const mediumName = writePack("lights-medium", tilesFor(compactViews(SMALL_MAX_W + 1, COMPACT_MAX_W), COMPACT_PAD, mediumZooms), mediumZooms, compactIndex);
for (const f of readdirSync(outDir)) if (/^lights-((small|medium|compact)-)?[0-9a-f]+\.json$/.test(f) && !written.includes(f)) rmSync(join(outDir, f));

writeFileSync(
  join(web, "src/embed/pack.gen.ts"),
  `// Written by scripts/build-embed.mjs from data ${manifest.version}; do not edit.\nexport const PACK_URL = "/embed-data/${name}";\nexport const PACK_URL_SMALL = "/embed-data/${smallName}";\nexport const PACK_URL_MEDIUM = "/embed-data/${mediumName}";\nexport const VIEW = ${JSON.stringify(VIEW)} as const;\nexport const TOUR = ${JSON.stringify(TOUR)} as const;\nexport const STILL = ${JSON.stringify(chosen.still)};\n`,
);
const html = join(web, "embed.html");
// Each layout preloads only its own pack (the media queries are src/embed/layout.ts's).
const preload = (href, media) => `<link rel="preload" href="/embed-data/${href}" as="fetch" crossorigin="anonymous" media="${media}" />`;
writeFileSync(
  html,
  readFileSync(html, "utf8").replace(
    /(<!-- embed-pack[^>]*-->)[\s\S]*?(\s*<!-- \/embed-pack -->)/,
    [
      "$1",
      preload(name, `(min-width: ${COMPACT_MAX_W + 1}px)`),
      preload(mediumName, `(min-width: ${SMALL_MAX_W + 1}px) and (max-width: ${COMPACT_MAX_W}px)`),
      preload(smallName, `(max-width: ${SMALL_MAX_W}px)`),
    ].join("\n    ") + "$2",
  ),
);
