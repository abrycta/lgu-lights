#!/usr/bin/env bash
# One deduplicated issue per title in the private archive repo (never public): comment on the open one, else open it.
#
#   .github/scripts/archive-issue.sh open  "<title>" "<body>"
#   .github/scripts/archive-issue.sh close "<title>" "<body>"   # comment on the open one (if any) and close it
#
# Env: GH_TOKEN with Issues: write on the archive repo (ARCHIVE_READ_TOKEN), ARCHIVE (default abrycta/lgu-lights-archive).
# Without a token, or when GitHub refuses, it is only a ::warning:: line: an issue is a record, never a gate.
set -uo pipefail
mode=$1 title=$2 body=$3
archive=${ARCHIVE:-abrycta/lgu-lights-archive}
if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::ARCHIVE_READ_TOKEN is not set; '$title' is only in this run's annotations"
  exit 0
fi
num=$(gh issue list -R "$archive" --state open --search "\"$title\" in:title" --json number --jq '.[0].number // empty' || true)
case "$mode" in
  open)
    if [ -n "$num" ]; then
      gh issue comment "$num" -R "$archive" --body "$body" >/dev/null || echo "::warning::could not comment on $archive#$num"
    else
      gh issue create -R "$archive" --title "$title" --body "$body" >/dev/null || echo "::warning::could not open an issue in $archive"
    fi ;;
  close)
    [ -z "$num" ] || gh issue close "$num" -R "$archive" --comment "$body" >/dev/null || echo "::warning::could not close $archive#$num" ;;
  *) echo "usage: $0 open|close <title> <body>" >&2; exit 2 ;;
esac
exit 0
