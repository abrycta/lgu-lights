# Decisions

Decided 2026-10-21 by Kurt, after `ARCHITECTURE-RESEARCH.md`, `MODELING-PLAN.md`, `DATA-PLAN.md` and `OPEN-QUESTIONS.md`.

| # | Area | Decision |
|---|---|---|
| Q1 | Architecture | **B: hexagonal (ports and adapters) Rust core + CQRS-style materialised read models + Jamstack delivery + a Rust Cloudflare Worker API** (workers-rs + axum). Built as A first (static + browser WASM); the Worker is the third driving adapter. |
| Q2 | Rust scope | **Rust for everything that runs or is deployed** (core, CLI, WASM, Worker). **Python (and R for Fay-Herriot) allowed for offline training and Earth Engine access** in GitHub Actions; the Rust core executes the trained weights. |
| Q3 | Satellite processing | **Register Google Earth Engine now** (individual noncommercial, Community tier). Service-account key as a GitHub secret. exactextract in Actions stays as the cross-check. |
| Q4 | Label rounds | **VIIRS era 2012–2023 for models**; 2006/2009 shown as history only. |
| Q5 | Tiles and large files | **GitHub Pages primary, Hugging Face fallback; no R2.** |
| Q6 | Domain | **lgu.krtmtthw.dev** (Porkbun CNAME → Cloudflare Pages). API at **lgu-api.krtmtthw.dev** unless the zone moves to Cloudflare. |
| Q8 | Languages | **English + Japanese. No Filipino** (UI, narration or data labels). |
| Q7 | Narration | **Captions first**; browser speech where a voice exists; Kokoro-82M pre-rendered clips for EN/JA intros; **no MMS-TTS**. |
| Q10 | Before building | **1-day measurement spike first**; every `[U]` estimate is replaced by a measurement, and this file gets an addendum with the results. |
| Q9, Q11–Q15 | Defaults | Accepted as documented in OPEN-QUESTIONS.md (CV 10/20 % reliability tiers; what-if sliders labelled hypothetical; archivekit format proposals; proceed with PSA attribution and email PSA in parallel; no OSM covariates in the headline model; Zenodo DOI per data release). |

## Update 2026-10-21: single Rust implementation

Asked whether LGU Lights should also have multiple backends like Typhoon Replay: **no**. Keep one Rust core (Architecture B as decided above: CLI + browser WASM + Cloudflare Worker). No per-language reimplementations (they would break bit-identical numbers) and no language bindings (PyO3, Panama, etc.) for now. Bindings remain a possible later addition without changing the architecture.
