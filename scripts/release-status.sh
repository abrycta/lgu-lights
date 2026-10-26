#!/usr/bin/env bash
# Is a GitHub release published under <tag>? Tells "absent" (HTTP 404) apart from an API error (a rate limit, a 5xx,
# no network), which callers must never read as "absent": that once dropped a live data version from the deploy and
# let a write-once check pass.
#
# Usage: scripts/release-status.sh <tag> [jq]
#   prints "present" (and then the jq expression's output on the release JSON, if given) or "absent", exit 0;
#   exit 1 when GitHub answered anything else after GH_ATTEMPTS tries (default 4, backoff GH_DELAY s, default 5).
# Env: GITHUB_REPOSITORY (default abrycta/lgu-lights). Drafts have no tag, so they count as absent.
set -uo pipefail

[ $# -ge 1 ] || { echo "usage: $0 <tag> [jq]" >&2; exit 2; }
tag=$1 jq=${2:-.tag_name}
repo=${GITHUB_REPOSITORY:-abrycta/lgu-lights}
n=1 max=${GH_ATTEMPTS:-4} delay=${GH_DELAY:-5}
while :; do
  out=$(gh api -i "repos/$repo/releases/tags/$tag" --jq "$jq" 2>/dev/null)
  code=$(printf '%s\n' "$out" | awk 'NR == 1 { print $2; exit }')
  case "$code" in
    200) echo present; printf '%s\n' "$out" | awk 'body { print } /^\r?$/ { body = 1 }'; exit 0 ;;
    404) echo absent; exit 0 ;;
  esac
  if [ "$n" -ge "$max" ]; then
    echo "::error title=GitHub API error::releases/tags/$tag answered ${code:-nothing} after $max attempts" >&2
    exit 1
  fi
  echo "::warning::releases/tags/$tag answered ${code:-nothing} (attempt $n of $max); retrying" >&2
  sleep $((delay * 2 ** (n - 1)))
  n=$((n + 1))
done
