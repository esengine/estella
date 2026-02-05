#!/bin/bash
set -e

cd "$(dirname "$0")/.."

BUILD_DIR=build-web

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

emcmake cmake .. -DES_BUILD_WEB=ON -DES_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
emmake make -j$(sysctl -n hw.ncpu)

echo ""
echo "Build complete: $BUILD_DIR/sdk/"
ls -la sdk/

echo ""
echo "Copying to desktop/public/wasm..."
mkdir -p ../desktop/public/wasm
cp -f sdk/esengine.js ../desktop/public/wasm/
cp -f sdk/esengine.wasm ../desktop/public/wasm/
echo "Done!"
