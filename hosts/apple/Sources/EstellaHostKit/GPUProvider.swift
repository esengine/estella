import Foundation
import QuartzCore

/// Errors surfaced by the host shell.
public enum HostError: Error, CustomStringConvertible {
    /// A seam that is architecturally defined but deliberately not implemented yet.
    case reserved(String)
    case bootFailure(String)
    case assetMissing(String)

    public var description: String {
        switch self {
        case .reserved(let s):    return "reserved (not yet implemented): \(s)"
        case .bootFailure(let s): return "boot failure: \(s)"
        case .assetMissing(let s): return "asset missing: \(s)"
        }
    }
}

/// The Fork A render-surface injection seam (REARCH_NATIVE.md §3.3). The host builds a
/// native WebGPU device + a surface from the layer, registers both into the wasm engine's
/// WGPU handle table, and returns the integer handles the boot sequence assigns to
/// `Module.preinitializedWebGPUDevice` / `Module.preinitializedWebGPUSurface`. The engine's
/// `initRendererWebGPU` then adopts them (the injected-surface path that already landed).
public protocol GPUProvider {
    /// Returns `(device, surface)` handle ids for the given layer, or throws if native GPU
    /// bring-up is unavailable (the shell then falls back to a headless tick).
    func makeInjectedHandles(for layer: CAMetalLayer, width: Int, height: Int) throws
        -> (device: UInt32, surface: UInt32)
}

/// RESERVED (N2, REARCH_NATIVE.md §3.3.2 — "the real hard core of the boot spike").
///
/// The finished provider will:
///   1. create a native Dawn `WGPUInstance` / `WGPUAdapter` / `WGPUDevice`,
///   2. build a `WGPUSurface` from the `CAMetalLayer` (Dawn's Metal surface descriptor),
///   3. expose a native-Dawn-backed WebGPU implementation to JSC so the wasm engine — which
///      was compiled against the emdawnwebgpu JS glue that normally targets the browser's
///      `navigator.gpu` — drives native Dawn instead, and
///   4. register the device + surface into the wasm handle table, returning their ids.
///
/// Until Dawn is vendored and that bridge is written this throws, so `EngineHost` cleanly
/// runs the proven headless tick path rather than pretending to render.
public struct DawnGPUProvider: GPUProvider {
    public init() {}

    public func makeInjectedHandles(for layer: CAMetalLayer, width: Int, height: Int) throws
        -> (device: UInt32, surface: UInt32) {
        throw HostError.reserved(
            "DawnGPUProvider: native Dawn device/surface + emdawnwebgpu-on-JSC bridge "
            + "(REARCH_NATIVE.md §3.3.2). The engine-side adopt path (adoptSurface / "
            + "preinitializedWebGPUSurface) is ready; this host-side producer is the N2 seam.")
    }
}
