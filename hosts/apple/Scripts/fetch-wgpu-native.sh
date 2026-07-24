#!/usr/bin/env bash
# Fetch the prebuilt native WebGPU (wgpu-native) the host bridge links against — the native
# GPU side of the Fork A render bridge (REARCH_NATIVE.md §3.3.2). Per-platform device slices
# (macOS + iOS), each into its own vendor dir; the Cwgpu module links the right one by
# platform. Binaries are large + gitignore'd, reproduced here rather than committed.
#
# wgpu-native exposes the standard webgpu.h C API over Metal; it is the HOST bridge's native
# WebGPU, independent of the wasm engine's emdawnwebgpu (Fork B's "one Dawn" is a later concern).
set -euo pipefail

VERSION="v29.0.1.1"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE="${1:-}"

fetch() {   # <asset> <dest-subdir>
    local asset="$1" dest="$BASE/vendor/$2"
    if [ -f "$dest/lib/libwgpu_native.a" ] && [ "$FORCE" != "--force" ]; then
        echo "== $2 already present (pass --force to refetch)"; return
    fi
    echo "==> fetching $asset -> vendor/$2"
    mkdir -p "$dest"
    local tmp; tmp="$(mktemp -t wgpu.XXXXXX.zip)"
    curl -sSL --max-time 180 -o "$tmp" \
        "https://github.com/gfx-rs/wgpu-native/releases/download/${VERSION}/${asset}"
    unzip -o -q "$tmp" -d "$dest"; rm -f "$tmp"
}

fetch "wgpu-macos-aarch64-release.zip" "wgpu-native-macos"
fetch "wgpu-ios-aarch64-release.zip"   "wgpu-native-ios"

# Headers are identical across slices; expose one set to the Cwgpu module (its include/ is
# auto-searched).
ln -sfn ../../../vendor/wgpu-native-macos/include/webgpu "$BASE/Sources/Cwgpu/include/webgpu"

echo "==> done:"
ls -lh "$BASE/vendor/wgpu-native-macos/lib/libwgpu_native.a" "$BASE/vendor/wgpu-native-ios/lib/libwgpu_native.a"
