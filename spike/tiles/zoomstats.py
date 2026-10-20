"""Spike: per-zoom tile count / bytes / max tile size of a PMTiles archive.  python zoomstats.py <file.pmtiles>..."""
import sys, gzip
from pmtiles.reader import MmapSource, all_tiles, Reader
for path in sys.argv[1:]:
    with open(path, "rb") as f:
        src = MmapSource(f); hdr = Reader(src).header()
        z = {}
        for (zz, x, y), data in all_tiles(src):
            n, b, m = z.get(zz, (0, 0, 0)); z[zz] = (n + 1, b + len(data), max(m, len(data)))
    import os
    print(f"{path}: {os.path.getsize(path)/1e6:.2f} MB, tile_compression={hdr['tile_compression']}, unique tiles={sum(v[0] for v in z.values())}")
    for zz in sorted(z):
        n, b, m = z[zz]; print(f"  z{zz:<2} tiles={n:<6} bytes={b/1e6:7.2f} MB  max_tile={m/1e3:7.1f} kB")
