// Static read models produced by `lgu materialise` (crates/lgu-cli). One immutable folder per data
// version; data/latest.json points at the current one.

export type Tier = 0 | 1 | 2; // 0 reliable (CV <= 10 %), 1 use with caution (<= 20 %), 2 unreliable
export type Source = "official" | "model";
export type ModelKind = "backtest" | "between" | "nowcast";
export type Estimator = "ELL" | "Census EB" | string;

export interface Latest {
  version: string;
  base: string;
}

export interface Manifest {
  version: string;
  generated_at: string;
  git_sha: string;
  years: number[];
  rounds: number[];
  breaks: number[];
  tiers: { reliable_max_cv: number; caution_max_cv: number };
  z90: number;
  lgus: number;
  counts?: Record<string, number>;
  model: { name: string; version: string; whatif_widen: number; backtests: number[] };
  provenance: Provenance | null;
}

/** archivekit data-version metadata; only the fields the footer shows are typed. */
export interface Provenance {
  data_as_of?: string;
  as_of?: string;
  [key: string]: unknown;
}

export interface IndexLgu {
  p: string; // pcode, e.g. PH0102801
  n: string;
  pv: string; // province pcode
  r: string; // region pcode
  c: "municipality" | "city" | "sga" | string;
  x: number;
  y: number;
}

export interface IndexProvince {
  pcode: string;
  name: string;
  region: string;
  bbox: [number, number, number, number];
  lon: number;
  lat: number;
}

export interface Index {
  lgus: IndexLgu[];
  provinces: IndexProvince[];
  regions: { p: string; n: string }[];
}

export interface Official {
  estimate: number;
  se: number;
  cv: number;
  lo90: number;
  hi90: number;
  tier: Tier;
  estimator: Estimator;
}

export interface ModelEstimate {
  estimate: number;
  lo50: number;
  hi50: number;
  lo90: number;
  hi90: number;
  cv: number;
  tier: Tier;
  from: number;
  kind: ModelKind;
}

export interface YearRecord {
  year: number;
  official: Official | null;
  model: ModelEstimate | null;
  shown: { value: number; tier: Tier; source: Source } | null;
  inputs: { radiance: number | null; lit: number | null; ndvi: number | null; pop: number | null } | null;
}

export interface LguDetail {
  pcode: string;
  psgc: string;
  name: string;
  province: { pcode: string; name: string };
  region: { pcode: string; name: string };
  class: string;
  area_km2: number;
  years: YearRecord[];
}

export interface Scores {
  n: number;
  mae: number;
  rmse?: number;
  r2?: number;
  coverage90?: number;
  coverage50?: number;
  width90?: number;
  [key: string]: number | undefined;
}

export interface Metrics {
  rounds: number[];
  folds: { fold: string; train_rounds: number[]; test_round: number; model: Scores; carry_forward: Scores; ablation_no_satellite?: Scores }[];
  headline: {
    fold: string;
    test_round: number;
    model: Scores;
    carry_forward_mae: number;
    no_satellite_mae: number;
    n: number;
  };
}
