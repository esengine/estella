# Estella native host (embedded Dawn + JS engine)

A native iOS/Android runtime for Estella: the **same** engine C++ core and the
same authoring model as the web build, compiled to arm64 and rendering through an
**embedded [Dawn](https://dawn.googlesource.com/dawn)** (WebGPU → Metal on iOS /
Vulkan on Android) — a real native app, **not a WebView**. Game scripts run on an
embedded JS engine ([QuickJS-ng](https://github.com/quickjs-ng/quickjs)); the
engine runs native (full speed), so only the game script is interpreted.

This directory is the reference host + build recipe. Dawn and QuickJS are **not
vendored** (multi-GB); the recipe fetches them, the way Dawn fetches its own deps.
Nothing here is compiled by the web/emscripten build or CI — it is inert until you
run the native build below.

## Why this works (the architecture, proven on device)

The engine is portable by construction; the native seams are small and already in
the tree:

| Seam | Where | What |
|---|---|---|
| Render surface | `WebGPUDevice::configureSurface(NativeSurface)` | `CAMetalLayer*` / `ANativeWindow*` → `WGPUSurface` (commit `bfc495da`) |
| Instance / present | `WebGPUDevice(device, instance)` + `present()` | host shares its instance; flips the swapchain (native-only) |
| GL / text gates | `EstellaContext` under `ES_PLATFORM_WEB` / `ES_ENABLE_BITMAP_TEXT` | native drops the WebGL entry + optional bitmap text |
| Bindings | `python -m eht --native-output` | `es_set_<C>` / `es_<C>_buffer` from the same reflection as the web embind bindings |
| Data marshalling | `sdk/src/ecs/ptrAccessors.generated.ts` | POD components are wasm32/arm64 layout-identical → the generated accessors write native component memory unchanged (via a zero-copy `ArrayBuffer`) |

## Build (Android arm64)

Toolchain: Android SDK + NDK r28 (`android.toolchain.cmake`), SDK CMake ≥ 3.22.

```sh
# 1) Fetch Dawn and build libwebgpu_dawn.so for arm64 (Vulkan).
git clone --depth 1 https://github.com/google/dawn "$DAWN"
python "$DAWN/tools/fetch_dawn_dependencies.py" --shallow   # NOT depot_tools
cmake -S "$DAWN" -B "$DAWN/out-android" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-33 -DANDROID_STL=c++_shared \
  -DDAWN_ENABLE_VULKAN=ON -DDAWN_ENABLE_D3D12=OFF -DDAWN_ENABLE_METAL=OFF \
  -DDAWN_ENABLE_NULL=OFF -DDAWN_ENABLE_OPENGLES=OFF -DDAWN_ENABLE_DESKTOP_GL=OFF \
  -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF -DTINT_BUILD_TESTS=OFF \
  -DDAWN_BUILD_PROTOBUF=OFF -DTINT_BUILD_IR_BINARY=OFF \
  -DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED -DDAWN_FETCH_DEPENDENCIES=OFF
cmake --build "$DAWN/out-android" --target webgpu_dawn

# 2) (JS host only) Fetch QuickJS-ng — core is dtoa/libregexp/libunicode/quickjs.c.
git clone --depth 1 https://github.com/quickjs-ng/quickjs "$QJS"

# 3) (JS host only) Generate the native bindings from the same reflection source.
python -m eht -i src/esengine/ecs/components \
  --native-output "$BUILD/NativeBindings.generated.cpp" \
  --native-components Transform,Sprite,ShapeRenderer,Light2D

# 4) Build the host (see CMakeLists.txt in this dir).
cmake -S native -B "$BUILD" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-33 -DANDROID_STL=c++_shared \
  -DESTELLA_DAWN_DIR="$DAWN" -DESTELLA_DAWN_BUILD="$DAWN/out-android"
cmake --build "$BUILD"
```

Package the APK by hand (no gradle): `aapt2 link` a manifest, inject
`lib/arm64-v8a/{libhost.so,libwebgpu_dawn.so,libc++_shared.so}` (strip Dawn with
`llvm-strip`), `zipalign -f 4`, `apksigner sign`.

## Gotchas (all resolved; each cost a build)

1. Dawn cross-compile wants a host `protoc` — `-DDAWN_BUILD_PROTOBUF=OFF`.
2. CMake 4.x rejects old deps — use the NDK-blessed SDK CMake 3.22.
3. `wgpuInstanceWaitAny` with a timeout needs the instance created with
   `WGPUInstanceFeatureName_TimedWaitAny`, else "no adapter".
4. `ALooper_pollAll` is gone in NDK 28 — use `ALooper_pollOnce`.
5. `configureSwapchain` must use `CompositeAlphaMode::Auto`, not `Opaque` — a
   native Vulkan surface (Adreno) rejects Opaque outright.
6. MIUI blocks `adb install` on a locked screen — unlock + allow USB install.

## Status

Proven end-to-end on device (Snapdragon 8 Elite / Adreno 830, 120 fps): the full
engine renders an ECS scene, a QuickJS game script drives it through the generated
bindings, and the real SDK `ptrAccessors` write native component memory unchanged.
Remaining: load the full SDK bundle + a `BuiltinBridge` memory backend, more
system bindings, and the iOS shell (the Metal surface seam is already in place).
