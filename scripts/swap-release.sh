#!/usr/bin/env bash
# Publish a release under <tag> so that a failed (re-)run never leaves <tag> without a release (audits M3, L-C5).
#
# The new release is built as a draft under a temporary name (<tag>-run<id>-<attempt>; a draft has no git tag) and
# its asset count is checked. Then the old <tag> release is kept as <tag>-prev (keep-two; an older <tag>-prev is
# removed), the git tag <tag> is freed, and the draft is published as <tag>. Every GitHub call of the swap is retried
# with backoff (transient 5xx and secondary rate limits); if publishing still fails, an EXIT trap moves <tag>-prev
# back to <tag>, so <tag> is never left missing. If anything fails before the swap, the old <tag> is untouched.
#
# Usage: scripts/swap-release.sh <tag> <target-sha> <title> <notes> <prerelease: true|false> <asset>...
# Env:   SWAP_ATTEMPTS (default 5), SWAP_DELAY (first backoff in seconds, default 5), GITHUB_REPOSITORY (owner/repo).
set -euo pipefail

[ $# -ge 6 ] || { echo "usage: $0 <tag> <target-sha> <title> <notes> <prerelease> <asset>..." >&2; exit 2; }
tag=$1 target=$2 title=$3 notes=$4 pre=$5
shift 5
tmp="$tag-run${GITHUB_RUN_ID:-local$$}-${GITHUB_RUN_ATTEMPT:-1}"
prev="$tag-prev"
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

retry() {
  local n=1 max=${SWAP_ATTEMPTS:-5} delay=${SWAP_DELAY:-5}
  until "$@"; do
    [ "$n" -lt "$max" ] || return 1
    echo "::warning::attempt $n of $max failed: $*" >&2
    sleep $((delay * 2 ** (n - 1)))
    n=$((n + 1))
  done
}
published() { [ "$(gh release view "$1" --json isDraft --jq .isDraft 2>/dev/null)" = false ]; }

gh release delete "$tmp" --yes --cleanup-tag 2>/dev/null || true
gh release create "$tmp" --draft --target "$target" --title "$title" --notes "$notes" "$@"

have=$(gh release view "$tmp" --json assets --jq '.assets | length')
if [ "$have" != "$#" ]; then
  echo "::error::draft $tmp has $have of $# assets; $tag was left untouched"
  exit 1
fi

moved=0 swapped=0 old_sha=""
restore() {
  [ "$moved" = 1 ] && [ "$swapped" = 0 ] || return 0
  if published "$tag"; then return 0; fi   # the publish went through although its response failed
  echo "::error::publishing $tmp as $tag failed; restoring the previous $tag from $prev (the draft $tmp is kept)"
  if retry gh release edit "$prev" --tag "$tag" --target "$old_sha" --title "$tag" >/dev/null; then
    echo "restored $tag"
  else
    echo "::error::could not restore $tag: run gh release edit $prev --tag $tag --target $old_sha"
  fi
}
trap restore EXIT

if gh release view "$tag" --json tagName >/dev/null 2>&1; then
  old_sha=$(gh api "repos/$repo/git/ref/tags/$tag" --jq .object.sha 2>/dev/null || true)
  [ -n "$old_sha" ] || old_sha=$(gh release view "$tag" --json targetCommitish --jq .targetCommitish)
  if gh release view "$prev" --json tagName >/dev/null 2>&1; then
    retry gh release delete "$prev" --yes --cleanup-tag
  fi
  retry gh release edit "$tag" --tag "$prev" --target "$old_sha" --title "$tag (previous)" >/dev/null
  moved=1
  # free the git tag so that the new release gets its own target commit
  retry gh api -X DELETE "repos/$repo/git/refs/tags/$tag" >/dev/null 2>&1 || true
fi

if ! retry gh release edit "$tmp" --tag "$tag" --target "$target" --title "$title" --draft=false --prerelease="$pre" >/dev/null; then
  if ! published "$tag"; then
    echo "::error::swap failed after ${SWAP_ATTEMPTS:-5} attempts; the complete draft is $tmp"
    exit 1
  fi
fi
swapped=1
echo "published $tag ($# assets) from draft $tmp; the previous release is $prev"
