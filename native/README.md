# Estella native host (embedded Dawn + JS engine)

A native iOS/Android runtime for Estella: the **same** engine C++ core and the
same authoring model as the web build, compiled to arm64 and rendering through an
**embedded [Dawn](https://dawn.googlesource.com/dawn)** (WebGPU → Metal on iOS /
Vulkan on Android) — a real native app, **not a WebView**. Game scripts run on an
embedded JS engine ([QuickJS-ng](https://github.com/quickjs-ng/quickjs)); the
engine runs native (full speed), so only the game script is interpreted.

This directory holds two reference hosts + the build recipe:

- **`host/`** — a pure-C++ host that renders one ECS scene (no JS). A smoke test
  for the engine core on native Dawn. Always built.
- **`js/`** — the JS host: a QuickJS game script drives the engine through the
  **real esengine SDK**. The SDK is bundled to one file
  (`dist/index.native.bundled.js`, installing `ESEngine`) and the game authors with
  `ESEngine.createNativeWorld()` — the same `World` the web build uses. Built when
  you pass `--quickjs` (this is the product-shaped runtime).

Dawn and QuickJS are **not vendored** (multi-GB / separate project); the recipe
fetches them, the way Dawn fetches its own deps. Nothing here is compiled by the
web/emscripten build or CI — it is inert until you run the native build below.

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
`cli native` locates the SDK / NDK / CMake automatically (`ANDROID_HOME`, or
Android Studio's default install) and drives `native/CMakeLists.txt`.

**One-time: build Dawn for arm64** (Vulkan). Multi-GB; kept out of the tree.

```sh
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
```

**Build the hosts** through the orchestrated task:

```sh
# C++ host only.
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android"

# + JS host: build the SDK bundle first (produces the QuickJS-loadable
# dist/index.native.bundled.js), clone QuickJS-ng (core is
# dtoa/libregexp/libunicode/quickjs.c), and pass --quickjs. The task generates,
# into build-native/gen/ (never committed, so nothing can drift from its source):
#   * NativeBindings.generated.cpp — from the SAME reflection as the web bindings
#     (python -m eht --native-output ... --native-only)
#   * esengine_bundle.h — the real SDK bundle embedded as a C string
(cd sdk && pnpm run build)
git clone --depth 1 https://github.com/quickjs-ng/quickjs "$QJS"
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" --quickjs "$QJS"
```

Paths may also come from `ESTELLA_DAWN_DIR` / `ESTELLA_DAWN_BUILD` /
`ESTELLA_QUICKJS_DIR`. Outputs: `build-native/libestella_host.so`, and with
`--quickjs`, `build-native/libestella_js_host.so`.

Package the APK by hand (no gradle): `aapt2 link` the matching manifest
(`host/` or `js/AndroidManifest.xml`), inject
`lib/arm64-v8a/{libestella*_host.so,libwebgpu_dawn.so,libc++_shared.so}` (strip
Dawn with `llvm-strip`), `zipalign -f 4`, `apksigner sign`.

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

The engine core + render path are proven on device (Snapdragon 8 Elite / Adreno
830, 120 fps). The JS host runs the **real SDK**: `ESEngine.createNativeApp()`
returns the same `App` + `World` the web build uses, connected to the native core
through the generated registry + memory backend; the host binds the entity /
hierarchy / component functions the SDK reads off `globalThis`, plus the input and
texture bindings.

System bindings (Stage B) landing incrementally through the real SDK surfaces:

- **Input** — host touch → the SDK's `inputPlugin` → the `Input` resource (device-verified).
- **Assets** — `ESEngine.Assets.loadTexture(path)` runs the SAME asset pipeline the
  web build uses: the platform decodes the image (`bridge.loadImagePixels`) and the
  **native ResourceManager** (`createNativeResourceManager`, over the host's
  `es_createTexture` / `es_releaseTexture` / `es_getTextureDimensions`) uploads the
  bytes directly — no wasm heap. `game.js` now loads its logo through this channel
  instead of a hand-rolled `es_createTexture`.

Remaining: audio, lifecycle, and the cooked-asset manifest (import settings / KTX2 /
atlases) that the editor's native-export pipeline will ship (Stage C); then the iOS
shell (the Metal surface seam is already in place).
