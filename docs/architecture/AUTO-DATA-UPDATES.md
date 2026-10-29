# Automatic data updates (chosen 2026-10-29)

Kurt chose fully automatic data updates (DECISIONS.md, 2026-10-29): when NASA publishes a newer Black Marble year,
CI runs the pipeline, validates the result and publishes only if every check passes. Otherwise the live version stays
and an issue in the private archive repo records the failure. Nothing public changes except the data itself: no
notice, label or copy change (memory note "no public-perception content").

## Trigger

- `freshness.yml`, monthly (3rd, 01:17 UTC), as before. The last year is now read from the **live** version
  (`latest.json` → `manifest.json` years), so a published update is not found again next month.
- A new Black Marble year (all five PH tiles of VNP46A4, or VJ146A4 from 2026, in CMR) starts the update.
- New FIES years and check errors stay issues for a person (adopting a PSA table needs a reviewed pin); new SAE
  rounds and PSGC quarters are not checked (PSA's Cloudflare challenge), as before.

## Run

`freshness.yml` calls `data.yml` (`workflow_call`), the same jobs as a manual run:

- version `v<N+1>` after the newest `data-v<N>` release; years `<first live year>-<new year>`;
- features rebuilt, canary on (the new year's whole satellite path first; the full run starts only if it passes);
- `vj113a1: false`: VJ113A1 only for the years MOD13Q1 leaves incomplete (Terra's end, Option A, silent);
- `accept_metrics: false`, so the metrics gate against the latest published version applies;
- a `features-v<N+1>` left by a failed earlier attempt is replaced (`overwrite`, kept as `-prev`).

## Validation gates (all must pass before the data release exists)

1. The existing gates: feature-store gates (canary year and full store), metrics gate (`gate_metrics` in
   `pipeline/lgu/train.py`), Rust parity gate (1e-5), read-model build, manifest version check.
2. `scripts/data-gates.py`, new, against the live version's read models (in `data.yml`'s model job, before the
   release step; thresholds in the script's docstring, calibrated on v3 → v4 → v5):
   - files and schema: every file the app reads; manifest, `tiles-attrs.csv` and per-LGU document keys are a superset;
   - years: every live year kept, contiguous, ending at the new year;
   - LGU count: no LGU dropped from the manifest, `index.json`, `lgu/*.json` or `tiles-attrs.csv`;
   - coverage: each live year keeps its shown values (−1 % of LGUs at most); the new year reaches the live minimum;
   - value ranges: every value in [0, 100]; official PSA values unchanged; model values of live years move by a median
     ≤ 3 pp and a p95 ≤ 12 pp, overall and per year (v4 → v5 moved 0.3 / 1.2); the new year's median within 6 pp of
     the year before;
   - tiles ≥ 95 % of live; the what-if model and snapshot exist.
3. The site must serve what a deploy would serve (no stacking on an unfinished deploy).

## Publish (the existing path, never v0)

1. `data.yml` publishes `data-v<N+1>` through `scripts/swap-release.sh` (draft first, atomic), only after the gates.
2. `freshness.yml` adds the gate report as the asset `auto-validated.json` to that release.
3. It runs `web.yml` on main (`workflow_dispatch`, the one event the workflow token may start). The deploy job
   ships main's newest covered commit through `scripts/deploy-web.sh`, which serves the committed list
   (`v1 v3 v4 v5`) **plus the newest two auto-validated versions after LATEST**, the newest as LATEST. Without such a
   release the deploy is unchanged (tested in `pipeline/tests/test_deploy_web.py`). Two at most keeps the deploy under
   Cloudflare Pages' 20,000 files (about 2,400 per version).
4. It checks that the live `latest.json` names `v<N+1>`.

No commit is made by CI: the version list lives in the releases, so main and its CI stay untouched.

## Rollback and failure handling

- Any gate fails: no data release is created; the live version is untouched; issue "Automatic data update failed
  for lgu-lights" (one, deduplicated; later failures comment). The next monthly run tries again.
- The deploy or the live check fails: the mark is removed, and if the site already moved, `web.yml` is run again to
  serve the previous version; same issue.
- Manual rollback: delete the `auto-validated.json` asset of the release and run `web.yml` on main.
- A successful update closes the open failure issue with a comment.

## Rehearsal (rule 18)

`freshness.yml` → mode `dry-run`, `force` on: the whole path with the live years, with every gate; the feature store
and read models become run artifacts; no release, no mark, no deploy. `features` off reuses the newest feature store
(a quick rehearsal without Earth Engine or LAADS).

## Cost and quotas

- Actions minutes: public repository, so standard runners are free. Measured: canary about 4 min, feature store
  10–16 min, model 3–5 min, deploy about 3 min (`web.yml` on main); the monthly check about 2 min.
- Earth Engine (noncommercial Community tier) and Earthdata/LAADS: one full feature-store run per new Black Marble
  year (about once a year), the same work as a manual run; the monthly check reads CMR and OpenSTAT metadata only.
- No new secrets, settings or credentials: `EE_SERVICE_ACCOUNT_KEY`, `EARTHDATA_*`, `ARCHIVE_READ_TOKEN`,
  `CLOUDFLARE_*` and the workflow token, as today.
- The schedules stay enabled: `keepalive.sh` runs hourly (`live-check.yml`) and monthly (`freshness.yml`) and
  re-enables every workflow with a cron.

## Limits

- The Earthdata login mints short-lived tokens in CI; the 60-day `EARTHDATA_TOKEN` is only a fallback.
- A new SAE round, a new FIES year or a boundary change still needs a person (an issue says so).
