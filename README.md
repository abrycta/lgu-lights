# Lights

A nowcast and forecast map of poverty incidence for every Philippine city and municipality (about 1,640 LGUs), driven by VIIRS nighttime lights and MODIS/VIIRS vegetation indices, aligned with and honestly compared against the Philippine Statistics Authority's official Small Area Estimates (2012, 2015, 2018, 2021, 2023). It turns the GRU-based regional model from the authors' paper into a municipal-level product with calibrated intervals, a story-first 3D map, and a Rust core that runs the same maths in CI, in the browser and at the edge.

Live at **https://lights.krtmtthw.dev** (English and Japanese).

**Status (2026-10-21):** milestone 1 is live with data version v1: PSA official figures for 2012, 2015, 2018, 2021 and 2023, model estimates for the years between and after (2012–2025) with 90 % intervals and reliability tiers, a plain-language reading for each place, and an in-browser what-if. The model's validation, including where it does no better than carrying the last official figure forward, is in [docs/DECISIONS.md](docs/DECISIONS.md) and on the site's About page. The next model version is in progress.

## How it works

| Path | What it is |
|---|---|
| `pipeline/` | Python (uv): fetches every source through the registry in `pipeline/sources.yaml`, builds labels and the crosswalk, runs Earth Engine and Black Marble zonal statistics, trains the model |
| `crates/` | Rust core (`lgu-core`) with a CLI (`lgu design`, `lgu parity`, `lgu materialise`) and a WASM build for the browser's what-if |
| `web/` | Static single-page app (Vite, React, Akari, MapLibre) on Cloudflare Pages; see [web/README.md](web/README.md) |
| `.github/workflows/` | `pipeline.yml`, `rust.yml`, `web.yml` (checks) and `data.yml` (the full data run) |

Code layout and data flow: [docs/architecture/README.md](docs/architecture/README.md).

## Running it

The full data run happens in GitHub Actions only (`data.yml`); it needs Earth Engine and NASA Earthdata credentials. Locally:

```sh
# Web app against a published data version
gh release download data-v1 -R abrycta/lgu-lights -p 'read-models-v1.tar.zst'   # unpack it, then:
cd web
cp .npmrc.example .npmrc && export NODE_AUTH_TOKEN=$(gh auth token)       # @abrycta/akari from GitHub Packages
npm install
scripts/link-data.sh <unpacked>/v1 v1
scripts/build-wasm.sh
npm run dev

# Checks
cd web && npm run typecheck && npm run lint && npm test
cargo test -p lgu-core
cd pipeline && uv sync --group sources --group train && uv run pytest -q
```

`@abrycta/akari` (the design system) and `archivekit` (the data-archiving kit) are private packages, so a fresh clone without access cannot install them.

## Documents

| Document | What it holds |
|---|---|
| [docs/PAPER-NOTES.md](docs/PAPER-NOTES.md) | Faithful notes on the baseline paper: data, GRU design, validation, results, limitations, and what Lights keeps or changes |
| [docs/ARCHITECTURE-RESEARCH.md](docs/ARCHITECTURE-RESEARCH.md) | Options, numbers and sources for accuracy, data/ETL, the Rust backend (hexagonal core + materialised read models + edge API), the front end and accuracy-related UX; three complete architectures with diagrams and the recommendation |
| [docs/MODELING-PLAN.md](docs/MODELING-PLAN.md) | The paper as baseline, the improved models (Fay-Herriot, gradient boosting, GRU/TCN), features, forward-chaining validation, metrics, conformal intervals, reporting |
| [docs/DATA-PLAN.md](docs/DATA-PLAN.md) | Sources, licences, volumes, zonal-statistics tooling, feature store, versioning, update cadence, and the `archivekit` registry draft |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Open decisions and facts still to verify by hand |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Binding decisions, spike addendum, and milestone build notes |
| [docs/architecture/README.md](docs/architecture/README.md) | Repository layout, data flow, read-model contract, commands |

Every external source is listed in `pipeline/sources.yaml`, with automatic fallback to mirrors and then to a private snapshot archive (`abrycta/lgu-lights-archive`, managed by `archivekit`); only processed data is published, with each source's attribution.
