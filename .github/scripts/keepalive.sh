#!/usr/bin/env bash
# Keep every scheduled workflow of this repo enabled, including the one that runs this script.
# GitHub disables cron workflows in a public repository after 60 days without repository activity;
# re-enabling resets that clock and also brings back a workflow that was already disabled. It runs from two
# workflows (freshness.yml monthly, live-check.yml hourly), so either one can bring the other back.
# The list comes from the checked-out .github/workflows (every file with a cron), so new schedules are covered.
# Needs `actions: write` and GH_TOKEN. Problems are ::warning lines; the exit code is 1 when any enable failed.
set -uo pipefail
cd "$(dirname "$0")/../workflows" || exit 1
failed=0
# shellcheck disable=SC2013 # workflow file names have no spaces
for wf in $(grep -lE '^[^#]*cron:' -- *.yml *.yaml 2>/dev/null); do
  state=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf" --jq .state 2>/dev/null) || {
    echo "::warning title=keepalive::cannot read $wf"; failed=1; continue; }
  [ "$state" = active ] || echo "::warning title=keepalive::$wf was $state; re-enabling it"
  if gh api -X PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/enable" >/dev/null 2>&1; then
    echo "$wf enabled (was $state)"
  else
    echo "::warning title=keepalive::could not re-enable $wf"; failed=1
  fi
done
exit "$failed"
