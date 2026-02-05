#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build-wxgame"
OUTPUT_DIR="$ROOT_DIR/desktop/public/wasm"

echo "=== Building ESEngine for WeChat MiniGame ==="

if ! command -v emcmake &> /dev/null; then
    echo "Error: Emscripten not found. Please install and activate emsdk first:"
    echo "  source /path/to/emsdk/emsdk_env.sh"
    exit 1
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo "Configuring..."
emcmake cmake -DES_BUILD_WXGAME=ON -DCMAKE_BUILD_TYPE=Release "$ROOT_DIR"

echo "Building..."
cmake --build . --target esengine_wxgame -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)

echo "Copying to $OUTPUT_DIR..."
mkdir -p "$OUTPUT_DIR"
cp "$BUILD_DIR/sdk/esengine.wxgame.js" "$OUTPUT_DIR/"
cp "$BUILD_DIR/sdk/esengine.wxgame.wasm" "$OUTPUT_DIR/"

echo "=== Build complete ==="
echo "Output files:"
echo "  - $OUTPUT_DIR/esengine.wxgame.js"
echo "  - $OUTPUT_DIR/esengine.wxgame.wasm"
