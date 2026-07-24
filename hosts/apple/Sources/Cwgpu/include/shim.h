// Umbrella header exposing the vendored wgpu-native C API (standard webgpu.h + the
// wgpu-native extensions) to Swift as the `Cwgpu` module. Headers live under
// vendor/wgpu-native/include (see Package.swift's headerSearchPath).
#include <webgpu/webgpu.h>
#include <webgpu/wgpu.h>
