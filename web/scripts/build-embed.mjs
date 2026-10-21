#!/usr/bin/env node
// Packs the frozen /embed view (src/embed) into ONE immutable file from a materialised data version:
//   node scripts/build-embed.mjs [data-dir]      (default: public/data, following its latest.json)
// Writes public/embed-data/lights-<hash>.json (manifest, index, the province's LGU files, the year's
// national values and the vector tiles under the view), src/embed/pack.gen.ts (its URL and the view)
// and the preload link in embed.html. All three are committed; re-run after a data release.
// There is no basemap image: Lights draws no basemap (its ground is the theme's background colour).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VectorTile } from "@mapbox/vector-tile";
import { fromVectorTileJs } from "@maplibre/vt-pbf";
import { PbfReader } from "pbf";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEW = { year: 2023, lgu: "PH1705101" };
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
const prov = VIEW.lgu.slice(0, 7);
const province = index.provinces.find((p) => p.pcode === prov);
if (!province) throw new Error(`no province ${prov}`);
const lgus = Object.fromEntries(index.lgus.filter((l) => l.pv === prov).map((l) => [l.p, json(`lgu/${l.p}.json`)]));
if (!lgus[VIEW.lgu]) throw new Error(`no LGU ${VIEW.lgu}`);

// tiles-attrs.csv, only the frozen year's value and source (what the comparisons read).
const yy = String(VIEW.year % 100).padStart(2, "0");
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

// Which tiles the view needs: MapLibre's fitBounds (512 px tiles), then the covering tiles at floor(zoom).
const mx = (lon) => ((lon + 180) / 360) * 512;
const my = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * 512;
const [w, s, e, n] = province.bbox;
const zoom = Math.min(MAX_ZOOM, Math.log2(Math.min((MAP_W - 2 * PAD) / (mx(e) - mx(w)), (MAP_H - 2 * PAD) / (my(s) - my(n)))));
const z = Math.min(SOURCE_MAXZOOM, Math.floor(zoom));
const k = 2 ** zoom;
const cx = ((mx(w) + mx(e)) / 2) * k;
const cy = ((my(n) + my(s)) / 2) * k;
const tile = (px) => Math.floor(px / k / (512 / 2 ** z));
// Each tile keeps its geometry but only the frozen year's properties (v/t/s<yy>) and the pcode.
const KEEP = new Set(["pcode", `v${yy}`, `t${yy}`, `s${yy}`]);
function slim(buf) {
  const layers = {};
  for (const [name, l] of Object.entries(new VectorTile(new PbfReader(buf)).layers)) {
    const feats = [];
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      const geometry = f.loadGeometry();
      const properties = Object.fromEntries(Object.entries(f.properties).filter(([key]) => KEEP.has(key)));
      feats.push({ id: f.id, type: f.type, properties, geometry, loadGeometry: () => geometry });
    }
    layers[name] = { version: 2, name, extent: l.extent, length: feats.length, feature: (i) => feats[i] };
  }
  return fromVectorTileJs({ layers });
}

const M = 24; // px of margin, against rounding
const tiles = {};
for (let x = tile(cx - MAP_W / 2 - M); x <= tile(cx + MAP_W / 2 + M); x++)
  for (let y = tile(cy - MAP_H / 2 - M); y <= tile(cy + MAP_H / 2 + M); y++) {
    const f = join(dir, "tiles", String(z), String(x), `${y}.pbf`);
    if (existsSync(f)) tiles[`${z}/${x}/${y}`] = Buffer.from(slim(readFileSync(f))).toString("base64");
  }

// The index without the label points (x, y): nothing in the frozen view reads them.
const slimIndex = { ...index, lgus: index.lgus.map(({ x: _x, y: _y, ...l }) => l) };
const pack = { version: manifest.version, view: VIEW, manifest, index: slimIndex, lgus, attrs: attrs.join("\n") + "\n", tiles };
const body = JSON.stringify(pack);
const name = `lights-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.json`;
const outDir = join(web, "public/embed-data");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^lights-[0-9a-f]+\.json$/.test(f) && f !== name) rmSync(join(outDir, f));
writeFileSync(join(outDir, name), body);

writeFileSync(
  join(web, "src/embed/pack.gen.ts"),
  `// Written by scripts/build-embed.mjs from data ${manifest.version}; do not edit.\nexport const PACK_URL = "/embed-data/${name}";\nexport const VIEW = ${JSON.stringify(VIEW)} as const;\n`,
);
const html = join(web, "embed.html");
writeFileSync(
  html,
  readFileSync(html, "utf8").replace(/(<!-- embed-pack[^>]*-->\s*<link rel="preload" href=")[^"]*(")/, `$1/embed-data/${name}$2`),
);
console.log(`${name}: ${(body.length / 1024).toFixed(0)} kB, ${Object.keys(tiles).length} tiles at z${z} (zoom ${zoom.toFixed(2)}), ${Object.keys(lgus).length} LGU files, data ${manifest.version}`);
