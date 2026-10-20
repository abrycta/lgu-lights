| Endpoint | Mode | n | HTTP | TCP connect p50 | TLS done p50 | TTFB p50 | TTFB p95 | total p50 | total p95 | bytes |
|---|---|---|---|---|---|---|---|---|---|---|
| cf-pages-asset | fresh | 40 | 200 | 41 | 86 | 156 | 178 | 242 | 283 | 246607 |
| cf-pages-asset | reuse | 40 | 200 | 0 | 0 | 46 | 68 | 64 | 93 | 246607 |
| gh-pages-asset | fresh | 40 | 200 | 44 | 88 | 130 | 152 | 229 | 266 | 247054 |
| gh-pages-asset | reuse | 40 | 200 | 0 | 0 | 43 | 50 | 55 | 66 | 247054 |
| gh-pages-asset-range | fresh | 40 | 206 | 45 | 89 | 131 | 143 | 131 | 143 | 1024 |
| gh-pages-asset-range | reuse | 40 | 206 | 0 | 0 | 39 | 42 | 39 | 42 | 1024 |
| cf-pages-function | fresh | 40 | 503 | 50 | 105 | 187 | 232 | 188 | 232 | 288 |
| cf-pages-function | reuse | 40 | 503 | 0 | 0 | 50 | 65 | 51 | 65 | 288 |
| hf-resolve-range16k | fresh | 40 | 206 | 119 | 235 | 733 | 753 | 1019 | 1086 | 16384 |
| hf-resolve-range16k | reuse | 40 | 206 | 0 | 0 | 498 | 509 | 781 | 820 | 16384 |
| hf-resolve-range-tile | fresh | 40 | 206 | 120 | 237 | 735 | 745 | 1022 | 1105 | 16384 |
| hf-resolve-range-tile | reuse | 40 | 206 | 0 | 0 | 503 | 594 | 784 | 927 | 16384 |
| gh-pages-range16k | fresh | 40 | 206 | 39 | 79 | 117 | 134 | 122 | 140 | 16384 |
| gh-pages-range16k | reuse | 40 | 206 | 0 | 0 | 36 | 43 | 43 | 46 | 16384 |
