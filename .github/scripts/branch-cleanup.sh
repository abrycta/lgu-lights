#!/usr/bin/env bash
# branch-cleanup.sh: delete remote branches that are finished with.
#
#   branch-cleanup.sh [--dry-run] [owner/repo]
#
# A branch is deleted when its newest merged PR has the branch's current tip as its head, or when it has no
# commits that the default branch lacks (0 ahead). Never touched: the default branch, gh-pages, dependabot/*,
# changeset-release/* and any branch with an open PR. Needs GH_TOKEN with contents: write and pull-requests: read.
# Prints a Markdown table of what it did; the exit code is 1 when any deletion failed.
set -euo pipefail

dry_run=0
if [ "${1:-}" = --dry-run ]; then dry_run=1; shift; fi
repo="${1:-${GITHUB_REPOSITORY:?pass owner/repo or set GITHUB_REPOSITORY}}"

default=$(gh api "repos/$repo" --jq .default_branch)
open_heads=$(gh pr list -R "$repo" --state open --limit 1000 --json headRefName --jq '.[].headRefName')
branches=$(gh api --paginate "repos/$repo/branches?per_page=100" --jq '.[] | "\(.name) \(.commit.sha)"')

echo "| Branch | Result |"
echo "| --- | --- |"
failed=0
deleted=0
while read -r name sha; do
  [ -n "$name" ] || continue
  case "$name" in
    "$default" | gh-pages | dependabot/* | changeset-release/*) continue ;;
  esac
  if grep -qxF -- "$name" <<<"$open_heads"; then continue; fi

  reason=""
  merged_head=$(gh pr list -R "$repo" --state merged --head "$name" --limit 1 --json headRefOid --jq '.[0].headRefOid // ""')
  if [ "$merged_head" = "$sha" ]; then
    reason="PR merged"
  else
    ahead=$(gh api "repos/$repo/compare/$default...$sha" --jq .ahead_by)
    [ "$ahead" = 0 ] && reason="0 commits ahead of $default"
  fi
  [ -n "$reason" ] || continue

  if [ "$dry_run" = 1 ]; then
    echo "| \`$name\` | would delete ($reason) |"
  elif gh api -X DELETE "repos/$repo/git/refs/heads/$name" >/dev/null; then
    echo "| \`$name\` | deleted ($reason) |"
    deleted=$((deleted + 1))
  else
    echo "| \`$name\` | could not delete ($reason) |"
    echo "::warning title=branch-cleanup::could not delete $name" >&2
    failed=1
  fi
done <<<"$branches"

if [ "$dry_run" = 0 ]; then printf '\n%s branch(es) deleted.\n' "$deleted"; fi
exit "$failed"
