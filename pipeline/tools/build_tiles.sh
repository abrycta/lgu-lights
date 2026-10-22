#!/usr/bin/env bash
# Vector tiles for one data version: geometry is tiled once per boundary vintage (spike S1). From data v4
# the tiles carry geometry, the feature id and the pcode only: the app reads every place's per-year value,
# tier and source from tiles-attrs.csv (`lgu materialise`) and styles the tiles by feature id, so the
# 14 years x (value, tier, source) are not repeated in every tile (about 40 % smaller on the wire at z4).
#
#   build_tiles.sh geometry <adm3.geojsonl> <adm2.geojsonl> <out geom.pmtiles>
#   build_tiles.sh export <geom.pmtiles> <out dir>             -> <out>/lgu.pmtiles + <out>/tiles/{z}/{x}/{y}.pbf
#   build_tiles.sh join <geom.pmtiles> <tiles-attrs.csv> <out dir>   (data v1-v3: attributes joined into the tiles)
#
# Cloudflare Pages answers Range requests with 200 (spike §2), so the site reads the z/x/y directory;
# lgu.pmtiles is the single-file copy (release asset) for range-capable hosts.
set -euo pipefail
export TIPPECANOE_MAX_THREADS="${TIPPECANOE_MAX_THREADS:-2}"
case "$1" in
  geometry)
    tippecanoe -q -o "$4" --force -Z0 -z10 --detect-shared-borders --no-feature-limit --no-tile-size-limit \
      --simplification=4 -L "lgu:$2" -L "prov:$3"
    ;;
  export)
    mkdir -p "$3"
    cp "$2" "$3/lgu.pmtiles"
    rm -rf "$3/tiles"
    tile-join -q -f -pk -z10 --no-tile-compression -e "$3/tiles" "$2"
    rm -f "$3/tiles/metadata.json"
    ;;
  join)
    mkdir -p "$4"
    tile-join -q -f -pk -z10 -c "$3" -o "$4/lgu.pmtiles" "$2"
    rm -rf "$4/tiles"
    tile-join -q -f -pk -z10 --no-tile-compression -c "$3" -e "$4/tiles" "$2"
    rm -f "$4/tiles/metadata.json"
    ;;
  *) echo "usage: $0 geometry|export|join ..." >&2; exit 2 ;;
esac
