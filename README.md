# Lights

Lights estimates poverty incidence for every Philippine city and municipality (1,600+) for 2012–2025, from VIIRS night lights and MODIS/NOAA-20 vegetation indices, and compares each estimate with the Philippine Statistics Authority's official Small Area Estimates (2012, 2015, 2018, 2021, 2023).

It extends the regional GRU study in [a paper the author co-wrote](https://link.springer.com/chapter/10.1007/978-3-032-23515-2_43) to the municipal level. A LightGBM model starts from the last PSA round and estimates how each place moved within its province; every estimate has split-conformal 50 % and 90 % intervals. One Rust core computes the numbers in CI and, compiled to WebAssembly, in the browser, matching the trained model to within 3.7e-14.

Live at **https://lights.krtmtthw.dev** (English and Japanese).

**Status (2026-10-21):** milestone 1 is live with data version v1: PSA official figures for 2012, 2015, 2018, 2021 and 2023, model estimates for the years between and after (2012–2025) with 90 % intervals and reliability tiers, a plain-language reading for each place, and an in-browser what-if. The model's validation against a carry-forward baseline (carrying the last official figure forward) is in [docs/DECISIONS.md](docs/DECISIONS.md) and on the site's About page. The next model version is in progress.

## How it works

| Path | What it is |
|---|---|
| `pipeline/` | Python (uv): fetches every source through the registry in `pipeline/sources.yaml`, builds labels and the crosswalk, runs Earth Engine and Black Marble zonal statistics, trains the model |
| `crates/` | Rust core (`lgu-core`) with a CLI (`lgu design`, `lgu parity`, `lgu materialise`) and a WASM build for the browser's what-if |
| `web/` | Static single-page app (Vite, React, Akari, MapLibre) on Cloudflare Pages; see [web/README.md](web/README.md) |
| `.github/workflows/` | `pipeline.yml`, `rust.yml`, `web.yml` (checks), `data.yml` (the full data run), `freshness.yml` (monthly check for a new Black Marble year, which starts an automatic update) and `live-check.yml` (hourly check that the live site serves main's newest deployed commit) |

Code layout and data flow: [docs/architecture/README.md](docs/architecture/README.md).

## Running it

The full data run happens in GitHub Actions only (`data.yml`); it needs Earth Engine and NASA Earthdata credentials. The web app depends on `@abrycta/akari` and the pipeline on `archivekit`, both private packages, so installing needs access to them. Locally:

```sh
# Web app against a published data version
gh release download data-v5 -R abrycta/lgu-lights -p 'read-models-v5.tar.zst' -D /tmp/lights
tar --zstd -xf /tmp/lights/read-models-v5.tar.zst -C /tmp/lights
cd web
cp .npmrc.example .npmrc && export NODE_AUTH_TOKEN=$(gh auth token)       # @abrycta/akari from GitHub Packages
npm install
scripts/link-data.sh /tmp/lights/v5 v5
scripts/build-wasm.sh
npm run dev

# Checks
cd web && npm run typecheck && npm run lint && npm test
cargo test -p lgu-core
cd pipeline && uv sync --group sources --group train && uv run pytest -q
```

## Documents

| Document | What it holds |
|---|---|
| [docs/PAPER-NOTES.md](docs/PAPER-NOTES.md) | Faithful notes on the baseline paper: data, GRU design, validation, results, limitations, and what Lights keeps or changes |
| [docs/ARCHITECTURE-RESEARCH.md](docs/ARCHITECTURE-RESEARCH.md) | Three candidate architectures with diagrams, sources and the recommendation |
| [docs/MODELING-PLAN.md](docs/MODELING-PLAN.md) | The paper as baseline, the improved models (Fay-Herriot, gradient boosting, GRU/TCN), features, forward-chaining validation, metrics, conformal intervals, reporting |
| [docs/DATA-PLAN.md](docs/DATA-PLAN.md) | Sources, licences, volumes, zonal-statistics tooling, feature store, versioning, update cadence, and the `archivekit` registry draft |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | The questions put before the build, with the defaults later decided in DECISIONS.md |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Binding decisions, spike addendum, and milestone build notes |
| [docs/architecture/README.md](docs/architecture/README.md) | Repository layout, data flow, read-model contract, commands |

Every external source is listed in `pipeline/sources.yaml`, with automatic fallback to mirrors and then to a private snapshot archive (`abrycta/lgu-lights-archive`, managed by `archivekit`); only processed data is published, with each source's attribution.
