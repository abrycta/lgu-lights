"""Pipeline commands (`uv run python -m lgu <command>`).

    inputs       fetch every file source through archivekit (primary -> mirrors -> private archive)
    inputs-direct  CI without ARCHIVE_READ_TOKEN: sha256-pinned public sources only (lgu/direct.py)
    boundaries   HDX COD-AB geodatabase -> data/interim/adm3.parquet, lgus.parquet, tile GeoJSONL
    labels       PSA SAE workbooks -> data/build/labels.parquet (+ crosswalk report)
    fies         PSA OpenSTAT provincial poverty (FIES) -> data/build/provinces_fies.parquet (lgu/fies.py)
    zonal-ee     Earth Engine: MODIS NDVI/EVI, WorldPop, SRTM -> data/interim/zonal_ee.parquet
    zonal-bm     LAADS Black Marble VNP46A4 + exactextract -> data/interim/zonal_bm.parquet
    zonal-vj     LAADS VJ113A1 NDVI/EVI + exactextract -> data/interim/zonal_vj.parquet (after Terra; --years
                 partial = only the years MOD13Q1 leaves incomplete, from zonal_ee.parquet)
    veg-calibrate  VJ113A1 -> MOD13Q1 calibration from the overlap years (--features, --vj) -> --out JSON
                 (default pipeline/inputs/veg_calibration.json) with an out-of-sample check (lgu/vegetation.py)
    features     merge zonal tables -> data/build/features.parquet (the feature store)
    train        design.csv (from the Rust CLI) -> models, metrics, parity expectations (lgu/train.py)
    to-parquet   estimates.csv (from the Rust CLI) -> estimates.parquet
    freshness    is newer upstream data available (Black Marble year, FIES year)? JSON; never touches data
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
from pathlib import Path

from .paths import CROSSWALK_OVERRIDES, DATA, INTERIM, RAW, REPO_ROOT
from .rounds import RUN_YEARS

BUILD = DATA / "build"
COMMITTED = Path(__file__).resolve().parents[1] / "inputs"
FILE_SOURCES = ["psa-sae-2018-2021", "psa-sae-2023", "cod-ab-phl-tables", "cod-ab-phl-gdb",
                "psa-fies-prov-2006-2015", "psa-fies-prov-2018-2023", "psa-fies-prov-nohuc", "psa-psgc"]
DEFAULT_YEARS = RUN_YEARS  # config/rounds.json


def years_arg(s: str) -> list[int]:
    a, _, b = s.partition("-")
    return list(range(int(a), int(b or a) + 1))


def _strip_queries(v):  # type: ignore[no-untyped-def]
    """Drop query strings (e.g. HDX's short-lived pre-signed S3 parameters) from published URLs."""
    if isinstance(v, dict):
        return {k: _strip_queries(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_strip_queries(x) for x in v]
    if isinstance(v, str) and v.startswith("https://") and "?" in v:
        return v.split("?", 1)[0]
    return v


def run(cmd: str, argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog=f"lgu {cmd}")
    ap.add_argument("--years", default=DEFAULT_YEARS)
    ap.add_argument("--design", type=Path, default=BUILD / "design.csv")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--accept", action="store_true",
                    help="labels/fies: accept changes against the committed reports in pipeline/inputs/ (reviewed)")
    ap.add_argument("--baseline", type=Path, help="train: metrics.json of the published data version to compare with")
    ap.add_argument("--accept-metrics", action="store_true", help="train: skip the metrics gate (a reviewed model change)")
    ap.add_argument("--recompute-ratio", action="store_true",
                    help="zonal-bm: re-derive the S-NPP/NOAA-20 calibration instead of pipeline/inputs/bm_ratio.json")
    ap.add_argument("--features", type=Path, help="veg-calibrate: feature store or zonal_ee table with MOD13Q1 values")
    ap.add_argument("--vj", type=Path, help="veg-calibrate: zonal_vj.parquet of the overlap years")
    ap.add_argument("--granules", type=Path, nargs="*", default=[],
                    help="veg-calibrate: vj_granules.json file(s) (file name -> sha256) of the overlap pull")
    a = ap.parse_args(argv)
    BUILD.mkdir(parents=True, exist_ok=True)

    if cmd == "inputs":
        import archivekit

        from . import sources
        run_manifest = archivekit.RunManifest()
        for sid in FILE_SOURCES:
            sources.ensure(sid, run_manifest)
        run_manifest.write(INTERIM / "run-manifest.json")
        meta = _strip_queries(archivekit.data_version_metadata(run_manifest, "pending"))
        (INTERIM / "provenance.json").write_text(json.dumps(meta, indent=2) + "\n")
        return 0

    if cmd == "inputs-direct":
        from . import direct
        for sid in ("cod-ab-phl-tables", "cod-ab-phl-gdb"):
            print(direct.fetch(sid))
        for f in ("labels.parquet", "crosswalk-report.json", "provinces_fies.parquet"):
            shutil.copy2(COMMITTED / f, BUILD / f)
        INTERIM.mkdir(parents=True, exist_ok=True)
        shutil.copy2(COMMITTED / "provenance.json", INTERIM / "provenance.json")
        return 0

    if cmd == "boundaries":
        from . import boundaries
        rep = boundaries.build(RAW / "boundaries" / "phl_admin_boundaries.gdb.zip", INTERIM)
        print(json.dumps(rep))
        shutil.copy2(INTERIM / "lgus.parquet", BUILD / "lgus.parquet")
        shutil.copy2(INTERIM / "provinces.json", BUILD / "provinces.json")
        return 0

    if cmd == "labels":
        import pandas as pd

        from . import labels
        adm3 = pd.read_excel(RAW / "boundaries" / "phl_admin_boundaries.xlsx", sheet_name="phl_admin3")
        shas = {}
        for sid, f in (("psa-sae-2018-2021", "psa-sae-2018-2021.xlsx"), ("psa-sae-2023", "psa-sae-2023.xlsx"),
                       ("psa-psgc", "psa-psgc.xlsx")):
            prov = json.loads((RAW / "psa" / f"{f}.provenance.json").read_text())
            shas[sid] = prov["sha256"]
        df, rep = labels.build_labels(RAW / "psa" / "psa-sae-2018-2021.xlsx", RAW / "psa" / "psa-sae-2023.xlsx",
                                      adm3, labels.load_overrides(CROSSWALK_OVERRIDES), shas,
                                      psgc=RAW / "psa" / "psa-psgc.xlsx")
        committed = COMMITTED / "crosswalk-report.json"
        if committed.exists():  # audit L-C9: never adopt a workbook that silently loses LGUs
            problems = labels.gate_report(rep, json.loads(committed.read_text()),
                                          labels.load_overrides(CROSSWALK_OVERRIDES))
            for msg in problems:
                print(f"::{'warning' if a.accept else 'error'} title=labels gate::{msg}")
            if problems and not a.accept:
                return 1
        df.to_parquet(BUILD / "labels.parquet", index=False)
        labels.write_report(rep, BUILD / "crosswalk-report.json")
        # Committed copy (pipeline/inputs/): CI without ARCHIVE_READ_TOKEN uses it (lgu/direct.py).
        COMMITTED.mkdir(exist_ok=True)
        df.to_parquet(COMMITTED / "labels.parquet", index=False)
        labels.write_report(rep, COMMITTED / "crosswalk-report.json")
        if (INTERIM / "provenance.json").exists():
            shutil.copy2(INTERIM / "provenance.json", COMMITTED / "provenance.json")
        print(json.dumps({"rows_per_round": rep["rows_per_round"], "matched": rep["matched"],
                          "unmatched": len(rep["unmatched"]), "dropped_many_to_one": rep["dropped_many_to_one_rows"]}))
        return 0

    if cmd == "fies":
        import pandas as pd

        from . import fies
        adm2 = pd.read_excel(RAW / "boundaries" / "phl_admin_boundaries.xlsx", sheet_name="phl_admin2")
        df, rep = fies.build(RAW / "psa", adm2[["adm2_pcode", "adm2_name"]])
        committed = COMMITTED / "provinces-fies-report.json"
        problems = fies.gate_report(rep, json.loads(committed.read_text()) if committed.exists() else {})
        for msg in problems:  # audit L-C8
            print(f"::{'warning' if a.accept else 'error'} title=FIES gate::{msg}")
        if problems and not a.accept:
            return 1
        df.to_parquet(BUILD / "provinces_fies.parquet", index=False)
        COMMITTED.mkdir(exist_ok=True)
        df.to_parquet(COMMITTED / "provinces_fies.parquet", index=False)  # B4: CI without the archive token
        (COMMITTED / "provinces-fies-report.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n")
        print(json.dumps({k: v for k, v in rep.items() if k != "unmapped_names"}))
        return 0

    if cmd == "zonal-ee":
        from . import ee_zonal
        ee_zonal.zonal(INTERIM / "adm3.parquet", years_arg(a.years), a.out or INTERIM / "zonal_ee.parquet")
        return 0

    if cmd == "zonal-bm":
        from . import laads
        laads.zonal_black_marble(INTERIM / "adm3.parquet", years_arg(a.years), a.out or INTERIM / "zonal_bm.parquet",
                                 recompute_ratio=a.recompute_ratio)
        return 0

    if cmd == "zonal-vj":
        from . import laads
        if a.years == "partial":  # only the years MOD13Q1 leaves incomplete (Terra's end), from zonal_ee.parquet
            import pandas as pd

            from . import features, vegetation
            ys = [y for y in features.partial_veg_years(pd.read_parquet(INTERIM / "zonal_ee.parquet"))
                  if y >= vegetation.OVERLAP_FROM]
            if not ys:
                print("::notice::MOD13Q1 complete for every year: VJ113A1 not needed")
                return 0
        else:
            ys = years_arg(a.years)
        laads.zonal_vj113a1(INTERIM / "adm3.parquet", ys, a.out or INTERIM / "zonal_vj.parquet")
        return 0

    if cmd == "veg-calibrate":
        import pandas as pd

        from . import vegetation
        mod, vj = pd.read_parquet(a.features), pd.read_parquet(a.vj)
        cal = vegetation.fit(mod, vj)
        ys = cal["overlap_years"]
        cal["validation"] = vegetation.validate(mod, vj, ys[:-2], ys[-2:])
        granules: dict[str, str] = {}
        for g in a.granules:
            granules |= json.loads(g.read_text())
        if granules:
            cal["granules"] = dict(sorted(granules.items()))
        out = a.out or vegetation.CAL_PATH
        out.write_text(json.dumps(cal, indent=1) + "\n")
        print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "offsets"} if isinstance(v, dict) else v
                          for k, v in cal.items() if k != "granules"} | {"granules": len(granules)}, indent=1))
        return 0

    if cmd == "features":
        from . import features
        rep = features.merge(INTERIM, BUILD / "features.parquet")
        print(json.dumps(rep))
        return 0

    if cmd == "train":
        from . import train
        out = a.out or BUILD / "model"
        rep = train.run(a.design, out, baseline=None if a.accept_metrics else a.baseline)
        print(json.dumps(rep["headline"], indent=1))
        return 0

    if cmd == "freshness":
        import httpx

        from . import freshness
        with httpx.Client(timeout=60, follow_redirects=True,
                          headers={"User-Agent": "lgu-lights-pipeline/0.1 (+https://github.com/abrycta/lgu-lights)"}) as c:
            print(json.dumps(freshness.check(c), indent=1))
        return 0
    if cmd == "to-parquet":
        import pandas as pd
        src = a.out or BUILD
        for name in ("estimates",):
            df = pd.read_csv(src / f"{name}.csv", dtype={"adm3_pcode": str})
            df.to_parquet(src / f"{name}.parquet", index=False, compression="zstd")
        return 0

    print(__doc__)
    return 2


__all__ = ["REPO_ROOT", "run"]
