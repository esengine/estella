# Estella — Apple native host (macOS now, iOS next)

The native mobile host from `docs/REARCH_NATIVE.md` (campaign **N2**): the **same** engine
wasm + TS SDK the web build ships, running on a real native shell with an **embedded JS
engine (JavaScriptCore) + native Dawn (WebGPU)** — **not** a WebView, not a DOM.

This is a **skeleton**: the shell compiles (`swift build`) and already **boots the real
engine in embedded JSC and hits the frame budget** (see below). The one piece that is
deliberately *reserved* is producing pixels through native Dawn — see [Reserved seam](#reserved-seam-n2).

## Status (what runs today)

`EstellaMac` boots the engine in embedded JSC and reproduces the `bench/nojit-frame-bench.mjs`
workload end to end from Swift:

```
$ swift run EstellaMac                    # JIT on
  5000 entities · 600 frames
  ms/frame  median 15.168   → 60fps PASS
$ JSC_useJIT=0 swift run EstellaMac       # iOS no-JIT proxy
  ms/frame  median 15.081   → 60fps PASS
```

Cross-validates the C boot spike (14.98 ms) and the Bun/JSC proxy (17.58 ms) — same ~15 ms
band from a real Swift/AppKit host. `--window` opens a `CAMetalLayer` window and wires the
display link + input; it ticks headlessly until the Dawn provider lands.

## Architecture

One `Package.swift`, two targets:

| Target | Role |
|---|---|
| **EstellaHostKit** (library) | Platform-neutral shell core — shared by macOS and (later) iOS. |
| **EstellaMac** (executable) | AppKit front end: `NSWindow` + `CAMetalLayer` + `CADisplayLink` + input. |

Shell core (`Sources/EstellaHostKit/`):

| File | Responsibility |
|---|---|
| `JSRuntime.swift` | The embedded `JSContext`: host primitives (`__print`/`__now`), run-loop **pump**, Promise **await**, and the C-API `ArrayBuffer`/`Uint8Array` byte bridges (no DOM helpers on a bare JSC). |
| `NativeBridgeHost.swift` | Implements the SDK's `NativeBridge` contract (`sdk/src/platform/native/bridge.ts`) with Foundation — files, `URLSession` fetch, `ImageIO` pixel decode, `UserDefaults` storage, content-addressed cache, and input push. |
| `EngineHost.swift` | Boot orchestration + the injected-render entry (`startRendered`) + the headless bench. |
| `GPUProvider.swift` | The Fork A render-surface injection seam (protocol + the reserved `DawnGPUProvider`). |
| `Resources/js/prelude.js` | Minimal JS-env shims (console/performance/setTimeout queue/atob) for a bare JSC. |
| `Resources/js/boot.js` | The small `EstellaBoot` surface the Swift host drives (instantiate / installPlatform / createHeadless / createRendered / tick / bench). |

### Boot sequence

```
prelude.js → esengine_native.js (glue) → estella-sdk.iife.js (ESpike) → boot.js
   → EstellaBoot.instantiate(wasmBytes)         # async, host pumps the run loop
   → installNativePlatform(NativeBridgeHost)    # the TS SDK's OS capabilities
   → createHeadlessApp | createWebApp(injected surface)
```

### Render-surface injection (the contract this shell targets)

The engine side already landed (`RenderSurfaceSource` explicit `injected` mode +
`WebGPUDevice::adoptSurface` + `Module.preinitializedWebGPUSurface`). The host's job:

1. build a `WGPUSurface` from the `CAMetalLayer` and a `WGPUDevice` via **native Dawn**,
2. register both into the wasm WGPU handle table,
3. set `Module.preinitializedWebGPUDevice` / `preinitializedWebGPUSurface` to the handles,
4. `createWebApp({ renderSurface: { kind: 'webgpu', surface: { from: 'injected' } } })` —
   the engine's `initRendererWebGPU` adopts the injected surface, never touching a DOM.

`boot.js:createRendered` performs steps 3–4; steps 1–2 are `DawnGPUProvider`.

## Reserved seam (N2)

`DawnGPUProvider.makeInjectedHandles` throws today. Finishing it (REARCH_NATIVE.md §3.3.2 —
"the real hard core") means vendoring native Dawn and exposing a native-Dawn-backed WebGPU
implementation to JSC, so the wasm engine (compiled against emdawnwebgpu's JS glue, which
normally targets the browser's `navigator.gpu`) drives native Dawn instead. Everything
around it — window, layer, device/surface injection contract, display link, input, boot —
is in place and waiting on that provider.

## Build & run

Shared prep (both platforms):

```bash
# 1. Build the engine (produces build-web + the web wasm).
node build-tools/cli.js build -t web
# 2. Produce the JS/wasm assets this host loads into JSC (gitignore'd, ABI-tied).
hosts/apple/Scripts/build-js-assets.sh
# 3. Fetch the native WebGPU (wgpu-native) device slices for macOS + iOS (gitignore'd).
hosts/apple/Scripts/fetch-wgpu-native.sh
```

macOS:

```bash
cd hosts/apple
swift run EstellaMac              # headless frame bench (5000 entities @ 60fps)
swift run EstellaMac --engine-native  # real engine drives native wgpu-native (readback-verified)
swift run EstellaMac --window     # the engine renders on-screen to a Metal window
```

iOS (on your iPhone):

```bash
brew install xcodegen            # once
cd hosts/apple/ios
xcodegen                         # regenerate EstellaiOS.xcodeproj from project.yml
open EstellaiOS.xcodeproj        # in Xcode: pick your signing Team, select your device, Run
```

The iOS app (`ios/`) reuses `EstellaHostKit` unchanged; only the window + touch layer is UIKit
(`GameViewController`). The shared core compiles for iOS arm64; the final link + on-device run
happen in your Xcode (which must have the iOS platform component installed).

Requires an active emsdk (`em++` on `PATH`) for step 2, `desktop/node_modules` (esbuild) for
step 2, and network for step 3.
