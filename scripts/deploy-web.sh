#!/usr/bin/env bash
# Build and deploy the Lights web app to Cloudflare Pages (project lgu-lights, https://lights.krtmtthw.dev).
# Run by web.yml's deploy job on main after the checks pass; the same script works from a laptop.
#
#   scripts/deploy-web.sh [--no-deploy]
#     --no-deploy   build and stage web/dist (with the data) and stop: nothing is uploaded
#
# Steps:
#   1. the what-if WASM module (crates/lgu-wasm, cargo, wasm32) -> wasm/lgu_wasm.wasm
#   2. `npx vite build` in web/ with a staged public directory: web/public without data/ (so never the
#      local v0 dev link) and with the fresh WASM
#   3. the published data versions only: each read-models-<v>.tar.zst from the data-<v> GitHub release,
#      its sha256 checked against the digest GitHub publishes for that asset, unpacked, its manifest's
#      version checked, and only the files the app reads copied to dist/data/<v>/; then dist/data/latest.json, and
#      <link rel=preload> tags in dist/index.html for LATEST's manifest.json, index.json and tiles-attrs.csv
#   4. npx --yes wrangler@4 pages deploy dist --project-name lgu-lights --branch main
#   5. live checks: /deploy.json is this commit, latest.json reports LATEST, the home page serves this build's script, /embed and the
#      WASM answer 200 (retried for up to 2 minutes while the deploy propagates)
#
# Env: DATA_VERSIONS (default "v1 v3 v4"), LATEST (default v4), LIVE_URL (default https://lights.krtmtthw.dev),
#      CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (locally: Keychain cloudflare-api-token and the
#      account ID from ../typhoon-replay/.env.deploy when unset), GH_TOKEN for the release download in CI.
# Needs: node 24, npm deps installed in web/ (npm ci), cargo with the wasm32 target, gh, zstd, curl.
set -euo pipefail

DATA_VERSIONS="${DATA_VERSIONS:-v1 v3 v4}"
LATEST="${LATEST:-v4}"
LIVE_URL="${LIVE_URL:-https://lights.krtmtthw.dev}"
PROJECT=lgu-lights
REPO=abrycta/lgu-lights
# What the app reads from a data version (as scripts/link-data.sh --copy): no CSV, Parquet or PMTiles.
APP_FILES=(manifest.json index.json metrics.json tiles-attrs.csv lgu tiles whatif)

deploy=1
for a in "$@"; do
  case "$a" in
    --no-deploy) deploy=0 ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
web="$root/web"
cache="$root/data/deploy-cache"   # /data/ is gitignored
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
step() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

case " $DATA_VERSIONS " in *" $LATEST "*) ;; *) die "LATEST=$LATEST is not in DATA_VERSIONS=($DATA_VERSIONS)";; esac
# Homebrew's rustup keeps its cargo proxy (which honours rust-toolchain.toml) off PATH.
if ! command -v cargo >/dev/null && [ -x /opt/homebrew/opt/rustup/bin/cargo ]; then PATH="/opt/homebrew/opt/rustup/bin:$PATH"; fi
for t in node npx cargo gh zstd curl; do command -v "$t" >/dev/null || die "$t is required"; done
[ -d "$web/node_modules" ] || die "web/node_modules is missing: run npm ci in web/ first"
nice_cmd=()
if [ -z "${CI:-}" ] && command -v taskpolicy >/dev/null; then nice_cmd=(taskpolicy -b); fi   # fanless laptop

step "WASM module (crates/lgu-wasm)"
(cd "$root" && ${nice_cmd[@]+"${nice_cmd[@]}"} cargo build --profile wasm --target wasm32-unknown-unknown -p lgu-wasm)
wasm="$root/target/wasm32-unknown-unknown/wasm/lgu_wasm.wasm"
[ -s "$wasm" ] || die "no $wasm"

step "Web build (public/ without data/)"
mkdir -p "$stage/public/wasm"
for f in "$web/public"/* "$web/public"/.[!.]*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in data|wasm) continue ;; esac
  cp -R "$f" "$stage/public/"
done
cp "$wasm" "$stage/public/wasm/lgu_wasm.wasm"
(cd "$web" && rm -rf dist && LIGHTS_PUBLIC_DIR="$stage/public" ${nice_cmd[@]+"${nice_cmd[@]}"} npx vite build)
[ -f "$web/dist/index.html" ] && [ -f "$web/dist/embed.html" ] || die "the build has no index.html or embed.html"
[ ! -e "$web/dist/data" ] || die "dist/data exists after the build (public/data leaked in)"

step "Data versions: $DATA_VERSIONS (latest $LATEST)"
mkdir -p "$cache" "$web/dist/data"
for v in $DATA_VERSIONS; do
  asset="read-models-$v.tar.zst"
  want=$(gh api "repos/$REPO/releases/tags/data-$v" --jq ".assets[] | select(.name == \"$asset\") | .digest")
  [[ "$want" == sha256:* ]] || die "data-$v has no sha256 digest for $asset"
  want="${want#sha256:}"
  have=""
  [ -f "$cache/$asset" ] && have=$(shasum -a 256 "$cache/$asset" | cut -d' ' -f1)
  if [ "$have" != "$want" ]; then
    gh release download "data-$v" -R "$REPO" -p "$asset" -D "$cache" --clobber
    have=$(shasum -a 256 "$cache/$asset" | cut -d' ' -f1)
  fi
  [ "$have" = "$want" ] || die "$asset: sha256 $have does not match the release digest $want"
  echo "$asset: sha256 $have (matches the data-$v release)"
  rm -rf "$stage/data" && mkdir -p "$stage/data"
  zstd -dc "$cache/$asset" | tar -xf - -C "$stage/data"
  got=$(node -p 'require(process.argv[1]).version' "$stage/data/$v/manifest.json")
  [ "$got" = "$v" ] || die "$asset: manifest.json says version $got, expected $v"
  mkdir -p "$web/dist/data/$v"
  for f in "${APP_FILES[@]}"; do
    [ -e "$stage/data/$v/$f" ] || die "$asset has no $v/$f"
    cp -R "$stage/data/$v/$f" "$web/dist/data/$v/"
  done
done
printf '{"version":"%s","base":"%s/"}\n' "$LATEST" "$LATEST" > "$web/dist/data/latest.json"
# The app reads latest.json first and only then the version's files; the home page already knows LATEST, so it
# preloads them too (same URLs and request mode as src/data/load.ts; latest.json stays the runtime truth).
marker='<!-- data-preload: scripts/deploy-web.sh puts the current version'"'"'s manifest, index and tiles-attrs.csv here -->'
grep -qF "$marker" "$web/dist/index.html" || die "dist/index.html has no data-preload marker"
links=""
for f in manifest.json index.json tiles-attrs.csv; do
  links+="<link rel=\"preload\" href=\"/data/$LATEST/$f\" as=\"fetch\" crossorigin=\"anonymous\" />"
done
MARKER="$marker" LINKS="$links" node -e '
  const fs = require("fs"); const f = process.argv[1];
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(process.env.MARKER, process.env.LINKS));
' "$web/dist/index.html"
files=$(find "$web/dist" -type f | wc -l | tr -d ' ')
echo "dist: $files files, $(du -sh "$web/dist" | cut -f1)"
[ "$files" -lt 20000 ] || die "Cloudflare Pages allows 20,000 files per deploy; dist has $files"
big=$(find "$web/dist" -type f -size +25M | head -1)
[ -z "$big" ] || die "Cloudflare Pages allows 25 MiB per file: $big"

if [ "$deploy" = 0 ]; then
  echo "--no-deploy: web/dist is staged, nothing uploaded"
  exit 0
fi

step "Deploy to Cloudflare Pages ($PROJECT, branch main)"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && command -v security >/dev/null; then
  CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -f "$root/../typhoon-replay/.env.deploy" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' "$root/../typhoon-replay/.env.deploy" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')
fi
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID WRANGLER_SEND_METRICS=false
sha="$(git -C "$root" rev-parse HEAD)"   # the checked-out commit (CI checks out the gate's commit)
# The deployed commit, for live-check.yml and the check below ("Merged means deployed").
printf '{"sha":"%s","run":"%s"}\n' "$sha" "${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-local}/actions/runs/${GITHUB_RUN_ID:-local}" > "$web/dist/deploy.json"
(cd "$web" && npx --yes wrangler@4 pages deploy dist --project-name "$PROJECT" --branch main \
  --commit-hash "$sha" --commit-dirty=true)

step "Live checks ($LIVE_URL)"
# The home page's hashed entry module (Vite names it after the rollup input, e.g. /assets/main-<hash>.js).
script=$(grep -oE '<script type="module"[^>]* src="/assets/[^"]+\.js"' "$web/dist/index.html" | grep -oE '/assets/[^"]+\.js' | head -1)
[ -n "$script" ] || die "no hashed module script in dist/index.html"
wasm_size=$(wc -c < "$web/dist/wasm/lgu_wasm.wasm" | tr -d ' ')
check() {
  local bust latest home manifest
  bust="t=$(date +%s)"
  latest=$(curl -fsS "$LIVE_URL/data/latest.json?$bust") || return 1
  [ "$(node -p 'JSON.parse(process.argv[1]).version' "$latest")" = "$LATEST" ] || { echo "latest.json: $latest"; return 1; }
  home=$(curl -fsS "$LIVE_URL/?$bust") || return 1
  grep -q "$script" <<<"$home" || { echo "home page does not load $script yet"; return 1; }
  grep -qF "/data/$LATEST/manifest.json" <<<"$home" || { echo "home page does not preload data/$LATEST yet"; return 1; }
  curl -fsS -o /dev/null "$LIVE_URL/embed?$bust" || return 1
  [ "$(curl -fsS "$LIVE_URL/wasm/lgu_wasm.wasm?$bust" | wc -c | tr -d ' ')" = "$wasm_size" ] || { echo "wasm size differs"; return 1; }
  [ "$(curl -fsS "$LIVE_URL/deploy.json?$bust" | node -p 'JSON.parse(require("fs").readFileSync(0)).sha')" = "$sha" ] || { echo "deploy.json is not $sha yet"; return 1; }
  manifest=$(curl -fsS "$LIVE_URL/data/$LATEST/manifest.json?$bust") || return 1
  [ "$(node -p 'JSON.parse(process.argv[1]).version' "$manifest")" = "$LATEST" ] || { echo "manifest is not $LATEST"; return 1; }
}
for i in $(seq 1 12); do
  if check; then
    echo "live: deploy.json is ${sha:0:7}; latest.json is $LATEST; / serves $script; /embed, /wasm/lgu_wasm.wasm and data/$LATEST/manifest.json OK"
    exit 0
  fi
  echo "not live yet (try $i/12), waiting 10 s"
  sleep 10
done
die "the live site does not show this deploy after 2 minutes"
