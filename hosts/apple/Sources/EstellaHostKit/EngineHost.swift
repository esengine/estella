import Foundation
import QuartzCore
import JavaScriptCore

/// The headless frame-budget result (ports bench/nojit-frame-bench.mjs).
public struct BenchResult {
    public let entities: Int, frames: Int
    public let median: Double, p95: Double, min: Double, mean: Double
    public let pass60: Bool, pass30: Bool
}

/// Locations of the five JS/wasm assets the host loads into JSC. The two committed glue
/// files come from the bundle; the built engine assets are produced by
/// Scripts/build-js-assets.sh (gitignore'd) and default to the same bundle directory.
public struct EngineAssets {
    public var prelude: URL, engineGlue: URL, sdkBundle: URL, boot: URL, probe: URL, wasm: URL

    /// Resolve every asset from `EstellaHostKit`'s resource bundle (subdirectory `js`).
    public static func bundled() throws -> EngineAssets {
        func u(_ name: String, _ ext: String) throws -> URL {
            guard let url = Bundle.module.url(forResource: name, withExtension: ext, subdirectory: "js") else {
                throw HostError.assetMissing("\(name).\(ext) — run hosts/apple/Scripts/build-js-assets.sh")
            }
            return url
        }
        return EngineAssets(prelude: try u("prelude", "js"), engineGlue: try u("esengine_native", "js"),
                            sdkBundle: try u("estella-sdk.iife", "js"), boot: try u("boot", "js"),
                            probe: try u("webgpu-probe", "js"), wasm: try u("esengine_native", "wasm"))
    }
}

/// Drives the boot sequence from Swift, calling the small `EstellaBoot` surface (boot.js).
/// Mirrors the proven embedded-JSC spike: prelude → engine glue → SDK bundle → boot glue →
/// instantiate wasm → install the native platform → run.
public final class EngineHost {
    private let rt: JSRuntime
    private let bridgeHost: NativeBridgeHost
    private var estellaBoot: JSValue?

    public init(runtime: JSRuntime, bridge: NativeBridgeHost) {
        self.rt = runtime
        self.bridgeHost = bridge
    }

    /// Evaluate all glue, instantiate the engine wasm, and install the native platform.
    public func boot(assets: EngineAssets) throws {
        for (url, label) in [(assets.prelude, "prelude.js"), (assets.engineGlue, "esengine_native.js"),
                             (assets.sdkBundle, "estella-sdk.iife.js"), (assets.probe, "webgpu-probe.js"),
                             (assets.boot, "boot.js")] {
            let src = try String(contentsOf: url, encoding: .utf8)
            rt.evaluate(src, name: label)
        }
        guard let boot = rt.global("EstellaBoot") else { throw HostError.bootFailure("EstellaBoot missing after glue eval") }
        estellaBoot = boot

        // invokeMethod binds `this` to EstellaBoot (JSValue.call would leave it unbound).
        let wasm = try Data(contentsOf: assets.wasm)
        let promise = boot.invokeMethod("instantiate", withArguments: [rt.makeArrayBuffer(wasm)])!
        try rt.await(promise)

        _ = boot.invokeMethod("installPlatform", withArguments: [bridgeHost.makeBridgeObject()])
    }

    /// Reproduce the 5000-entity frame-budget bench in embedded JSC, end to end from Swift.
    public func runHeadlessBench(entities: Int = 5000, frames: Int = 600, warm: Int = 120) throws -> BenchResult {
        guard let boot = estellaBoot else { throw HostError.bootFailure("not booted") }
        let promise = boot.invokeMethod("runHeadlessBench", withArguments: [entities, frames, warm])!
        let r = try rt.await(promise, timeout: 120)
        func d(_ k: String) -> Double { r.objectForKeyedSubscript(k)?.toDouble() ?? 0 }
        func b(_ k: String) -> Bool { r.objectForKeyedSubscript(k)?.toBool() ?? false }
        return BenchResult(entities: entities, frames: frames, median: d("median"), p95: d("p95"),
                           min: d("min"), mean: d("mean"), pass60: b("pass60"), pass30: b("pass30"))
    }

    /// Run the real engine's WebGPU render init (+ one frame) against the logging WebGPU proxy
    /// and return its status. The captured `[wgpu] …` lines are the native-Dawn-backend spec.
    @discardableResult
    public func probeRenderInit(width: Int = 960, height: Int = 640) throws -> String {
        guard let boot = estellaBoot else { throw HostError.bootFailure("not booted") }
        let promise = boot.invokeMethod("probeRenderInit", withArguments: [width, height])!
        return try rt.await(promise, timeout: 60).toString()
    }

    /// Bring up the rendered path: ask the provider for injected device/surface handles, then
    /// create the app whose renderer adopts the injected surface. Throws `.reserved` until the
    /// native Dawn provider (N2) lands — the caller falls back to `runHeadlessBench`.
    public func startRendered(provider: GPUProvider, layer: CAMetalLayer, width: Int, height: Int) throws {
        guard let boot = estellaBoot else { throw HostError.bootFailure("not booted") }
        let handles = try provider.makeInjectedHandles(for: layer, width: width, height: height)
        _ = boot.invokeMethod("createRendered", withArguments: [handles.device, handles.surface, width, height])
    }

    public func spawnDemo(_ n: Int) {
        _ = estellaBoot?.invokeMethod("spawnDemo", withArguments: [n])
    }

    /// Create the app in WebGPU canvas mode with the given bridge device object injected — the
    /// engine's renderer then drives native wgpu-native through the bridge.
    public func renderNative(deviceObject: JSValue, width: Int, height: Int) throws {
        guard let boot = estellaBoot else { throw HostError.bootFailure("not booted") }
        _ = boot.invokeMethod("renderNative", withArguments: [deviceObject, width, height])
    }

    /// Advance one frame (pumps until the tick Promise settles).
    public func tick(_ dt: Double) throws {
        guard let boot = estellaBoot else { throw HostError.bootFailure("not booted") }
        if let p = boot.invokeMethod("tick", withArguments: [dt]) { try rt.await(p) }
    }
}
