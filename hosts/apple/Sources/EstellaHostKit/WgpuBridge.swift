import Foundation
import JavaScriptCore
import Cwgpu

/// The Fork A render bridge (REARCH_NATIVE.md §3.3.2): a JS-side WebGPU implementation backed
/// by native wgpu-native. emdawnwebgpu's glue drives `Module.preinitializedWebGPUDevice` by
/// calling real JS methods on it (device.createBuffer, queue.submit, context.getCurrentTexture,
/// …); this class builds that JS object graph, each method a Swift block that reads its JSValue
/// descriptor, calls wgpu-native, and returns a wrapped result.
///
/// Handle model: every JS object carries a hidden `_h` (an integer id); the native handle lives
/// in `handles` here. Descriptors that reference other objects (a bind group's buffers, a render
/// pass's views) are resolved back to native handles via `_h`. One marshalling path: JSValue →
/// C struct in Swift, no serialization.
///
/// Slice 4a: the marshalling mechanism, proven with device.createBuffer against the real GPU.
/// Subsequent slices fill in the rest of the captured spec (textures, shaders, pipelines, passes).
public final class WgpuBridge {
    private let rt: JSRuntime
    private let ctx: WgpuContext
    private var handles: [UInt32: OpaquePointer] = [:]
    private var nextId: UInt32 = 1

    public init(runtime: JSRuntime, context: WgpuContext) {
        self.rt = runtime
        self.ctx = context
    }

    // MARK: - handle table

    @discardableResult
    private func store(_ h: OpaquePointer) -> UInt32 { let id = nextId; nextId += 1; handles[id] = h; return id }
    func handle(_ id: UInt32) -> OpaquePointer? { handles[id] }
    private func take(_ id: UInt32) -> OpaquePointer? { handles.removeValue(forKey: id) }
    /// The native handle behind a JS wrapper object (its `_h`).
    func nativeHandle(of jsObject: JSValue?) -> OpaquePointer? {
        guard let idv = jsObject?.objectForKeyedSubscript("_h"), idv.isNumber else { return nil }
        return handle(UInt32(idv.toDouble()))
    }

    // MARK: - JSValue readers (one marshalling path: read straight off the descriptor)

    private func u32(_ v: JSValue?) -> UInt32 { UInt32(v?.toDouble() ?? 0) }
    private func u64(_ v: JSValue?) -> UInt64 { UInt64(v?.toDouble() ?? 0) }
    private func f64(_ v: JSValue?) -> Double { v?.toDouble() ?? 0 }
    private func bool(_ v: JSValue?) -> Bool { v?.isBoolean == true && v!.toBool() }

    /// Wrap a native handle in a JS object carrying `_h` plus the given Swift-block methods.
    private func wrap(_ h: OpaquePointer, _ methods: [String: Any]) -> JSValue {
        let id = store(h)
        let o = JSValue(newObjectIn: rt.context)!
        o.setObject(id, forKeyedSubscript: "_h" as NSString)
        for (k, v) in methods { o.setObject(v, forKeyedSubscript: k as NSString) }
        return o
    }

    // MARK: - device object (Module.preinitializedWebGPUDevice)

    public func makeDeviceObject() -> JSValue {
        let device = JSValue(newObjectIn: rt.context)!

        // queue: a bag of Swift-block methods over the shared WGPUQueue.
        let queue = JSValue(newObjectIn: rt.context)!
        // (writeBuffer / writeTexture / submit land in the next slice.)
        device.setObject(queue, forKeyedSubscript: "queue" as NSString)

        let createBuffer: @convention(block) (JSValue) -> JSValue = { [weak self] desc in
            self?.createBuffer(desc) ?? JSValue(nullIn: self!.rt.context)
        }
        device.setObject(createBuffer, forKeyedSubscript: "createBuffer" as NSString)

        let createShaderModule: @convention(block) (JSValue) -> JSValue = { [weak self] desc in
            self?.createShaderModule(desc) ?? JSValue(nullIn: self!.rt.context)
        }
        device.setObject(createShaderModule, forKeyedSubscript: "createShaderModule" as NSString)

        return device
    }

    // MARK: - device.createBuffer

    private func createBuffer(_ desc: JSValue) -> JSValue {
        var d = WGPUBufferDescriptor()
        d.size = u64(desc.objectForKeyedSubscript("size"))
        d.usage = WGPUBufferUsage(u64(desc.objectForKeyedSubscript("usage")))
        d.mappedAtCreation = bool(desc.objectForKeyedSubscript("mappedAtCreation")) ? 1 : 0
        guard let buf = wgpuDeviceCreateBuffer(ctx.device, &d) else { return JSValue(nullIn: rt.context) }

        let destroy: @convention(block) () -> Void = { [weak self] in
            // `this` is the buffer JS object; look up its handle to release once.
            _ = self  // handle release is driven by the bridge's lifetime in this slice
        }
        return wrap(buf, ["destroy": destroy])
    }

    // MARK: - device.createShaderModule (WGSL string + chained-struct marshalling)

    private func createShaderModule(_ desc: JSValue) -> JSValue {
        let wgsl = desc.objectForKeyedSubscript("code")?.toString() ?? ""
        return wgsl.withCString { cptr in
            var src = WGPUShaderSourceWGSL()
            src.chain.sType = WGPUSType_ShaderSourceWGSL
            src.code = WGPUStringView(data: cptr, length: strlen(cptr))
            return withUnsafeMutablePointer(to: &src) { sptr -> JSValue in
                var d = WGPUShaderModuleDescriptor()
                d.nextInChain = UnsafeMutableRawPointer(sptr).assumingMemoryBound(to: WGPUChainedStruct.self)
                guard let mod = wgpuDeviceCreateShaderModule(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
                return wrap(mod, [:])
            }
        }
    }

    // MARK: - self-test (slice 4a): the mechanism, end to end on the real GPU

    /// Create a buffer through the JS device object exactly as the engine would, and confirm a
    /// real native buffer came back. Proves JSValue → wgpu-native → wrapped handle.
    public func selfTest() -> String {
        let device = makeDeviceObject()
        let desc = JSValue(newObjectIn: rt.context)!
        desc.setObject(4096, forKeyedSubscript: "size" as NSString)
        desc.setObject(Double(WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead),
                       forKeyedSubscript: "usage" as NSString)
        guard let buffer = device.invokeMethod("createBuffer", withArguments: [desc]),
              !buffer.isNull,
              let bufNative = nativeHandle(of: buffer) else { return "FAIL: createBuffer" }

        let sdesc = JSValue(newObjectIn: rt.context)!
        sdesc.setObject("@vertex fn vs() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }",
                        forKeyedSubscript: "code" as NSString)
        guard let shader = device.invokeMethod("createShaderModule", withArguments: [sdesc]),
              !shader.isNull,
              let shNative = nativeHandle(of: shader) else { return "FAIL: createShaderModule" }

        return "createBuffer -> WGPUBuffer @\(bufNative); createShaderModule(WGSL) -> WGPUShaderModule @\(shNative)"
    }
}
