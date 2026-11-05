#!/bin/bash
# The engine's picture of a GI lab scene: <out>/engine_<name>.png.
# usage: gi-run.sh <lab> [name]     env: BACKEND (webgl2|webgpu)  EFFECTS (json list)  Q  BAKE=1  OUT  WAIT (ms, default 12000)
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -W)"
ROOT="$(cd "$HERE/../.." && pwd -W)"
OUT="${OUT:-$ROOT/output/render-lab/gi}"
mkdir -p "$OUT"
LAB=$1; NAME=${2:-$LAB}
P="$OUT/proj_$NAME"
rm -rf "$P" "$OUT/web_$NAME"
python "$HERE/gi_project.py" "$P" "$LAB" > /dev/null
cd "$ROOT"
node tools/asset-meta.js "$P/assets" > /dev/null 2>&1
if [ "$BAKE" = "1" ]; then
  node pipeline/bin/estella.mjs bake-scene "$P/assets/scenes/lab.esscene" 2>&1 | tail -3
  node tools/asset-meta.js "$P/assets" > /dev/null 2>&1
  node pipeline/bin/estella.mjs bake-scene "$P/assets/scenes/lab.esscene" 2>&1 | tail -3
  node tools/asset-meta.js "$P/assets" > /dev/null 2>&1
fi
node pipeline/bin/estella.mjs export "$P" --out "$OUT/web_$NAME" 2>&1 | grep -E '"ok"|error' | head -2
node "$HERE/shot.mjs" "$OUT" "$OUT/web_$NAME" "$NAME" 2>&1 | grep -E "error|ERROR|warn|context" | head -8 | cut -c1-240 || true
mv "$OUT/lab-$NAME.png" "$OUT/engine_$NAME.png"
echo "engine_$NAME.png written to $OUT"
