# Estella native host (embedded Dawn + JS engine)

A native iOS/Android runtime for Estella: the **same** engine C++ core and the
same authoring model as the web build, compiled to arm64 and rendering through an
**embedded [Dawn](https://dawn.googlesource.com/dawn)** (WebGPU → Metal on iOS /
Vulkan on Android) — a real native app, **not a WebView**. Game scripts run on an
embedded JS engine ([QuickJS-ng](https://github.com/quickjs-ng/quickjs)); the
engine runs native (full speed), so only the game script is interpreted.

This directory holds two reference hosts + the build recipe:

- **`host_cpp/`** — a pure-C++ host that renders one ECS scene (no JS). A smoke test
  for the engine core on native Dawn. Android only; always built there.
- **`host_js/`** — the JS host: a QuickJS game script drives the engine through the
  **real esengine SDK**. The SDK is bundled to one file
  (`dist/index.native.bundled.js`, installing `ESEngine`) and the game authors with
  `ESEngine.createNativeWorld()` — the same `World` the web build uses. Built when
  you pass `--quickjs` (this is the product-shaped runtime). It is one host with a
  platform seam, not one per OS:
  - `host_js/host_core.{hpp,cpp}` — Dawn bring-up, the `es_*` bindings, the SDK bundle
    and the frame. Platform-independent; everything that differs sits behind
    `eshost::Platform`.
  - `host_js/main_android.cpp` — NativeActivity, APK assets, Vulkan, the ALooper loop.
  - `host_js/main_ios.mm` — a CAMetalLayer view, bundle assets, Metal, CADisplayLink.
- **`android/`** — the APK manifests (`host_cpp/`, `host_js/`), packaged by `--package`.
- **`ios/`** — the Xcode app shell (xcodegen) that signs and packages the iOS
  build. It is only an entry point; the app lives in the static library.

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
| Host platform | `eshost::Platform` (`host_js/host_core.hpp`) | packaged assets, cache dir, backend, window surface + size, log — the only things the two OS glue files answer differently |

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

**Package a signed APK** by adding `--package` — the Android counterpart of what
Xcode does for `native/ios`, and still no gradle (a NativeActivity has no Java):

```sh
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" \
  --quickjs "$QJS" --package            # --host cpp for the smoke-test APK
adb install -r build-native/estella-js-host.apk
```

It runs `aapt2 link` over `native/android/host_{js,cpp}/AndroidManifest.xml`, stages
`lib/arm64-v8a/{libestella*_host.so,libwebgpu_dawn.so,libc++_shared.so}` (Dawn
stripped with the NDK's `llvm-strip`), packs the game and its content into
`assets/` where the host's `readAsset()` looks, then `zipalign -f 4` and
`apksigner sign`. Signing uses the Android debug keystore — created on first use —
unless you pass `--keystore`.

## Build (iOS arm64)

Toolchain: Xcode (the Command Line Tools alone have no iPhoneOS SDK — `cli native`
falls back to `/Applications/Xcode.app` automatically), CMake ≥ 3.22, Ninja, and
[xcodegen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

**One-time: build Dawn for iOS arm64** (Metal, *static* — an app embeds it). Same
checkout as the Android build; only the output dir differs. ~5 min, 744 targets,
a 19 MB `libwebgpu_dawn.a`:

```sh
cmake -S "$DAWN" -B "$DAWN/out-ios" -G Ninja \
  -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=17.0 -DCMAKE_OSX_SYSROOT=iphoneos \
  -DDAWN_ENABLE_METAL=ON -DDAWN_ENABLE_VULKAN=OFF -DDAWN_ENABLE_D3D12=OFF \
  -DDAWN_ENABLE_NULL=OFF -DDAWN_ENABLE_OPENGLES=OFF -DDAWN_ENABLE_DESKTOP_GL=OFF \
  -DDAWN_BUILD_SAMPLES=OFF -DDAWN_BUILD_TESTS=OFF -DTINT_BUILD_TESTS=OFF \
  -DDAWN_BUILD_PROTOBUF=OFF -DTINT_BUILD_IR_BINARY=OFF \
  -DDAWN_BUILD_MONOLITHIC_LIBRARY=STATIC -DDAWN_FETCH_DEPENDENCIES=OFF
cmake --build "$DAWN/out-ios" --target webgpu_dawn
```

**Build the host, then run it from Xcode.** There is no pure-C++ reference host on
iOS — the app *is* the JS host, so `--quickjs` is required:

```sh
(cd sdk && pnpm run build)
node build-tools/cli.js native --target ios \
  --dawn "$DAWN" --dawn-build "$DAWN/out-ios" --quickjs "$QJS"

cd native/ios && xcodegen && open EstellaiOS.xcodeproj
```

**To run in the simulator** — a different target triple, so it needs its own Dawn
and its own slice (`-DCMAKE_OSX_SYSROOT=iphonesimulator` on the Dawn command
above, into `$DAWN/out-ios-sim`):

```sh
node build-tools/cli.js native --target ios --simulator \
  --dawn "$DAWN" --dawn-build "$DAWN/out-ios-sim" --quickjs "$QJS"
```

Both slices land in `build-native-ios/Estella.xcframework`, which is what the app
links — Xcode picks the one matching the toolbar. arm64 only, so an Intel Mac's
simulator would need a third Dawn.

Then pick your Team under *Signing & Capabilities*, select your device and Run.
The CMake build merges host + engine + QuickJS + Dawn into one archive
(`build-native-ios/libestella_ios.a`), so the Xcode project is a signing and
packaging shell: `App/main.m` calls `EstellaRunApp()`, and the game (`host_js/game.js`,
`host_js/logo.png`) ships as bundle resources — the same project-relative paths the APK
serves from `assets/`.

## Shipping a project (Stage C)

The demo above is a hand-written `game.js`. A real game comes out of the editor:
**Package Project → Mobile** (or `exportGame({ platform: 'native' })`) writes the
cooked assets, both manifests, the scenes and `game.config.json` — content only,
since the engine, the SDK and the game runtime all ship inside the app binary.
Pass that directory to the build and it becomes the app's content:

```sh
# Android: it becomes the APK's assets/
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" \
  --quickjs "$QJS" --package --content dist-native

# iOS: it stages into native/ios/Content (a folder reference), then rebuild in Xcode
node build-tools/cli.js native --target ios --dawn "$DAWN" \
  --dawn-build "$DAWN/out-ios" --quickjs "$QJS" --content dist-native
```

The host decides which it is from what it finds: `game.config.json` boots the
exported project through `ESEngine.initNativeGame`, otherwise `game.js` runs. A
project's own scripts (`defineComponent` / `defineSystem`) bundle to `scripts.js`
and evaluate before the scene loads, bound to the host's SDK instance.

## Gotchas (all resolved; each cost a build)

1. Dawn cross-compile wants a host `protoc` — `-DDAWN_BUILD_PROTOBUF=OFF`.
2. CMake 4.x rejects old deps — use the NDK-blessed SDK CMake 3.22.
3. `wgpuInstanceWaitAny` with a timeout needs the instance created with
   `WGPUInstanceFeatureName_TimedWaitAny`, else "no adapter".
4. `ALooper_pollAll` is gone in NDK 28 — use `ALooper_pollOnce`.
5. `configureSwapchain` must use `CompositeAlphaMode::Auto`, not `Opaque` — a
   native Vulkan surface (Adreno) rejects Opaque outright.
6. MIUI blocks `adb install` on a locked screen — unlock + allow USB install.
7. Xcode ships the iPhoneOS **SDK** without the device **platform** components, so
   the CMake build works while `xcodebuild` rejects every iOS destination
   ("iOS X.Y is not installed"). Install it under *Xcode → Settings → Components*.
   Without it you can still verify the link by hand:
   `xcrun --sdk iphoneos clang -arch arm64 -mios-version-min=17.0 native/ios/App/main.m build-native-ios/libestella_ios.a -ObjC -lc++ -framework UIKit -framework Metal -framework QuartzCore -framework Foundation -framework IOSurface -framework CoreGraphics -o /tmp/EstellaiOS`

## Status

**Android** is proven on device (Snapdragon 8 Elite / Adreno 830, 120 fps).
**iOS** runs: the demo renders in the simulator at a steady 60 fps — the clear
colour, a ShapeRenderer and `logo.png` loaded through the real `Assets.loadTexture`
pipeline — booting in ~20 ms off the bytecode cache. An **exported project** runs
too: the camera-follow example's scene loads from its cooked content and renders.
Not yet run on a physical device, which needs your signing.

The engine core + render path are proven on device. The JS host runs the **real
SDK**: `ESEngine.createNativeApp()`
returns the same `App` + `World` the web build uses, connected to the native core
through the generated registry + memory backend; the host binds the entity /
hierarchy / component functions the SDK reads off `globalThis`, plus the input and
texture bindings.

System bindings landing incrementally through the real SDK surfaces:

- **Input** (Stage B) — host touch → the SDK's `inputPlugin` → the `Input` resource (device-verified).
- **Assets** (Stage B) — `ESEngine.Assets.loadTexture(path)` runs the SAME asset pipeline the
  web build uses: the platform decodes the image (`bridge.loadImagePixels`) and the
  **native ResourceManager** (`createNativeResourceManager`, over the host's
  `es_createTexture` / `es_releaseTexture` / `es_getTextureDimensions`) uploads the
  bytes directly — no wasm heap. `game.js` now loads its logo through this channel
  instead of a hand-rolled `es_createTexture`.
- **Audio** (Stage C) — `ESEngine.Audio.playSFX` / `playTrack` runs the SAME Audio API the
  web build uses. The engine is [miniaudio](https://miniaud.io) (CoreAudio on iOS,
  AAudio/OpenSL on Android): it decodes and mixes natively, so nothing per-sample runs
  in JS — the no-JIT budget forbids that. `NativeAudioBackend` is a thin SDK shell over the
  host's `es_audio*` engine (`native_audio.cpp`), mirroring the WeChat backend over
  InnerAudioContext; `mixer` is null (per-voice volume/pan/rate/loop, no JS DSP graph).
  The engine is playback-only (no microphone). Bound only when a device comes up, so a
  host without one stays silent (the Null backend). Simulator-verified: a clip decodes and
  plays (isPlaying true).
- **Lifecycle** (Stage C) — the glue pushes foreground/background (`eshost::setVisible`) →
  the SDK's Lifecycle plugin auto-pauses the game, and the host suspends/resumes the audio
  device natively (correct even while the JS tick is paused). Simulator-verified across a
  background/foreground cycle.

Remaining: the cooked-asset import settings (sampler filter/wrap, KTX2/atlas nuances)
the export pipeline will thread through, and hardening on a physical device (audio
output, the background/foreground transition, Android's miniaudio AAudio path).
