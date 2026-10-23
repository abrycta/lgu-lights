#!/usr/bin/env bash
# Publish a release under <tag> so that a failed (re-)run never leaves <tag> without a release (audit M3).
#
# The new release is built as a draft under a temporary name (<tag>-run<id>-<attempt>; a draft has no git tag),
# its asset count is checked, and only then is the old <tag> release deleted and the draft renamed to <tag> and
# published. If anything fails before the swap, the old <tag> release is untouched. Each version still ends with
# exactly one release, so the published versions and rollback (scripts/deploy-web.sh DATA_VERSIONS) are unchanged.
#
# Usage: scripts/swap-release.sh <tag> <target-sha> <title> <notes> <prerelease: true|false> <asset>...
set -euo pipefail

[ $# -ge 6 ] || { echo "usage: $0 <tag> <target-sha> <title> <notes> <prerelease> <asset>..." >&2; exit 2; }
tag=$1 target=$2 title=$3 notes=$4 pre=$5
shift 5
tmp="$tag-run${GITHUB_RUN_ID:-local$$}-${GITHUB_RUN_ATTEMPT:-1}"

gh release delete "$tmp" --yes --cleanup-tag 2>/dev/null || true
gh release create "$tmp" --draft --target "$target" --title "$title" --notes "$notes" "$@"

have=$(gh release view "$tmp" --json assets --jq '.assets | length')
if [ "$have" != "$#" ]; then
  echo "::error::draft $tmp has $have of $# assets; $tag was left untouched"
  exit 1
fi

gh release delete "$tag" --yes --cleanup-tag 2>/dev/null || true
if ! gh release edit "$tmp" --tag "$tag" --target "$target" --title "$title" --draft=false --prerelease="$pre" >/dev/null; then
  echo "::error::swap failed: publish the complete draft with: gh release edit $tmp --tag $tag --draft=false"
  exit 1
fi
echo "published $tag ($# assets) from draft $tmp"
