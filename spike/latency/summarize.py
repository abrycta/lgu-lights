import csv, sys, statistics as st
rows = [r for r in csv.reader(open(sys.argv[1])) if len(r) == 10]
def pct(xs, p):
    xs = sorted(xs); k = (len(xs)-1)*p; f = int(k); c = min(f+1, len(xs)-1)
    return xs[f] + (xs[c]-xs[f])*(k-f)
groups = {}
for mode, i, label, code, dns, con, tls, ttfb, tot, size in rows:
    groups.setdefault((label, mode), []).append((code, float(dns), float(con), float(tls), float(ttfb), float(tot), int(size)))
print("| Endpoint | Mode | n | HTTP | TCP connect p50 | TLS done p50 | TTFB p50 | TTFB p95 | total p50 | total p95 | bytes |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for (label, mode), v in groups.items():
    ms = lambda idx, p: f"{pct([x[idx] for x in v], p)*1000:.0f}"
    codes = ",".join(sorted({x[0] for x in v}))
    print(f"| {label} | {mode} | {len(v)} | {codes} | {ms(2,.5)} | {ms(3,.5)} | {ms(4,.5)} | {ms(4,.95)} | {ms(5,.5)} | {ms(5,.95)} | {v[0][6]} |")
