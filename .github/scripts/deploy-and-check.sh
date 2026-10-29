#!/usr/bin/env bash
# Run the normal deploy (web.yml on main) and check that the live latest.json then names <version>.
#
#   .github/scripts/deploy-and-check.sh <version>
#
# Used by freshness.yml after an automatic data version was marked auto-validated (and to put the previous version
# back on a rollback). web.yml's deploy job ships main's newest covered commit through scripts/deploy-web.sh, which
# serves the newest auto-validated version. A run started with the workflow token is a workflow_dispatch run, the one
# kind such a token may start. Needs GH_TOKEN with actions: write, GITHUB_REPOSITORY; LIVE_URL (default the app).
# Exit 1 when the run cannot be found, does not succeed in 45 minutes, or the site does not serve <version>.
set -euo pipefail
want=$1
repo=$GITHUB_REPOSITORY live=${LIVE_URL:-https://lights.krtmtthw.dev}
since=$(date -u +%FT%TZ)
gh workflow run web.yml -R "$repo" --ref main
id=""
for _ in $(seq 1 30); do
  sleep 10
  id=$(gh run list -R "$repo" -w web.yml -e workflow_dispatch -b main -L 10 --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$since\")] | sort_by(.createdAt) | first | .databaseId // empty")
  [ -z "$id" ] || break
done
[ -n "$id" ] || { echo "::error::the web.yml run did not appear"; exit 1; }
url="$GITHUB_SERVER_URL/$repo/actions/runs/$id"
echo "web.yml run: $url"
echo "deploy: $url" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
# the run's own deploy job checks the live site too; this waits for it (inside CI, bounded by the job timeout)
timeout 45m gh run watch "$id" -R "$repo" --exit-status --interval 30 >/dev/null \
  || { echo "::error::web.yml run $url did not succeed"; exit 1; }
# a run whose deploy job decided not to deploy (main's newest commit still in CI) is green too, so ask the site
for i in $(seq 1 20); do
  got=$(curl -fsS "$live/data/latest.json?t=$(date +%s)" | jq -r .version || true)
  if [ "$got" = "$want" ]; then echo "live latest.json: $want" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; exit 0; fi
  echo "live latest.json is ${got:-unreadable}, expecting $want ($i/20)"
  sleep 30
done
echo "::error::the site serves ${got:-nothing}, not $want, after the deploy"
exit 1
