# LGU Lights

A nowcast and forecast map of poverty incidence for every Philippine city and municipality (about 1,640 LGUs), driven by VIIRS nighttime lights and MODIS/VIIRS vegetation indices, aligned with and honestly compared against the Philippine Statistics Authority's official Small Area Estimates (2012, 2015, 2018, 2021, 2023). It turns the GRU-based regional model from the authors' paper into a municipal-level product with calibrated intervals, a story-first 3D map, and a Rust core that runs the same maths in CI, in the browser and at the edge.

Status: **milestone 1 in progress** (branch `m1`, 2026-10-21): first end-to-end slice — Rust core with CLI and WASM adapters, archivekit-backed pipeline, Earth Engine and Black Marble zonal statistics in GitHub Actions, LightGBM model with forward-chaining validation and a Rust parity gate, static read models and vector tiles, and a local-preview web app. Code layout and data flow: [docs/architecture/README.md](docs/architecture/README.md). Not deployed.

## Documents

| Document | What it holds |
|---|---|
| [docs/PAPER-NOTES.md](docs/PAPER-NOTES.md) | Faithful notes on the baseline paper: data, GRU design, validation, results, limitations, and what LGU Lights keeps or changes |
| [docs/ARCHITECTURE-RESEARCH.md](docs/ARCHITECTURE-RESEARCH.md) | Options, numbers and sources for accuracy, data/ETL, the Rust backend (hexagonal core + materialised read models + edge API), the front end and accuracy-related UX; three complete architectures with diagrams and the recommendation |
| [docs/MODELING-PLAN.md](docs/MODELING-PLAN.md) | The paper as baseline, the improved models (Fay-Herriot, gradient boosting, GRU/TCN), features, forward-chaining validation, metrics, conformal intervals, reporting |
| [docs/DATA-PLAN.md](docs/DATA-PLAN.md) | Sources, licences, volumes, zonal-statistics tooling, feature store, versioning, update cadence, and the `archivekit` registry draft |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decisions for Kurt and facts still to verify by hand |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Binding decisions, spike addendum, and milestone build notes |
| [docs/architecture/README.md](docs/architecture/README.md) | Repository layout, data flow, read-model contract, commands |

Shared standards live in the portfolio root (`../CLAUDE.md`, `../DATA-ARCHIVING.md`); the design system is Akari; external data goes through `archivekit`.
