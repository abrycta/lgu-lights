#!/usr/bin/env bash
# Spike: start `wrangler dev` (local workerd, no deploy), time the first (cold) and warm requests, stop it.
set -u
PORT=8787
T0=$(python3 -c 'import time;print(time.time())')
env -u CLOUDFLARE_API_TOKEN npx wrangler dev --local --port $PORT --ip 127.0.0.1 --show-interactive-dev-session=false > out/wrangler-dev.log 2>&1 &
WP=$!
until curl -s -o /dev/null "http://127.0.0.1:$PORT/v1/healthz" 2>/dev/null; do sleep 0.2; done
T1=$(python3 -c 'import time;print(time.time())')
echo "ready_after_s=$(python3 -c "print(round($T1-$T0,2))")  (includes cargo/worker-build no-op rebuild)"
# The healthz probe above did not touch the snapshot; the first /v1/lgu request pays the snapshot parse (OnceLock).
curl -s -o out/first.json -w "cold_first_lgu: http=%{http_code} total_ms=%{time_total}\n" "http://127.0.0.1:$PORT/v1/lgu/0102801000"
args=(); codes=(0102801000 1909908000 1380600000 0722217000 1204712000); for i in $(seq 1 200); do [ $i -gt 1 ] && args+=(--next); args+=(-s -o /dev/null -w "%{time_total}\n" "http://127.0.0.1:$PORT/v1/lgu/${codes[$((i%5))]}"); done
curl "${args[@]}" | python3 -c "
import sys; x=sorted(float(l)*1000 for l in sys.stdin); n=len(x)
print(f'warm n={n} p50={x[n//2]:.2f} ms p95={x[int(n*.95)]:.2f} ms max={x[-1]:.2f} ms (loopback wall time per request)')"
args=(); for i in $(seq 1 200); do [ $i -gt 1 ] && args+=(--next); args+=(-s -o /dev/null -w "%{time_total}\n" "http://127.0.0.1:$PORT/v1/healthz"); done
curl "${args[@]}" | python3 -c "
import sys; x=sorted(float(l)*1000 for l in sys.stdin); n=len(x)
print(f'healthz n={n} p50={x[n//2]:.2f} ms p95={x[int(n*.95)]:.2f} ms (router-only baseline)')"
curl -s -o /dev/null -w "404 unknown psgc: %{http_code}\n" "http://127.0.0.1:$PORT/v1/lgu/0000000001"
head -c 400 out/first.json; echo
kill $WP; sleep 1; pkill -f "workerd serve" 2>/dev/null; pkill -f "wrangler dev --local --port $PORT" 2>/dev/null; true
