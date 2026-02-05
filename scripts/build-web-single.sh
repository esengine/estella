#!/bin/bash
set -e

cd "$(dirname "$0")/.."

BUILD_DIR=build-web-single

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

emcmake cmake .. -DES_BUILD_WEB=ON -DES_BUILD_TESTS=OFF -DES_BUILD_SINGLE_FILE=ON -DCMAKE_BUILD_TYPE=Release
emmake make esengine_single -j$(sysctl -n hw.ncpu)

echo ""
echo "Single-file SDK built:"
ls -la sdk/esengine.single.js

echo ""
echo "Bundling playable HTML..."
node "$(dirname "$0")/../tools/bundle-playable.js" --wasm sdk/esengine.single.js --game "$(dirname "$0")/../sdk/examples/playground/build/playable/game.js" --output sdk/playable.html

echo ""
echo "Final output:"
ls -la sdk/playable.html
