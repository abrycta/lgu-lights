"""Spike: a synthetic ~3 MB read-model snapshot for the Worker, keyed by the real HDX COD-AB v03 PSGC codes.

Layout (little-endian): u32 n | u64 psgc[n] (sorted) | f32 est[n][14][4] (p, lo, hi, tier) | f32 feat[n][14][30]
Run from spike/python:  uv run --group geo python -I make_snapshot.py   -> ../worker/snapshot.bin (gitignored)
"""
import pathlib
import numpy as np
import pyogrio

root = pathlib.Path(__file__).resolve().parent.parent
df = pyogrio.read_dataframe(root / "tiles/data/hdx/phl_admin_boundaries.gdb.zip", layer="phl_admin3", read_geometry=False)
psgc = np.sort((df.adm3_pcode.str[2:] + "000").astype(np.uint64).to_numpy())
n = len(psgc)
rng = np.random.default_rng(3)
p = rng.uniform(1, 60, (n, 14)).astype(np.float32)
w = rng.uniform(1, 12, (n, 14)).astype(np.float32)
est = np.stack([p, p - w, p + w, rng.integers(0, 3, (n, 14)).astype(np.float32)], axis=-1)
feat = rng.standard_normal((n, 14, 30)).astype(np.float32)
out = root / "worker" / "snapshot.bin"
with open(out, "wb") as f:
    f.write(np.uint32(n).tobytes()); f.write(psgc.astype("<u8").tobytes())
    f.write(est.astype("<f4").tobytes()); f.write(feat.astype("<f4").tobytes())
print(n, out.stat().st_size, "bytes; first/last psgc", psgc[0], psgc[-1])
