# Modelling plan

Status: research and proposal, 2026-10-21. Nothing is trained yet. Every claim has a source; items marked **unverified** could not be confirmed on a primary page today (PSA's site sits behind a bot challenge, so PSA facts come from search snippets of PSA pages and PSA regional mirrors).

The plan answers one question honestly: **how much can nighttime lights and vegetation tell us about municipal poverty in the Philippines between and after PSA survey years, and how sure can we be?** The paper (see [PAPER-NOTES.md](PAPER-NOTES.md)) is the baseline. Everything else here exists to beat it on held-out survey years and to put calibrated intervals on every number the map shows.

## 0. Summary

| Item | Decision (proposed) |
|---|---|
| Target | PSA Small Area Estimates (SAE) of **poverty incidence among the population, city/municipal level**, for the VIIRS-era rounds **2012, 2015, 2018, 2021, 2023** (plus 2006/2009 as DMSP-era context only). PSA's published SE/CV per LGU is used, not ignored |
| Unit | LGU-year panel: about 1,610 LGUs × 5 label years ≈ 8,000 labelled rows; about 1,640 LGUs × 14 feature years for nowcasts |
| Baseline | The paper's model reproduced as written: 1 GRU layer, Adam 1e-3, batch 32, 100 epochs, random 80/20 split (reported for comparison only; its score is not an honest estimate of accuracy) |
| Candidate models | (1) linear mixed-effects panel; (2) **spatio-temporal Fay-Herriot** with PSA SE as the sampling variance; (3) **gradient boosting (LightGBM) on the panel with lagged features and LGU/province effects**; (4) the GRU/TCN family on annual sequences; (5) a stacked blend of 2 and 3 |
| Headline validation | **Forward-chaining leave-year-out**: train on rounds ≤ 2018 → predict 2021; train ≤ 2021 → predict 2023. Plus grouped spatial CV (province blocks) for the "new place" question, reported separately |
| Metrics | On the raw percentage-point scale: MAE, RMSE, R² for **levels** and for **changes between rounds**, Spearman ρ and top-decile hit rate (targeting), 90 % interval **coverage and width**, calibration slope. Compared against PSA's own CIs |
| Uncertainty | Model MSE (FH) or conformal intervals (split/CV+ for GBM, EnbPI-style for time), always reported alongside PSA's SE; a three-tier reliability flag (CV ≤ 10, 10–20, > 20 %) mirrors PSA |
| Reporting | A model card and a leaderboard table in `docs/` and on the methodology page: every number the map shows traces to one row of that table |

## 1. What the literature says we should expect (and must say on the site)

1. **Cross-sectional accuracy is good; change-over-time accuracy is poor.** Yeh et al. 2020 (Nature Communications) get r² ≈ 0.67 for levels across African villages but only **0.15–0.17 for changes over time** at village level (≈ 0.51 at district level), and **nightlights-only models predict temporal change with r² < 0.01** ([PMC7244551](https://pmc.ncbi.nlm.nih.gov/articles/PMC7244551/)). KidSat (2024) finds every model does worse on a temporal split (train < 2020, test 2020–22) than on a spatial split, e.g. MAE 0.184 → 0.286 ([arXiv 2407.05986](https://arxiv.org/html/2407.05986v1)). Pettersson et al. 2023 get R² 0.75 on held-out time spans only with multi-temporal imagery and a recurrent CNN ([IJCAI 2023](https://www.ijcai.org/proceedings/2023/0684.pdf)). Zheng et al. 2025/2026 (World Bank, Tempov) say prior approaches "degrade under temporal shift" ([PRWP 11058](https://ideas.repec.org/p/wbk/wbrwps/11058.html), [arXiv 2604.23166](https://arxiv.org/abs/2604.23166)).
   **Consequence:** LGU Lights reports level and change accuracy separately and expects the change number to be modest. The site must never imply that a 2024 nowcast is as reliable as a 2021 official figure.
2. **Lights saturate at the bottom.** Jean et al. 2016 note nightlights "cannot differentiate among economic levels in the most impoverished regions" ([arXiv 1510.00098](https://arxiv.org/abs/1510.00098)); Gibson et al. 2021 show DMSP is a poor proxy outside cities, with the VIIRS gap largest at low density ([JDE 149](https://ideas.repec.org/a/eee/deveco/v149y2021ics0304387820301772.html)); a World Bank note calls NTL "ill-suited for identifying variation in welfare within small areas" ([WB](https://thedocs.worldbank.org/en/doc/60741466181743796-0050022016/render/PovertyinHDdraftv2.75.pdf)). VIIRS is required (never DMSP) and dark rural LGUs need other covariates.
3. **PSA's own experiment is the sobering prior.** Adding EOG 2018 mean luminosity to PSA's 2018 municipal SAE regression raised adjusted R² from **55.09 % to 55.52 %** ([PSA at UNSD, Jan 2022](https://unstats.un.org/sdgs/files/meetings/sdg-inter-workshop-jan-2022/5.4-Use-of-Non-Traditional-Data-Sources-for-Philippine-SDG-Indicator-Monitoring-Philippines.pdf)). For the **2023 SAE** PSA says EOG nighttime lights were used "to enhance the reliability of local-level estimates" (**snippet-verified**: [PSA 2023 SAE page](https://psa.gov.ph/content/881-cities-and-municipalities-recorded-poverty-incidence-20-percent-or-lower-2023), [Bohol repost 2026-02-16](https://bohol.gov.ph/2026/02/16/more-bohol-towns-record-lower-poverty-incidence-in-2023-psa/)). That has two consequences: (a) lights are now partly *inside* the 2023 labels, so a lights→SAE model partly learns PSA's own covariate, which must be disclosed; (b) the project's honest claim is "lights plus vegetation **between and after** survey rounds", not "lights beat the census".
4. **Validation against model-based labels is itself noisy.** Corral, Henderson & Segovia (JDE 2025) show that validating ML maps against noisy survey/SAE estimates "can produce misleading model assessments" ([PRWP 10429](https://ideas.repec.org/p/wbk/wbrwps/10429.html)); Burke et al. 2021 warn that label noise in scarce data leads to incorrect performance assessment ([arXiv 2010.06988](https://arxiv.org/abs/2010.06988)). PSA SAE values carry published SEs, so the scoring must account for them (§5.4).
5. **Income targets are harder than asset targets.** Hall et al. 2023 find asset-index targets score about 17 pp higher R² than income/consumption targets ([J. Int. Dev. review](https://www.efdinitiative.org/publications/review-machine-learning-and-satellite-imagery-poverty-prediction-implications)). PSA SAE is income-based, so Philippine DHS-wealth results (Tingzon et al. 2019: R² 0.63 with OSM + VIIRS, [ISPRS](https://isprs-archives.copernicus.org/articles/XLII-4-W19/425/2019/); Thinking Machines/UNDP, now updated to DHS 2022 per [UNDP blog](https://www.undp.org/philippines/blog/data-innovation-sustainable-development), snippet-verified) are not directly comparable.
6. **Small tabular panels favour trees and random-effects models.** Grinsztajn et al. 2022 show tree ensembles remain state of the art at ~10k rows ([NeurIPS 2022](https://neurips.cc/virtual/2022/poster/55627)); Merfeld & Newhouse 2023 find XGBoost/Cubist beat linear EBP in seven census simulations with 94–97 % bootstrap coverage ([PRWP 10348](https://openknowledge.worldbank.org/handle/10986/39530)). The UNSD geospatial SAE primer (2025) accepts ML with proper validation and recommends VIIRS over DMSP ([UNSD primer](https://unstats.un.org/UNSDWebsite/statcom/session_56/documents/BG-3p-Geospatial_SAE_Primer-E.pdf)).

## 2. The target: PSA Small Area Estimates

| Round | Census base | Survey | Estimator | Units | Notes |
|---|---|---|---|---|---|
| 2006, 2009, 2012, 2015 | 2000/2010 CPH, 2015 POPCEN | FIES | ELL (World Bank) | ~1,600 | DMSP era except 2012/2015 (VIIRS begins 2012) |
| 2018 | 2015 POPCEN | FIES 2018 + Jan-2019 LFS | ELL | ~1,600 + 14 Manila sub-areas | highlights released 2021-12-15 (snippet) |
| 2021 | 2020 CPH | FIES 2021 + Jan-2022 LFS + 2021 ULE | **Census EB** | 14 Manila + 114 cities + 1,484 municipalities = **1,612** | EOG lights "explored" |
| 2023 | 2020 CPH | FIES 2023 + Jan-2024 LFS + 2023 ULE | **Census EB** | 14 + 114 + 1,483 = **1,611** | EOG lights used; presented 2026-02-16 |

Sources: [PSA SAE page](https://psa.gov.ph/statistics/poverty-sae) and [stat tables](https://psa.gov.ph/statistics/poverty-sae/stat-tables) (snippets), [2015 technical notes](https://psa.gov.ph/system/files/phdsd/Technical%20Notes%20on%202015%20SAE.pdf) (snippet), [2021 highlights PDF](https://www.psa.gov.ph/system/files/phdsd/Highlights%20of%20the%202021%20SAE.pdf). HUCs and the independent component cities Isabela and Cotabato are excluded from SAE (their figures come from FIES directly); Kalayaan was excluded in 2018. Columns published per LGU: estimate, SE, CV, CI. PSA's reliability language is CV-based: 1,527 LGUs had CV < 20 % in 2021 vs 1,440 in 2018 ([2021 highlights](https://www.psa.gov.ph/system/files/phdsd/Highlights%20of%20the%202021%20SAE.pdf)).

Facts to settle before training (tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)): whether the "2018 - 2021 SAE_with PSGC_noHUC.xlsx" file re-estimates 2018 with Census EB; the exact 2023 file name; why 2023 has one municipality fewer; how the eight 2024 BARMM SGA municipalities are handled.

**Comparability caveats the site must carry:** the ELL → Census EB break between 2018 and 2021, the census-base change (2015 POPCEN → 2020 CPH), and PSGC boundary changes (BARMM 2019, Maguindanao split 2022, eight SGA municipalities 2024; see DATA-PLAN.md). The modelling treats the two estimator eras with an explicit round indicator and reports accuracy per era.

## 3. Features (annual, per LGU; details and licences in DATA-PLAN.md)

Core (the paper's three, upgraded):
- Nighttime lights (VIIRS): mean and median masked radiance, sum of lights, lit-area fraction (> 0.5 nW·cm⁻²·sr⁻¹), Gini of pixel radiance within the LGU, radiance per capita (using WorldPop/CPH population), log transforms, year-over-year change, 3-year slope. Two sources are computed and compared: NOAA/EOG annual V2.2 and NASA Black Marble VNP46A4; the one with better held-out accuracy becomes primary and the other a robustness check.
- Vegetation (MODIS MOD13Q1 EVI/NDVI, 250 m): annual mean, dry/wet-season means, amplitude, trend, plus a VIIRS VNP13 continuity series for the post-Terra years.

Static or slowly varying context (optional, ablated):
- Population and density (CPH 2020 by LGU; WorldPop for intermediate years), GHSL built-up surface, Meta Relative Wealth Index (as a cross-sectional comparator, never a feature in the headline model, because it is itself a model output), distance to the provincial capital/region centre, island group, income class of the LGU (PSA/DOF classification), elevation and ruggedness, road density from OSM (licence: derived aggregates, see DATA-PLAN.md).

Panel structure: LGU identity, province, region, round indicator (ELL vs Census EB), year.

Every feature family is ablated: lights only → + vegetation → + static context, so the site can state how much each adds (mirroring PSA's 0.4-pp finding).

## 4. Models

### 4.1 Baseline: the paper, reproduced
- 1 GRU layer (hidden size to be chosen by validation since the paper does not state it; 32 as the default), Adam 1e-3, batch 32, 100 epochs, target normalised, inputs untouched, random 80/20 split, MAE/MSE/MAPE averaged per unit ([PAPER-NOTES.md](PAPER-NOTES.md) §4–5).
- Reported twice: (a) as written (random split) to show the number the paper's protocol produces, and (b) under the honest protocol of §5. The gap between (a) and (b) is itself a result worth showing.

### 4.2 Linear mixed-effects panel
Poverty_it = α + β·X_it + u_i (LGU random intercept) + γ_t + ε_it. Fast, transparent, decomposes within- vs between-LGU variance, and gives the "how much do lights explain *within* an LGU over time" number that the literature says is the hard part. Reference implementation: `statsmodels` MixedLM or R `lme4` (optional).

### 4.3 Spatio-temporal Fay-Herriot (area-level SAE)
The official-statistics framing. The direct estimate is PSA's SAE value with its published SE used as the known sampling variance (`vardir`), the covariates are the satellite features, with SAR(1) area effects and AR(1) time effects ([Marhuenda, Molina & Morales 2013; R `sae::eblupSTFH`](https://rdrr.io/cran/sae/man/eblupSTFH.html), bootstrap MSE via `pbmseSTFH`; R `emdi` 2.2.3 for transformations, [CRAN](https://cran.r-project.org/web/packages/emdi/index.html)). Python options are weaker: `samplics` is unmaintained and its successor `svy-sae` is young ([samplics](https://github.com/samplics-org/samplics), [svy-sae](https://svylab.com/docs/svy-sae/), feature set unverified). A measurement-error FH variant handles noisy satellite covariates ([arXiv 2608.09626](https://arxiv.org/abs/2608.09626)).
Caveat to state: PSA's SE is itself model-based (Census EB bootstrap), not design-based.
Implementation note: this is the one component that may justify R in the **training** pipeline (training is Python/R in GitHub Actions; the Rust-only rule applies to the backend and the served artefacts, not to offline research code; see OPEN-QUESTIONS.md Q4).

### 4.4 Gradient boosting on the panel (expected winner)
LightGBM with: current-year features, lags (t-1, t-3), slopes, the LGU's previous *official* value where available for nowcasting ("last-known-official" feature), province target encoding with leakage-safe folds, round indicator. Monotone constraints where justified (more radiance per capita → not higher poverty). Hyper-parameters tuned inside the forward-chaining folds only. A mixed-effects-boosting hybrid (tree on residuals of the random-effects model) follows Krennmair & Schmid 2022 as cited by the UNSD primer.

### 4.5 Sequence models: GRU and TCN on annual sequences
The paper's family, done properly: inputs are annual sequences 2012→t of standardised features (not Prophet-imputed monthly series); the target is only the survey-year value; one model across all LGUs with an LGU embedding. A temporal CNN (dilated causal convolutions, Bai et al. 2018, [arXiv 1803.01271](https://arxiv.org/abs/1803.01271), not re-verified today) is the comparison. With about 8,000 labelled rows these are expected to trail LightGBM; they are kept because the project's story starts with an RNN and because the GRU is what runs in the browser for what-if scenarios (its forward pass is a few dozen lines, see ARCHITECTURE-RESEARCH.md §3).

### 4.6 Blend
A simple weighted average of FH and LightGBM predictions, weights chosen on the 2021 fold and frozen before the 2023 fold.

## 5. Validation design

### 5.1 Headline: forward-chaining leave-year-out
| Fold | Train rounds | Test round | What it measures |
|---|---|---|---|
| F1 | 2012, 2015 | 2018 | sparse-history forecast (ELL era) |
| F2 | 2012, 2015, 2018 | 2021 | forecast across the estimator break |
| F3 | 2012 … 2021 | 2023 | the nowcast case the site actually serves |

The 2023 fold (F3) is the number quoted first on the site. Nowcasts for 2024/2025 cannot be validated until the next SAE round; the site says so in words, not footnotes (this is exactly the limitation the 2026 displacement study admits, [arXiv 2609.15773](https://arxiv.org/pdf/2609.15773)).

### 5.2 Secondary: grouped spatial CV
Province-level blocks (all rounds of a province held out together) answer "would this work for a place the model never saw?". Random CV grouped by LGU is also reported, because LGU Lights predicts all LGUs (a census of areas, which Wadoux et al. 2021 argue makes random CV defensible, [Ecol. Model. 457](https://ideas.repec.org/a/eee/ecomod/v457y2021ics0304380021002489.html)), against the spatial-CV position of Roberts et al. 2017 and Ploton et al. 2020 and the task-matched kNNDM approach of Linnenbrink et al. 2024 ([GMD 17](https://gmd.copernicus.org/articles/17/5897/2024/)). Both numbers are shown with their meaning.

### 5.3 Metrics (all on the raw percentage-point scale)
- Levels: MAE, RMSE, R², and **within-region R²** (Yeh et al. style) so between-region variance does not flatter the model.
- Changes: MAE and R² of predicted vs official change between consecutive rounds (expected to be low; shown anyway).
- Targeting: Spearman ρ; share of true top-decile (poorest) LGUs recovered in the predicted top decile; exclusion-error style metrics after Aiken et al. 2022 ([Nature 603](https://ideas.repec.org/a/nat/nature/v603y2022i7903d10.1038_s41586-022-04484-9.html)).
- Intervals: empirical coverage of 90 % intervals, mean width, and the share of LGUs where the model interval overlaps PSA's CI.
- Calibration: slope and intercept of official on predicted; reliability diagram by decile.
- Per-era and per-island-group breakdowns, and the lights-only vs full ablation.

### 5.4 Scoring against noisy labels
Because the labels have published SEs, two extra views are reported: (a) metrics restricted to LGUs with PSA CV < 20 %, and (b) a noise-aware score that simulates label draws from N(estimate, SE²) and reports the distribution of metrics, following the warning in Corral et al. 2025. The site shows the plain metric and the noise-aware band.

### 5.5 Leakage rules
- No target imputation, ever (the paper's Prophet step is not reproduced in the honest protocol).
- Feature scaling, target encoding and hyper-parameter search are fitted inside each training fold.
- Features computed from data later than the test year are excluded (e.g. 3-year slopes use only years ≤ t).
- Boundary harmonisation is done once, before splitting, with a fixed PSGC vintage.

## 6. Uncertainty quantification

| Model | Interval source | Why |
|---|---|---|
| Fay-Herriot | parametric-bootstrap MSE (`pbmseSTFH`) | the standard SAE answer; comparable to PSA's own MSE-based CIs |
| LightGBM / blend | **conformal prediction**: CV+ / jackknife+ intervals on the forward-chaining folds, with a locally adaptive variant so dark rural LGUs get wider bands (spatial conformal: Mao, Martin & Reich 2024 [JASA](https://ideas.repec.org/a/taf/jnlasa/v119y2024i546p904-914.html); LSCP [arXiv 2412.01098](https://arxiv.org/abs/2412.01098v2)); for the time dimension EnbPI-style ensembles ([Xu & Xie 2021](https://arxiv.org/pdf/2010.09107)) | distribution-free, honest coverage at the stated level |
| GRU/TCN | MC-dropout plus conformal calibration on the same folds | keeps the sequence model comparable |

Published artefact per LGU-year: point estimate, 50 % and 90 % intervals, the model's CV, a reliability tier (≤ 10 % reliable, 10–20 % use with caution, > 20 % unreliable, mirroring PSA's 20 % language and international practice, see ARCHITECTURE-RESEARCH.md §5), and, for official years, PSA's own estimate, SE and CI side by side.

## 7. Reporting

- `docs/MODEL-CARD.md` (to be written at training time): data, features, folds, metrics table (one row per model × fold × metric), ablation table, calibration plots, known failure modes (dark rural LGUs, island LGUs, boundary changes, the 2023 label-contains-lights issue), and the exact git SHA + data version of every number.
- The site's methodology page renders the same table and states: "Model estimates are not official statistics. Official PSA SAE values are shown with their published confidence intervals; model values are shown with model intervals; both are labelled."
- The baseline-vs-honest gap (random split vs forward-chaining) is shown explicitly as the project's first finding.

## 8. Compute budget

Training is tiny: about 8,000 rows × < 100 features. LightGBM folds run in seconds; the GRU in minutes on CPU; the FH bootstrap in minutes. Everything fits in a public-repo GitHub Actions job (4 vCPU / 16 GB, [runner specs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)) and never touches the fanless laptop.
