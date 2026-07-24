import AppKit
import EstellaHostKit

// Estella macOS native host entry. The shell core (JSC embed, NativeBridge, boot
// orchestration) lives in EstellaHostKit and is shared with the future iOS front end;
// this target only owns the AppKit window + input.
//
//   swift run EstellaMac              headless frame-budget bench (proven, runnable)
//   JSC_useJIT=0 swift run EstellaMac  ... under the iOS no-JIT constraint
//   swift run EstellaMac --window     open a Metal window (render path is the N2 seam)

let runtime = JSRuntime()
let bridgeHost = NativeBridgeHost(runtime: runtime, assetRoot: Bundle.main.bundleURL)
let engine = EngineHost(runtime: runtime, bridge: bridgeHost)

do {
    try engine.boot(assets: try EngineAssets.bundled())
} catch {
    FileHandle.standardError.write(Data("boot failed: \(error)\n".utf8))
    exit(1)
}

let args = Set(CommandLine.arguments.dropFirst())

if args.contains("--wgpu-selftest") {
    // Native WebGPU (wgpu-native) bring-up: prove the vendored lib + Swift binding create a
    // real GPU device from Swift (the native half of the §3.3.2 render bridge).
    print("Estella macOS host — native WebGPU (wgpu-native) self-test.")
    do {
        let ctx = try WgpuContext()
        print("  device OK — \(ctx.adapterDescription())")
        // Clear an offscreen target to a known color and read it back — real GPU pixels.
        let px = try ctx.offscreenClearReadback(width: 16, height: 16, clear: (0.2, 0.4, 0.8, 1.0))
        let expected = (UInt8(0.2 * 255 + 0.5), UInt8(0.4 * 255 + 0.5), UInt8(0.8 * 255 + 0.5), UInt8(255))
        let ok = px == expected
        print("  clear+readback: got rgba\(px) expected ~\(expected) -> \(ok ? "PASS" : "MISMATCH")")
        if !ok { exit(2) }
    } catch {
        FileHandle.standardError.write(Data("wgpu self-test failed: \(error)\n".utf8))
        exit(1)
    }
} else if args.contains("--probe-render") {
    // Drive the real engine's WebGPU render init against the logging proxy to capture the
    // exact WebGPU JS call sequence (the native-Dawn-backend spec) — REARCH_NATIVE.md §3.3.2.
    print("Estella macOS host — WebGPU bridge probe (captures the engine's WebGPU call surface).")
    do {
        let status = try engine.probeRenderInit()
        print("  probe status: \(status)")
    } catch {
        FileHandle.standardError.write(Data("probe failed: \(error)\n".utf8))
        exit(1)
    }
} else if args.contains("--window") {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let delegate = AppDelegate(engine: engine, bridge: bridgeHost)
    app.delegate = delegate
    app.run()
} else {
    let jitOff = getenv("JSC_useJIT").map { String(cString: $0) } == "0"
    print("Estella macOS host — headless frame bench (embedded JSC, JIT \(jitOff ? "OFF: iOS no-JIT proxy" : "on")).")
    do {
        let r = try engine.runHeadlessBench()
        print(String(format: "  %d entities · %d frames", r.entities, r.frames))
        print(String(format: "  ms/frame  median %.3f  mean %.3f  p95 %.3f  min %.3f", r.median, r.mean, r.p95, r.min))
        print("  budget    60fps -> \(r.pass60 ? "PASS" : "OVER") · 30fps -> \(r.pass30 ? "PASS" : "OVER")")
    } catch {
        FileHandle.standardError.write(Data("bench failed: \(error)\n".utf8))
        exit(1)
    }
}
