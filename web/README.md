# LGU Lights web app

Static single-page app (Vite + React 19 + TypeScript + Tailwind v4 + `@abrycta/akari` + MapLibre GL 6).
No backend: it reads the static read models written by `lgu materialise` and runs the what-if model
(`crates/lgu-wasm`) in a Web Worker.

## Develop

```sh
cp .npmrc.example .npmrc                  # once; installs @abrycta/akari from GitHub Packages
export NODE_AUTH_TOKEN=$(gh auth token)   # read:packages
npm install
scripts/link-data.sh ../data/build/dist/v0   # data version -> public/data/v0/ + public/data/latest.json
scripts/build-wasm.sh                        # crates/lgu-wasm -> public/wasm/lgu_wasm.wasm
npm run dev
```

On the fanless dev laptop run npm/cargo under `taskpolicy -b`. `public/data/` and `public/wasm/` are
gitignored. `link-data.sh <dir> [version] [--copy]` symlinks by default; `--copy` copies only the files
the app reads (for a deploy artifact).

```sh
npm run typecheck
npm test          # vitest: narrative, honesty styling, WASM wrapper (real module + data when linked)
npm run build     # dist/ for Cloudflare Pages (public/_headers sets caching and the CSP)
```

## Data contract

`/data/latest.json` → `{"version","base"}`; everything else is read from that immutable version folder:
`manifest.json`, `index.json`, `metrics.json`, `lgu/<pcode>.json`, `tiles/{z}/{x}/{y}.pbf` (uncompressed
MVT, layers `lgu` and `prov`, per-year `v/t/s` properties), `whatif/snapshot.bin` + `whatif/model.json`.
Missing tiles (open sea) come back from Pages as the SPA's `index.html`; the `lgutile://` protocol in
`src/map/MapView.tsx` turns that (or a 404) into an empty tile.

## What's where

| Path | What |
| --- | --- |
| `src/app/` | `App` (AkariProvider, shared krtmtthw.dev theme cookie), `Shell` (header: title, nav, EN/JA, theme, contrast; footer with data version, generated date, data and app commits, data-as-of), `url.ts` (URL state) |
| `src/data/` | contract types and cached fetchers (`use()`-friendly promises) |
| `src/lib/honesty.ts` | the official-vs-model and tier styling decisions, class breaks, labels |
| `src/lib/narrative.ts` | caption-first EN/JA sentence templates (always value + interval + tier + source) |
| `src/map/` | lazy MapLibre chunk: style expressions per year, hatch patterns, interactions |
| `src/features/` | year control, legend, LGU search (combobox), province picker, sortable province table |
| `src/panel/` | LGU detail: series chart, per-year table, what-if |
| `src/whatif/` | WASM wrapper (`wasm.ts`, pure), Web Worker, main-thread client |
| `src/pages/` | map page, about/method page (sources, honesty statement, validation headline) |

**URL state** (no router library): `/` and `/about`; `?year=2024&prov=PH07022&lgu=PH0702217&lang=ja`.
Selections push history entries (Back works), the year slider replaces the current one. Cloudflare
Pages serves `index.html` for `/about` (SPA fallback, no top-level `404.html`).

**Honesty rules in the UI:** model estimates are lighter on the map (fill opacity), italic in tables,
labelled "Model estimate (year)" and dashed in the chart; "use with caution" and "unreliable" tiers are
hatched; every narrative sentence states the interval and tier; backtest years show what the model would
have said without that round; what-if results are labelled "Hypothetical scenario", have the widened
interval and are never drawn on the main map. A `v0`/synthetic data version shows a banner.
