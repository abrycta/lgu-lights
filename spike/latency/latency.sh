#!/usr/bin/env bash
# Usage: latency.sh <label> <url> [n] [range]
# Writes one CSV row per request: mode,i,label,http,dns,connect,tls,ttfb,total,bytes (seconds)
# mode=fresh: a new curl process per request (OS DNS cache, new TCP+TLS each time), 0.3 s apart
# mode=reuse: one curl process, n requests over one kept-alive HTTP/2 connection (curl --next)
set -eo pipefail
label=$1; url=$2; n=${3:-40}; range=${4:-}
fmt="${label},%{http_code},%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total},%{size_download}\n"
hdr=(-H "X-Spike: lgu-lights"); [ -n "$range" ] && hdr=(-H "Range: bytes=$range")
for i in $(seq 1 "$n"); do
  curl -sS -L -o /dev/null "${hdr[@]}" -w "fresh,$i,$fmt" "$url" 2>/dev/null || echo "fresh,$i,$label,ERR"
  sleep 0.3
done
args=(); for i in $(seq 1 "$n"); do [ "$i" -gt 1 ] && args+=(--next); args+=(-sS -L -o /dev/null "${hdr[@]}" -w "reuse,$i,$fmt" "$url"); done
curl "${args[@]}" 2>/dev/null
