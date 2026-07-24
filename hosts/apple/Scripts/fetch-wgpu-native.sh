#!/usr/bin/env bash
# Fetch the prebuilt native WebGPU implementation (wgpu-native) the host bridge links
# against — the native GPU side of the Fork A render bridge (REARCH_NATIVE.md §3.3.2).
# The binary is large (~40MB unpacked), so it is gitignore'd and reproduced here rather
# than committed. wgpu-native exposes the standard webgpu.h C API over Metal.
#
# Note: this is the HOST bridge's native WebGPU. It is independent of the wasm engine's
# emdawnwebgpu (they meet only at the JS-method level); Fork B's "one Dawn" unification
# is a separate, later concern.
set -euo pipefail

VERSION="v29.0.1.1"
ASSET="wgpu-macos-aarch64-release.zip"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/wgpu-native"
URL="https://github.com/gfx-rs/wgpu-native/releases/download/${VERSION}/${ASSET}"

if [ -f "$DEST/lib/libwgpu_native.a" ] && [ "${1:-}" != "--force" ]; then
    echo "wgpu-native already present at $DEST (pass --force to refetch)"
    exit 0
fi

echo "==> fetching wgpu-native $VERSION ($ASSET)"
mkdir -p "$DEST"
TMP="$(mktemp -t wgpu.XXXXXX.zip)"
curl -sSL --max-time 180 -o "$TMP" "$URL"
unzip -o -q "$TMP" -d "$DEST"
rm -f "$TMP"

# Expose the headers to the Cwgpu SwiftPM module (its include/ is auto-searched).
LINK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/Sources/Cwgpu/include/webgpu"
ln -sfn ../../../vendor/wgpu-native/include/webgpu "$LINK"

echo "==> done:"
ls -lh "$DEST/lib/"*.a "$DEST/lib/"*.dylib "$DEST/include/webgpu/webgpu.h"
echo "    header symlink: $LINK -> $(readlink "$LINK")"
