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

    // A missing field is an `undefined` JSValue whose toDouble() is NaN (not nil), so guard it.
    private func f64(_ v: JSValue?) -> Double { let d = v?.toDouble() ?? 0; return d.isFinite ? d : 0 }
    private func u32(_ v: JSValue?) -> UInt32 { UInt32(max(0, f64(v))) }
    private func u64(_ v: JSValue?) -> UInt64 { UInt64(max(0, f64(v))) }
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

        // queue: Swift-block methods over the shared WGPUQueue.
        let queue = JSValue(newObjectIn: rt.context)!
        let submit: @convention(block) (JSValue) -> Void = { [weak self] cmds in self?.queueSubmit(cmds) }
        queue.setObject(submit, forKeyedSubscript: "submit" as NSString)
        device.setObject(queue, forKeyedSubscript: "queue" as NSString)

        func method(_ name: String, _ fn: @escaping (JSValue) -> JSValue) {
            let block: @convention(block) (JSValue) -> JSValue = { [weak self] d in
                self.map { _ in fn(d) } ?? JSValue(undefinedIn: d.context)
            }
            device.setObject(block, forKeyedSubscript: name as NSString)
        }
        method("createBuffer") { [weak self] in self!.createBuffer($0) }
        method("createShaderModule") { [weak self] in self!.createShaderModule($0) }
        method("createTexture") { [weak self] in self!.createTexture($0) }
        method("createCommandEncoder") { [weak self] in self!.createCommandEncoder($0) }

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

    // MARK: - enum / struct marshalling (WebGPU string enums -> wgpu-native)

    private func loadOp(_ s: String) -> WGPULoadOp { s == "load" ? WGPULoadOp_Load : WGPULoadOp_Clear }
    private func storeOp(_ s: String) -> WGPUStoreOp { s == "discard" ? WGPUStoreOp_Discard : WGPUStoreOp_Store }
    private func texFormat(_ s: String) -> WGPUTextureFormat {
        switch s {
        case "bgra8unorm": return WGPUTextureFormat_BGRA8Unorm
        case "bgra8unorm-srgb": return WGPUTextureFormat_BGRA8UnormSrgb
        case "rgba8unorm-srgb": return WGPUTextureFormat_RGBA8UnormSrgb
        case "depth24plus": return WGPUTextureFormat_Depth24Plus
        case "depth24plus-stencil8": return WGPUTextureFormat_Depth24PlusStencil8
        case "r8unorm": return WGPUTextureFormat_R8Unorm
        default: return WGPUTextureFormat_RGBA8Unorm
        }
    }
    private func extent3D(_ v: JSValue?) -> WGPUExtent3D {
        guard let v, !v.isUndefined else { return WGPUExtent3D(width: 1, height: 1, depthOrArrayLayers: 1) }
        if v.isArray {
            return WGPUExtent3D(width: u32(v.atIndex(0)), height: u32(v.atIndex(1)),
                                depthOrArrayLayers: max(1, u32(v.atIndex(2))))
        }
        return WGPUExtent3D(width: u32(v.objectForKeyedSubscript("width")),
                            height: u32(v.objectForKeyedSubscript("height")),
                            depthOrArrayLayers: max(1, u32(v.objectForKeyedSubscript("depthOrArrayLayers"))))
    }

    // MARK: - textures / command encoder / render pass

    private func createTexture(_ desc: JSValue) -> JSValue {
        var d = WGPUTextureDescriptor()
        d.usage = WGPUTextureUsage(u64(desc.objectForKeyedSubscript("usage")))
        d.dimension = WGPUTextureDimension_2D
        d.size = extent3D(desc.objectForKeyedSubscript("size"))
        d.format = texFormat(desc.objectForKeyedSubscript("format")?.toString() ?? "rgba8unorm")
        d.mipLevelCount = max(1, u32(desc.objectForKeyedSubscript("mipLevelCount")))
        d.sampleCount = max(1, u32(desc.objectForKeyedSubscript("sampleCount")))
        guard let tex = wgpuDeviceCreateTexture(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        let createView: @convention(block) (JSValue?) -> JSValue = { [weak self] _ in
            guard let self, let view = wgpuTextureCreateView(tex, nil) else { return JSValue(nullIn: self!.rt.context) }
            return self.wrap(view, [:])
        }
        return wrap(tex, ["createView": createView])
    }

    private func createCommandEncoder(_ desc: JSValue) -> JSValue {
        guard let enc = wgpuDeviceCreateCommandEncoder(ctx.device, nil) else { return JSValue(nullIn: rt.context) }
        let beginRenderPass: @convention(block) (JSValue) -> JSValue = { [weak self] d in
            self?.beginRenderPass(enc, d) ?? JSValue(nullIn: self!.rt.context)
        }
        let finish: @convention(block) (JSValue?) -> JSValue = { [weak self] _ in
            guard let self, let cmd = wgpuCommandEncoderFinish(enc, nil) else { return JSValue(nullIn: self!.rt.context) }
            return self.wrap(cmd, [:])
        }
        return wrap(enc, ["beginRenderPass": beginRenderPass, "finish": finish])
    }

    private func beginRenderPass(_ enc: WGPUCommandEncoder, _ desc: JSValue) -> JSValue {
        let atts = desc.objectForKeyedSubscript("colorAttachments")!
        let count = Int(atts.objectForKeyedSubscript("length").toInt32())
        var colors = [WGPURenderPassColorAttachment]()
        for i in 0..<count {
            let ca = atts.atIndex(i)!
            var c = WGPURenderPassColorAttachment()
            c.view = nativeHandle(of: ca.objectForKeyedSubscript("view"))
            c.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED
            c.loadOp = loadOp(ca.objectForKeyedSubscript("loadOp")?.toString() ?? "clear")
            c.storeOp = storeOp(ca.objectForKeyedSubscript("storeOp")?.toString() ?? "store")
            let cv = ca.objectForKeyedSubscript("clearValue")
            c.clearValue = WGPUColor(r: f64(cv?.objectForKeyedSubscript("r")), g: f64(cv?.objectForKeyedSubscript("g")),
                                     b: f64(cv?.objectForKeyedSubscript("b")), a: f64(cv?.objectForKeyedSubscript("a")))
            colors.append(c)
        }
        let pass: WGPURenderPassEncoder? = colors.withUnsafeBufferPointer { cbuf in
            var rp = WGPURenderPassDescriptor()
            rp.colorAttachmentCount = count
            rp.colorAttachments = cbuf.baseAddress
            return wgpuCommandEncoderBeginRenderPass(enc, &rp)
        }
        guard let pass else { return JSValue(nullIn: rt.context) }
        let end: @convention(block) () -> Void = { wgpuRenderPassEncoderEnd(pass); wgpuRenderPassEncoderRelease(pass) }
        return wrap(pass, ["end": end])
    }

    private func queueSubmit(_ cmds: JSValue) {
        let n = Int(cmds.objectForKeyedSubscript("length").toInt32())
        var buf = [WGPUCommandBuffer?]()
        for i in 0..<n { buf.append(nativeHandle(of: cmds.atIndex(i))) }
        buf.withUnsafeBufferPointer { wgpuQueueSubmit(ctx.queue, n, $0.baseAddress) }
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

    /// Drive a full clear-frame THROUGH the JS device object exactly as the engine's renderer
    /// does (createTexture → createView → createCommandEncoder → beginRenderPass(clear) → end →
    /// finish → queue.submit), then read the target back. Validates the whole render path
    /// marshals correctly onto wgpu-native — real, verified GPU output through the bridge.
    public func renderFrameSelfTest() -> String {
        let c = rt.context
        let device = makeDeviceObject()
        let W = 16, H = 16

        func obj(_ pairs: [String: Any]) -> JSValue {
            let o = JSValue(newObjectIn: c)!
            for (k, v) in pairs { o.setObject(v, forKeyedSubscript: k as NSString) }
            return o
        }

        let tdesc = obj([
            "usage": Double(WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc),
            "format": "rgba8unorm",
            "size": obj(["width": W, "height": H]),
        ])
        guard let tex = device.invokeMethod("createTexture", withArguments: [tdesc]), !tex.isNull,
              let view = tex.invokeMethod("createView", withArguments: []), !view.isNull,
              let enc = device.invokeMethod("createCommandEncoder", withArguments: []) else { return "FAIL: setup" }

        let attachment = obj([
            "view": view, "loadOp": "clear", "storeOp": "store",
            "clearValue": obj(["r": 0.2, "g": 0.4, "b": 0.8, "a": 1.0]),
        ])
        let colors = JSValue(newArrayIn: c)!
        colors.setObject(attachment, atIndexedSubscript: 0)
        guard let pass = enc.invokeMethod("beginRenderPass", withArguments: [obj(["colorAttachments": colors])]),
              !pass.isNull else { return "FAIL: beginRenderPass" }
        pass.invokeMethod("end", withArguments: [])

        guard let cmd = enc.invokeMethod("finish", withArguments: []), !cmd.isNull else { return "FAIL: finish" }
        let cmds = JSValue(newArrayIn: c)!
        cmds.setObject(cmd, atIndexedSubscript: 0)
        device.objectForKeyedSubscript("queue").invokeMethod("submit", withArguments: [cmds])

        guard let native = nativeHandle(of: tex),
              let px = ctx.readbackFirstPixel(of: native, width: W, height: H) else { return "FAIL: readback" }
        let expected = (UInt8(51), UInt8(102), UInt8(204), UInt8(255))
        return "clear frame THROUGH bridge -> rgba\(px) expected ~\(expected) -> \(px == expected ? "PASS" : "MISMATCH")"
    }
}
