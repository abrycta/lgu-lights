#!/usr/bin/env bash
# Publish a release under <tag> so that a failed (re-)run never leaves <tag> without a release (audits M3, L-C5).
#
# The new release is built as a draft under a temporary name (<tag>-run<id>-<attempt>; a draft has no git tag) and
# its asset count is checked. Then the old <tag> release is kept as <tag>-prev (keep-two; an older <tag>-prev is
# removed), the git tag <tag> is freed, and the draft is published as <tag>. Every GitHub call of the swap is retried
# with backoff (transient 5xx and secondary rate limits) and is idempotent (a move GitHub applied but answered with a
# 502 counts as done), and <tag> is verified as published at the end; if publishing still fails, an EXIT trap moves <tag>-prev
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
here="$(cd "$(dirname "$0")" && pwd)"
# present|absent from GitHub's releases/tags endpoint; empty on an API error, which is neither (release-status.sh).
status() { GITHUB_REPOSITORY="$repo" GH_ATTEMPTS=1 "$here/release-status.sh" "$1" 2>/dev/null | head -1; }
published() { [ "$(status "$1")" = present ]; }
absent() { [ "$(status "$1")" = absent ]; }
# move <from> <to> <gh release edit options>: idempotent. GitHub can apply a move and still answer 502; the retry of
# the same edit then fails because <from> is gone, so a move counts as done when <to> is published and <from> is not.
move() {
  local from=$1 to=$2; shift 2
  gh release edit "$from" --tag "$to" "$@" >/dev/null && return 0
  published "$to" && absent "$from"
}
drop() { gh release delete "$1" --yes --cleanup-tag || absent "$1"; }

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
  if retry move "$prev" "$tag" --target "$old_sha" --title "$tag"; then
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
    retry drop "$prev"
  fi
  moved=1   # before the move: if it fails half-way, the EXIT trap restores <tag> from <prev>
  retry move "$tag" "$prev" --target "$old_sha" --title "$tag (previous)"
  # free the git tag so that the new release gets its own target commit
  retry gh api -X DELETE "repos/$repo/git/refs/tags/$tag" >/dev/null 2>&1 || true
fi

if ! retry move "$tmp" "$tag" --target "$target" --title "$title" --draft=false --prerelease="$pre"; then
  echo "::error::swap failed after ${SWAP_ATTEMPTS:-5} attempts; the complete draft is $tmp"
  exit 1
fi
# Verify that <tag> answers as a published release (a 502 can hide either outcome); the EXIT trap restores it if not.
if ! retry published "$tag"; then
  echo "::error::$tag is not published after the swap; the complete draft is $tmp"
  exit 1
fi
swapped=1
echo "published $tag ($# assets) from draft $tmp; the previous release is $prev"
