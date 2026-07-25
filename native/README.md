# Estella native host (embedded Dawn + JS engine)

A native iOS/Android runtime for Estella: the **same** engine C++ core and the
same authoring model as the web build, compiled to arm64 and rendering through an
**embedded [Dawn](https://dawn.googlesource.com/dawn)** (WebGPU → Metal on iOS /
Vulkan on Android) — a real native app, **not a WebView**. Game scripts run on an
embedded JS engine ([QuickJS-ng](https://github.com/quickjs-ng/quickjs)); the
engine runs native (full speed), so only the game script is interpreted.

This directory holds the host and the build recipe:

- **`host/`** — the app. A QuickJS runtime drives the engine through the **real
  esengine SDK**, bundled to one file (`dist/index.native.bundled.js`, installing
  `ESEngine`); an editor export boots on it through the same `App` and `World` the
  web build uses. One host with a platform seam, not one per OS:
  - `Host.{hpp,cpp}` — the contract a platform implements (`eshost::Platform`) and
    the entry points its event loop drives: boot, the frame, lifecycle.
  - `Runtime.{hpp,cpp}` — the QuickJS runtime and the state the host shares: the
    environment the language does not ship (console, timers, a clock), the eval +
    bytecode cache, and the layered boot (SDK bundle → bootstrap → project).
  - `bootstrap.js` — the host's own JavaScript (the bridge install and the default
    init/update), embedded at build time. A real .js file, not a C++ literal.
  - `bindings/` — the `es_*` surface, one TU per pillar (Ecs, Render, Assets,
    Audio, Net). Only what cannot be generated; see below.
  - `EsnShim.cpp` + `esn_shim.hpp` — what the GENERATED bindings call: the engine
    singletons, entity round-tripping, the JS value readers.
  - `media/` — glyph rasterization, KTX2 transcode, the miniaudio engine.
  - `platform/android.cpp` — NativeActivity, APK assets, Vulkan, the ALooper loop.
  - `platform/ios.mm` — a CAMetalLayer view, bundle assets, Metal, CADisplayLink.
- **`android/`** — the APK manifest, packaged by `--package`.
- **`ios/`** — the Xcode app shell (xcodegen) that signs and packages the iOS
  build. It is only an entry point; the app lives in the static library.

There is no built-in demo game and no second, JS-free host. What runs is an editor
export, always: a parallel content path drifts from the one every real game takes,
and boot already separates the layers — the engine core, Dawn and the surface are
all up (and logged) before the first line of JS runs, so a failure names its own
layer.

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
| GL gate | `EstellaContext` under `ES_PLATFORM_WEB` | native drops the WebGL entry |
| Glyph source | `Platform::loadFont` + `host/media/glyph_raster.cpp` | the device has no 2D canvas: the OS names a font file, stb_truetype rasterizes, the engine's own `sdfFromAlpha` encodes |
| Bindings | `python -m eht --native-output` | `es_set_<C>` / `es_<C>_buffer` from the same reflection as the web embind bindings |
| Entry points | `python -m eht --native-functions` | `es_renderer_*`, `es_uiLayout_*`, `es_rm_*` — QuickJS wrappers over the SAME `bindings/*.hpp` declarations embind registers |
| Data marshalling | `sdk/src/ecs/ptrAccessors.generated.ts` | POD components are wasm32/arm64 layout-identical → the generated accessors write native component memory unchanged (via a zero-copy `ArrayBuffer`) |
| Host platform | `eshost::Platform` (`host/Host.hpp`) | packaged assets, cache dir, backend, window surface + size, log — the only things the two OS glue files answer differently |

### What is hand-written, and why

The `es_*` globals the SDK reads off `globalThis` are mostly GENERATED, from the
declarations embind registers on the web — so one implementation serves both
platforms, and both get its `BoundarySpan` validation. `native/host/bindings/`
holds only what has no generated form:

| Kept by hand | Why |
|---|---|
| entity + hierarchy | the web reaches the registry as an embind **class**; no binding header declares this surface |
| KTX2 transcode, glyph rasterization | native-only — the web decodes with WebGL2 + a wasm transcoder, and rasterizes on a 2D canvas |
| surface size, camera list, texture dimensions | their web siblings return an `emscripten::val`, which the boundary cannot marshal |
| assets, fetch, audio, cache, UTF-8, console/timers | the host's answer to what a browser hands the web build for free. There is nothing in the engine to generate them from |

Everything else — the frame, the UI layout, the whole texture surface, the text
batch — comes from EHT. Adding an entry point to a `bindings/*.hpp` is all it
takes for the device to have it.

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

**Build the host** through the orchestrated task. Build the SDK bundle first (it
produces the QuickJS-loadable `dist/index.native.bundled.js`), clone QuickJS-ng
(core is dtoa/libregexp/libunicode/quickjs.c), and pass `--quickjs`:

```sh
(cd sdk && pnpm run build)
git clone --depth 1 https://github.com/quickjs-ng/quickjs "$QJS"
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" --quickjs "$QJS"
```

The task generates, into `build-native/gen/` (never committed, so nothing can
drift from its source):

* `NativeBindings.generated.cpp` — per-component accessors, from the SAME
  reflection as the web bindings (`eht --native-output ... --native-only`)
* `NativeFunctionBindings.generated.cpp` — the engine's binding entry points, from
  the same `bindings/*.hpp` declarations embind registers (`eht --native-functions`)
* `esengine_bundle.h` / `host_bootstrap.h` — the real SDK bundle and the host
  bootstrap, embedded as C strings

Paths may also come from `ESTELLA_DAWN_DIR` / `ESTELLA_DAWN_BUILD` /
`ESTELLA_QUICKJS_DIR`. Output: `build-native/libestella_js_host.so`.

**Package a signed APK** by adding `--package` — the Android counterpart of what
Xcode does for `native/ios`, and still no gradle (a NativeActivity has no Java):

```sh
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" \
  --quickjs "$QJS" --package --content dist-android
adb install -r build-native/estella-js-host.apk
```

It runs `aapt2 link` over `native/android/host/AndroidManifest.xml` to produce the
base APK from the manifest, then adds the payload with `jar`:
`lib/arm64-v8a/{libestella*_host.so,libwebgpu_dawn.so,libc++_shared.so}` (Dawn
stripped with the NDK's `llvm-strip`) and the exported project under `assets/`,
where the host's `readAsset()` looks. Then `zipalign -f 4` and `apksigner sign`.
Signing uses the Android debug keystore — created on first use — unless you pass
`--keystore`. The JDK those steps need is located the way the SDK and NDK are
(`JAVA_HOME`, or the one Android Studio bundles); `--jdk <dir>` overrides.

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
iOS — the app *is* the host, so `--quickjs` is required:

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
packaging shell: `App/main.m` calls `EstellaRunApp()`, and the exported project
ships as bundle resources — the same project-relative paths the APK serves from
`assets/`.

## Shipping a project

A game comes out of the editor. **Package Project → Android** (or **→ iOS**, or
`exportGame({ platform: 'android' })`) writes the cooked assets, both manifests,
the scenes and `game.config.json` — content only, since the engine, the SDK and
the game runtime all ship inside the app binary. Both platforms write the SAME
payload; what differs is the toolchain that wraps it, which is why they are two
rows in the dialog rather than one "mobile". Pass that directory to the build and
it becomes the app's content:

```sh
# Android: it becomes the APK's assets/
node build-tools/cli.js native --dawn "$DAWN" --dawn-build "$DAWN/out-android" \
  --quickjs "$QJS" --package --content dist-android

# iOS: it stages into native/ios/Content (a folder reference), then rebuild in Xcode
node build-tools/cli.js native --target ios --dawn "$DAWN" \
  --dawn-build "$DAWN/out-ios" --quickjs "$QJS" --content dist-ios
```

`game.config.json` is what the host boots, through `ESEngine.initNativeGame`;
without one it says so and stops, rather than falling back to something a real
game never runs. A project's own scripts (`defineComponent` / `defineSystem`)
bundle to `scripts.js` and evaluate before the scene loads, bound to the host's
SDK instance.

## Gotchas (all resolved; each cost a build)

1. Dawn cross-compile wants a host `protoc` — `-DDAWN_BUILD_PROTOBUF=OFF`.
2. CMake 4.x rejects old deps — use the NDK-blessed SDK CMake 3.22.
3. `wgpuInstanceWaitAny` with a timeout needs the instance created with
   `WGPUInstanceFeatureName_TimedWaitAny`, else "no adapter".
4. `ALooper_pollAll` is gone in NDK 28 — use `ALooper_pollOnce`.
5. `configureSwapchain` must use `CompositeAlphaMode::Auto`, not `Opaque` — a
   native Vulkan surface (Adreno) rejects Opaque outright.
6. MIUI blocks `adb install` on a locked screen — unlock + allow USB install. It
   also blocks `adb shell input keyevent`, so a dozing screen cannot be woken from
   the host: a screenshot then reads back all black and the frame loop is
   legitimately stopped (the surface is gone). Unlock before you conclude anything
   about rendering.
7. `aapt2 link -A <dir>` on Windows writes nested asset paths with backslashes
   (`assets/assets\scenes\x`), and a zip entry name must use forward slashes — so
   `AAssetManager` cannot open anything in a subdirectory. The packaging step adds
   `assets/` with `jar` instead, which writes them correctly.
7. Xcode ships the iPhoneOS **SDK** without the device **platform** components, so
   the CMake build works while `xcodebuild` rejects every iOS destination
   ("iOS X.Y is not installed"). Install it under *Xcode → Settings → Components*.
   Without it you can still verify the link by hand:
   `xcrun --sdk iphoneos clang -arch arm64 -mios-version-min=17.0 native/ios/App/main.m build-native-ios/libestella_ios.a -ObjC -lc++ -framework UIKit -framework Metal -framework QuartzCore -framework Foundation -framework IOSurface -framework CoreGraphics -o /tmp/EstellaiOS`

## Status

**Android** is proven on device (Snapdragon 8 Elite / Adreno 830) running an
**editor export**: the camera-follow example, packaged with **Package Project →
Android** and shipped by `--package --content`, renders its world at a
vsync-locked 120 fps and boots in ~57 ms (Dawn + EstellaContext 35 ms, then the
SDK bundle off its bytecode cache).

**iOS** runs in the simulator at a steady 60 fps, booting in ~20 ms off the
bytecode cache; an exported project loads from its cooked content and renders.
Not yet run on a physical device, which needs your signing.

The engine core + render path are proven on device. The host runs the **real
SDK**: `ESEngine.createNativeApp()` returns the same `App` + `World` the web build
uses, connected to the native core through the generated registry + memory
backend; the host binds only what cannot be generated (see above), and the rest —
the frame, the UI layout, the texture surface, the text batch — reaches the engine
through wrappers over the same declarations embind registers.

System bindings landing incrementally through the real SDK surfaces:

- **Input** (Stage B) — host touch → the SDK's `inputPlugin` → the `Input` resource (device-verified).
- **Assets** (Stage B) — `ESEngine.Assets.loadTexture(path)` runs the SAME asset pipeline the
  web build uses: the platform decodes the image (`bridge.loadImagePixels`) and the
  **native ResourceManager** (`createNativeResourceManager`) uploads the bytes
  directly — no wasm heap — through the engine's OWN `rm_createTextureEx`, the same
  entry point embind exposes to the web. Cooked-asset import settings (filter /
  wrap, from a scene's `textureImporterSettings`) flow through the shared runtime
  loader into that one implementation, so pixel-art stays crisp on device by the
  same code that keeps it crisp in a browser.
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
  device natively (correct even while the JS tick is paused). Memory pressure
  (`eshost::memoryWarning`, iOS `didReceiveMemoryWarning` / Android `APP_CMD_LOW_MEMORY`) →
  the SDK's residency caches trim (the audio buffer cache). Simulator-verified across a
  background/foreground cycle.
- **Networking** — `bridge.fetch` runs a real HTTP request through `es_fetch`
  (`Platform::startFetch`): iOS `NSURLSession`, Android a JNI `HttpURLConnection` on a
  detached thread — the OS owns the TLS stack, so this is one seam that legitimately
  differs per platform. Replies cross back thread-safely (`deliverFetch`) and run on the JS
  thread in the frame loop. This is what remote asset groups and hot-update need. Simulator-
  verified (an HTTPS GET returns bytes and a 200); the Android path needs a device retest.
- **Text** (Stage C) — the same `Text` component, glyph atlas, layout and batching the web
  build runs. Only the two ends cross the seam: the device has no 2D canvas to rasterize a
  glyph on, so the host does it (`es_rasterizeGlyph` → `glyph_raster.cpp`: the OS names the
  font file, stb_truetype rasterizes the outline, and the engine's OWN `text::sdfFromAlpha`
  encodes the field, so the shared SDF shader samples identically encoded tiles on both
  platforms); and there is no wasm heap to marshal the laid-out quads through, so the host
  takes the typed arrays and calls `RenderFrame::submitTextBatch` itself (`es_submitTextBatch`,
  run from `es_jsPreFlush` between collecting the scene and flushing it — where the web
  pipeline runs the same callbacks). Picking the font file is the only per-OS part: Android's
  `AFontMatcher` and iOS's Core Text, both of which fall back per codepoint, so CJK resolves
  without a hard-coded path. Device-verified on Android (Latin + CJK, SDF). The C++
  `BitmapText` path compiles natively too (`ES_ENABLE_BITMAP_TEXT` is on — nothing in
  `src/esengine/text` needs freetype or msdfgen).
- **KTX2 / compressed textures** — `Assets.loadTexture` on a `.ktx2` path transcodes with
  the host's vendored basis_universal (`es_createTextureKTX2` → `ktx2_decode.cpp`) to the
  best format the device supports (ASTC → ETC2 → BC, RGBA32 fallback) and uploads the
  compressed blocks through the engine's now-real `WebGPUDevice::createCompressedTexture` —
  4–8× less VRAM than RGBA8. The web KTX2 path (WebGL2 + wasm transcoder) is untouched.
  Simulator-verified (a 64×64 KTX2 sprite renders); base mip only for now.

Remaining: hardening on a physical device (audio output, the background/foreground
transition, Android's miniaudio audio + JNI fetch paths), and the subsystems this build
still leaves out — tilemaps, particles and post-processing (their `ES_ENABLE_*` sources),
plus physics / Spine / video, which ship as emscripten side modules with no native
counterpart yet. An export names them: **Package Project → Mobile** warns about any of them
a scene uses rather than shipping a package that quietly renders half of it (the gaps are
declared in `desktop/src/project/targetSupport.ts`, checked against this CMakeLists by
`desktop/tests/target-support.test.ts`).
