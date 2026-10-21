#!/usr/bin/env bash
# Vector tiles for one data version (spike S1): geometry is tiled once per boundary vintage, then the
# per-version attributes (tiles-attrs.csv from `lgu materialise`) are joined with tile-join in seconds.
#
#   build_tiles.sh geometry <adm3.geojsonl> <adm2.geojsonl> <out geom.pmtiles>
#   build_tiles.sh join <geom.pmtiles> <tiles-attrs.csv> <out dir>   -> <out>/lgu.pmtiles + <out>/tiles/{z}/{x}/{y}.pbf
#
# Cloudflare Pages answers Range requests with 200 (spike §2), so the site reads the z/x/y directory;
# lgu.pmtiles is the single-file copy for Hugging Face (fallback host) and for range-capable hosts.
set -euo pipefail
export TIPPECANOE_MAX_THREADS="${TIPPECANOE_MAX_THREADS:-2}"
case "$1" in
  geometry)
    tippecanoe -q -o "$4" --force -Z0 -z10 --detect-shared-borders --no-feature-limit --no-tile-size-limit \
      --simplification=4 -L "lgu:$2" -L "prov:$3"
    ;;
  join)
    mkdir -p "$4"
    tile-join -q -f -pk -z10 -c "$3" -o "$4/lgu.pmtiles" "$2"
    rm -rf "$4/tiles"
    tile-join -q -f -pk -z10 --no-tile-compression -c "$3" -e "$4/tiles" "$2"
    rm -f "$4/tiles/metadata.json"
    ;;
  *) echo "usage: $0 geometry|join ..." >&2; exit 2 ;;
esac
