#!/usr/bin/env bash
# Build the what-if WASM module (crates/lgu-wasm, raw C ABI) and copy it to web/public/wasm/ (gitignored).
# Low priority and two jobs: the dev machine is a fanless laptop.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/.." && pwd)"
toolchain="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin"
[ -d "$toolchain" ] && export PATH="$toolchain:$PATH"
nice_cmd=()
command -v taskpolicy >/dev/null && nice_cmd=(taskpolicy -b)
(cd "$root" && "${nice_cmd[@]}" cargo build -j 2 --profile wasm --target wasm32-unknown-unknown -p lgu-wasm)
mkdir -p "$here/public/wasm"
cp "$root/target/wasm32-unknown-unknown/wasm/lgu_wasm.wasm" "$here/public/wasm/lgu_wasm.wasm"
ls -l "$here/public/wasm/lgu_wasm.wasm"
