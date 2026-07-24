#!/usr/bin/env bash
# Produce the three JS/wasm assets the Apple host loads into JSC, from the current
# web wasm build. Outputs land in Sources/EstellaHostKit/Resources/js/ (gitignore'd,
# ABI-tied to the engine you built). Run after `node build-tools/cli.js build -t web`.
#
#   esengine_native.js    global ESEngineModule factory (EXPORT_ES6=0 relink of the
#                          already-compiled objects — no recompile, ~5s)
#   esengine_native.wasm  the engine binary (byte-identical to the web build's wasm)
#   estella-sdk.iife.js   the esengine/native SDK bundled as a global (ESpike)
#
# The relink is derived from the CMake link command so it tracks flag changes; the ONLY
# edits are EXPORT_ES6 1->0 and the output name (REARCH_NATIVE.md §2 "productionize").
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUILD_WEB="$REPO_ROOT/build-web"
LINK_TXT="$BUILD_WEB/CMakeFiles/esengine_sdk.dir/link.txt"
OUT_DIR="$REPO_ROOT/hosts/apple/Sources/EstellaHostKit/Resources/js"
EMPP="$(command -v em++ || true)"

[ -f "$LINK_TXT" ] || { echo "error: $LINK_TXT missing — run: node build-tools/cli.js build -t web" >&2; exit 1; }
[ -n "$EMPP" ] || { echo "error: em++ not on PATH — source your emsdk_env.sh first" >&2; exit 1; }

mkdir -p "$OUT_DIR"

echo "==> [1/3] relink engine glue with EXPORT_ES6=0 (global ESEngineModule factory)"
# Take the recorded link command verbatim, flip EXPORT_ES6 and retarget the output.
RELINK="$(sed -e 's/-sEXPORT_ES6=1/-sEXPORT_ES6=0/' \
              -e 's#-o sdk/esengine.js#-o sdk/esengine_native.js#' "$LINK_TXT")"
( cd "$BUILD_WEB" && eval "$RELINK" )
cp "$BUILD_WEB/sdk/esengine_native.js"   "$OUT_DIR/esengine_native.js"
cp "$BUILD_WEB/sdk/esengine_native.wasm" "$OUT_DIR/esengine_native.wasm"

echo "==> [2/3] bundle the native SDK entry as a global (ESpike)"
ESBUILD="$REPO_ROOT/desktop/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || { echo "error: esbuild not found at $ESBUILD — run pnpm install in desktop/" >&2; exit 1; }
"$ESBUILD" "$REPO_ROOT/sdk/src/index.native.ts" \
    --bundle --format=iife --global-name=ESpike --platform=browser \
    --outfile="$OUT_DIR/estella-sdk.iife.js"

echo "==> [3/3] done — assets in $OUT_DIR"
ls -lh "$OUT_DIR"/esengine_native.js "$OUT_DIR"/esengine_native.wasm "$OUT_DIR"/estella-sdk.iife.js
