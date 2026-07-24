import Foundation
import JavaScriptCore

/// A thin wrapper over a single embedded `JSContext` — the JS engine the whole shell runs
/// on. On iOS this is the OS JavaScriptCore with no JIT (Apple withholds Nitro from embedded
/// engines); to reproduce that on macOS, launch the process with `JSC_useJIT=0` (there is no
/// public per-context JIT switch — it is a VM-launch env var).
///
/// The host injects native primitives (`__print`, `__now`) the prelude/boot glue calls, and
/// drives async work by pumping the JS timer queue on the run loop — mirroring the proven C
/// boot spike's CFRunLoop pump.
public final class JSRuntime {
    public let context: JSContext

    public init() {
        guard let ctx = JSContext() else { fatalError("JSContext creation failed") }
        self.context = ctx
        ctx.name = "EstellaHost"
        ctx.exceptionHandler = { _, exception in
            let stack = exception?.objectForKeyedSubscript("stack")?.toString()
            print("[js exception] \(exception?.toString() ?? "?")\(stack.map { "\n\($0)" } ?? "")")
        }
        installHostPrimitives()
    }

    // MARK: - Host primitives

    private func installHostPrimitives() {
        let printFn: @convention(block) (String) -> Void = { print($0) }
        context.setObject(printFn, forKeyedSubscript: "__print" as NSString)

        // Monotonic-ish millisecond clock, matching performance.now()'s contract.
        let nowFn: @convention(block) () -> Double = { CFAbsoluteTimeGetCurrent() * 1000.0 }
        context.setObject(nowFn, forKeyedSubscript: "__now" as NSString)
    }

    // MARK: - Evaluation

    @discardableResult
    public func evaluate(_ script: String, name: String) -> JSValue? {
        context.evaluateScript(script, withSourceURL: URL(fileURLWithPath: name))
    }

    public func global(_ name: String) -> JSValue? {
        context.objectForKeyedSubscript(name)
    }

    // MARK: - Async: pump + await

    /// Drain the JS timer queue once (emscripten schedules async continuations here). JSC
    /// drains the microtask/Promise queue itself at the end of every evaluate call.
    public func pump() {
        context.objectForKeyedSubscript("__pump")?.call(withArguments: [])
    }

    /// Block (pumping the run loop) until a JS Promise settles; returns its fulfilment value
    /// or throws its rejection. This is the one place the shell turns async JS into sync Swift.
    @discardableResult
    public func await(_ promise: JSValue, timeout: TimeInterval = 30) throws -> JSValue {
        var settled = false
        var value: JSValue?
        var rejection: String?

        let onResolve: @convention(block) (JSValue?) -> Void = { v in value = v; settled = true }
        let onReject: @convention(block) (JSValue?) -> Void = { v in
            rejection = v?.objectForKeyedSubscript("stack")?.toString() ?? v?.toString() ?? "unknown"
            settled = true
        }
        promise.invokeMethod("then", withArguments: [
            JSValue(object: onResolve, in: context) as Any,
            JSValue(object: onReject, in: context) as Any,
        ])

        let deadline = Date().addingTimeInterval(timeout)
        while !settled {
            pump()
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.002))
            if Date() > deadline { throw HostError.bootFailure("promise timed out after \(timeout)s") }
        }
        if let rejection { throw HostError.bootFailure(rejection) }
        return value ?? JSValue(undefinedIn: context)
    }

    // MARK: - Byte bridging (no DOM ArrayBuffer helpers on a bare JSC)

    /// Hand raw bytes to JS as an `ArrayBuffer` (copied; the copy is freed when JS GCs it).
    public func makeArrayBuffer(_ data: Data) -> JSValue {
        let (ptr, count) = copyOut(data)
        var exception: JSValueRef?
        let ref = JSObjectMakeArrayBufferWithBytesNoCopy(
            context.jsGlobalContextRef, ptr, count, freeDeallocator, nil, &exception)
        return JSValue(jsValueRef: ref, in: context)
    }

    /// Hand raw bytes to JS as a `Uint8Array` (copied; freed when JS GCs it). Used for the
    /// pixel-decode texture path (NativeBridge.loadImagePixels).
    public func makeUint8Array(_ data: Data) -> JSValue {
        let (ptr, count) = copyOut(data)
        var exception: JSValueRef?
        let ref = JSObjectMakeTypedArrayWithBytesNoCopy(
            context.jsGlobalContextRef, kJSTypedArrayTypeUint8Array, ptr, count, freeDeallocator, nil, &exception)
        return JSValue(jsValueRef: ref, in: context)
    }

    private func copyOut(_ data: Data) -> (UnsafeMutableRawPointer, Int) {
        let count = data.count
        let ptr = malloc(max(count, 1))!
        if count > 0 { data.withUnsafeBytes { _ = memcpy(ptr, $0.baseAddress, count) } }
        return (ptr, count)
    }
}

/// Frees a `malloc`'d buffer once JS releases the backing ArrayBuffer/typed array.
private let freeDeallocator: JSTypedArrayBytesDeallocator = { bytes, _ in free(bytes) }
