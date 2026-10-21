#!/usr/bin/env bash
# Make a materialised data version (the output of `lgu materialise`) available to the web app:
#   scripts/link-data.sh <dist-version-dir> [version] [--copy]
# Symlinks (or with --copy, copies) it to web/public/data/<version>/ and points
# web/public/data/latest.json at it. web/public/data/ is gitignored.
# Example: scripts/link-data.sh ../data/build/dist/v0
set -euo pipefail
copy=0
args=()
for a in "$@"; do
  if [ "$a" = "--copy" ]; then copy=1; else args+=("$a"); fi
done
[ "${#args[@]}" -ge 1 ] || { echo "usage: $0 <dist-version-dir> [version] [--copy]" >&2; exit 2; }
src="$(cd "${args[0]}" && pwd)"
version="${args[1]:-$(basename "$src")}"
[ -f "$src/manifest.json" ] || { echo "$src has no manifest.json" >&2; exit 1; }
[ -d "$src/tiles" ] || { echo "$src has no tiles/ directory" >&2; exit 1; }
case "$version" in */*|.*|"") echo "bad version name: $version" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/public/data"
mkdir -p "$dest"
rm -rf "${dest:?}/$version"
if [ "$copy" = 1 ]; then
  # Only what the app reads: no CSV or PMTiles side files.
  mkdir -p "$dest/$version"
  for f in manifest.json index.json metrics.json tiles-attrs.csv lgu tiles whatif; do
    [ -e "$src/$f" ] && cp -R "$src/$f" "$dest/$version/"
  done
else
  ln -s "$src" "$dest/$version"
fi
printf '{"version":"%s","base":"%s/"}\n' "$version" "$version" > "$dest/latest.json"
echo "data/$version -> $src ($( [ "$copy" = 1 ] && echo copy || echo symlink ))"
cat "$dest/latest.json"
