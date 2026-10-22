#!/usr/bin/env bash
# data.yml: Earth Engine and Black Marble zonal statistics in parallel, failing fast.
#   tools/zonal_parallel.sh <years>        (run from pipeline/, e.g. tools/zonal_parallel.sh 2012-2025)
# The first part to fail stops the other at once (instead of letting it run on for the whole job), and the
# job summary names the part that failed with the end of its log. Needs bash >= 5.1 (wait -n -p).
set -uo pipefail
years="$1"
logs="$(cd .. && pwd)"
summary="${GITHUB_STEP_SUMMARY:-/dev/stderr}"
start=$(date +%s)

uv run python -m lgu zonal-ee --years "$years" > "$logs/ee.log" 2>&1 & ee=$!
uv run python -m lgu zonal-bm --years "$years" > "$logs/bm.log" 2>&1 & bm=$!
declare -A name=([$ee]="Earth Engine (zonal-ee)" [$bm]="Black Marble (zonal-bm)")
declare -A log=([$ee]="$logs/ee.log" [$bm]="$logs/bm.log")

pending=2
while ((pending)); do
  wait -n -p pid "$ee" "$bm"
  status=$?
  pending=$((pending - 1))
  if ((status != 0)); then
    for other in "$ee" "$bm"; do
      if [ "$other" != "$pid" ]; then pkill -TERM -P "$other" 2>/dev/null; kill "$other" 2>/dev/null; fi
    done
    {
      echo "### :x: ${name[$pid]} failed (exit $status) for years $years after $(( $(date +%s) - start )) s"
      echo "The other part was stopped at once (fail fast)."
      echo '```'
      tail -n 20 "${log[$pid]}"
      echo '```'
    } >> "$summary"
    tail -n 40 "${log[$pid]}" >&2
    exit 1
  fi
  echo "${name[$pid]} done after $(( $(date +%s) - start )) s"
done
tail -n 3 "$logs/ee.log" "$logs/bm.log"
echo "zonal statistics ($years): $(( $(date +%s) - start )) s" >> "$summary"
