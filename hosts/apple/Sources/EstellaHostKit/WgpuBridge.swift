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
    private var offscreenTarget: OpaquePointer?   // headless "surface" texture (readback validation)
    private var targetW = 0, targetH = 0
    private var lastClear: (r: Double, g: Double, b: Double, a: Double) = (0, 0, 0, 0)
    public var lastClearColor: (r: Double, g: Double, b: Double, a: Double) { lastClear }

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
        let writeBuffer: @convention(block) (JSValue, JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] b, o, d, doff, sz in
            self?.writeBuffer(b, o, d, doff, sz)
        }
        queue.setObject(writeBuffer, forKeyedSubscript: "writeBuffer" as NSString)
        let writeTexture: @convention(block) (JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] dst, data, layout, size in
            self?.writeTexture(dst, data, layout, size)
        }
        queue.setObject(writeTexture, forKeyedSubscript: "writeTexture" as NSString)
        device.setObject(queue, forKeyedSubscript: "queue" as NSString)

        // device.features.has -> false: no optional features, so the engine keeps to the core
        // frame path (no timestamp queries etc.) — matching the device we requested.
        let features = JSValue(newObjectIn: rt.context)!
        let has: @convention(block) (JSValue) -> Bool = { _ in false }
        features.setObject(has, forKeyedSubscript: "has" as NSString)
        device.setObject(features, forKeyedSubscript: "features" as NSString)

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
        method("createQuerySet") { [weak self] in self!.createQuerySet($0) }

        return device
    }

    /// Install the browser-shaped globals the engine reaches for in canvas WebGPU mode, backed
    /// by this bridge: navigator.gpu + document.querySelector('#canvas').getContext('webgpu').
    /// Sizes the headless render target.
    public func installGlobals(targetWidth: Int, targetHeight: Int) {
        targetW = targetWidth
        targetH = targetHeight
        guard let g = rt.context.globalObject else { return }
        let gpu = JSValue(newObjectIn: rt.context)!
        let fmt: @convention(block) () -> String = { "rgba8unorm" }
        gpu.setObject(fmt, forKeyedSubscript: "getPreferredCanvasFormat" as NSString)
        let navigator = JSValue(newObjectIn: rt.context)!
        navigator.setObject(gpu, forKeyedSubscript: "gpu" as NSString)
        g.setObject(navigator, forKeyedSubscript: "navigator" as NSString)

        let context = makeContextObject()
        let canvas = JSValue(newObjectIn: rt.context)!
        canvas.setObject(targetWidth, forKeyedSubscript: "width" as NSString)
        canvas.setObject(targetHeight, forKeyedSubscript: "height" as NSString)
        context.setObject(canvas, forKeyedSubscript: "canvas" as NSString)   // glue reads context.canvas.{width,height}
        let getContext: @convention(block) (JSValue?) -> JSValue = { _ in context }
        canvas.setObject(getContext, forKeyedSubscript: "getContext" as NSString)
        let document = JSValue(newObjectIn: rt.context)!
        let querySelector: @convention(block) (JSValue?) -> JSValue = { _ in canvas }
        document.setObject(querySelector, forKeyedSubscript: "querySelector" as NSString)
        g.setObject(document, forKeyedSubscript: "document" as NSString)
    }

    /// The device object to inject as Module.preinitializedWebGPUDevice.
    public func makeDevice() -> JSValue { makeDeviceObject() }

    /// Read the headless target back (RGBA8) to verify the engine's frame.
    public func readbackTarget() -> (UInt8, UInt8, UInt8, UInt8)? {
        guard let t = offscreenTarget else { return nil }
        return ctx.readbackFirstPixel(of: t, width: targetW, height: targetH)
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
            if i == 0 { lastClear = (c.clearValue.r, c.clearValue.g, c.clearValue.b, c.clearValue.a) }
            colors.append(c)
        }

        // Optional depth-stencil attachment (the engine's swapchain carries depth).
        let dsa = desc.objectForKeyedSubscript("depthStencilAttachment")
        let hasDepth = dsa != nil && !dsa!.isUndefined && !dsa!.isNull
        var depth = WGPURenderPassDepthStencilAttachment()
        if hasDepth, let dsa {
            depth.view = nativeHandle(of: dsa.objectForKeyedSubscript("view"))
            depth.depthLoadOp = loadOpOpt(dsa.objectForKeyedSubscript("depthLoadOp"))
            depth.depthStoreOp = storeOpOpt(dsa.objectForKeyedSubscript("depthStoreOp"))
            depth.depthClearValue = Float(f64(dsa.objectForKeyedSubscript("depthClearValue")))
            depth.stencilLoadOp = loadOpOpt(dsa.objectForKeyedSubscript("stencilLoadOp"))
            depth.stencilStoreOp = storeOpOpt(dsa.objectForKeyedSubscript("stencilStoreOp"))
            depth.stencilClearValue = u32(dsa.objectForKeyedSubscript("stencilClearValue"))
        }

        let pass: WGPURenderPassEncoder? = colors.withUnsafeBufferPointer { cbuf in
            withUnsafePointer(to: &depth) { dptr in
                var rp = WGPURenderPassDescriptor()
                rp.colorAttachmentCount = count
                rp.colorAttachments = cbuf.baseAddress
                if hasDepth { rp.depthStencilAttachment = dptr }
                return wgpuCommandEncoderBeginRenderPass(enc, &rp)
            }
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

    // Undefined-tolerant op readers (absent depth/stencil ops must stay Undefined, not Clear).
    private func loadOpOpt(_ v: JSValue?) -> WGPULoadOp {
        guard v?.isString == true, let s = v?.toString() else { return WGPULoadOp_Undefined }
        return s == "load" ? WGPULoadOp_Load : (s == "clear" ? WGPULoadOp_Clear : WGPULoadOp_Undefined)
    }
    private func storeOpOpt(_ v: JSValue?) -> WGPUStoreOp {
        guard v?.isString == true, let s = v?.toString() else { return WGPUStoreOp_Undefined }
        return s == "store" ? WGPUStoreOp_Store : (s == "discard" ? WGPUStoreOp_Discard : WGPUStoreOp_Undefined)
    }

    // MARK: - byte access (queue uploads)

    private func bytes(of v: JSValue) -> (UnsafeRawPointer, Int)? {
        let gctx = rt.context.jsGlobalContextRef
        var ex: JSValueRef?
        guard let o = JSValueToObject(gctx, v.jsValueRef, &ex) else { return nil }
        let ty = JSValueGetTypedArrayType(gctx, o, &ex)
        if ty != kJSTypedArrayTypeNone && ty != kJSTypedArrayTypeArrayBuffer {
            guard let p = JSObjectGetTypedArrayBytesPtr(gctx, o, &ex) else { return nil }
            return (UnsafeRawPointer(p), JSObjectGetTypedArrayByteLength(gctx, o, &ex))
        }
        if let p = JSObjectGetArrayBufferBytesPtr(gctx, o, &ex) {
            return (UnsafeRawPointer(p), JSObjectGetArrayBufferByteLength(gctx, o, &ex))
        }
        return nil
    }

    private func writeBuffer(_ b: JSValue, _ off: JSValue, _ data: JSValue, _ dataOffset: JSValue, _ size: JSValue) {
        guard let buf = nativeHandle(of: b), let (ptr, len) = bytes(of: data) else { return }
        let doff = Int(u64(dataOffset))
        let sz = size.isUndefined ? (len - doff) : Int(u64(size))
        wgpuQueueWriteBuffer(ctx.queue, buf, u64(off), ptr.advanced(by: doff), sz)
    }

    private func writeTexture(_ dstV: JSValue, _ data: JSValue, _ layoutV: JSValue, _ sizeV: JSValue) {
        guard let (ptr, len) = bytes(of: data) else { return }
        var dst = WGPUTexelCopyTextureInfo()
        dst.texture = nativeHandle(of: dstV.objectForKeyedSubscript("texture"))
        dst.mipLevel = u32(dstV.objectForKeyedSubscript("mipLevel"))
        dst.aspect = WGPUTextureAspect_All
        if let orig = dstV.objectForKeyedSubscript("origin"), !orig.isUndefined {
            dst.origin = WGPUOrigin3D(x: u32(orig.objectForKeyedSubscript("x")),
                                      y: u32(orig.objectForKeyedSubscript("y")),
                                      z: u32(orig.objectForKeyedSubscript("z")))
        }
        var layout = WGPUTexelCopyBufferLayout()
        layout.offset = u64(layoutV.objectForKeyedSubscript("offset"))
        layout.bytesPerRow = u32(layoutV.objectForKeyedSubscript("bytesPerRow"))
        layout.rowsPerImage = u32(layoutV.objectForKeyedSubscript("rowsPerImage"))
        var ext = extent3D(sizeV)
        wgpuQueueWriteTexture(ctx.queue, &dst, ptr, len, &layout, &ext)
    }

    private func createQuerySet(_ desc: JSValue) -> JSValue {
        var d = WGPUQuerySetDescriptor()
        d.type = WGPUQueryType_Occlusion
        d.count = max(1, u32(desc.objectForKeyedSubscript("count")))
        guard let qs = wgpuDeviceCreateQuerySet(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        return wrap(qs, [:])
    }

    // MARK: - canvas context (the engine's swapchain surface)

    private func makeContextObject() -> JSValue {
        let context = JSValue(newObjectIn: rt.context)!
        let configure: @convention(block) (JSValue) -> Void = { _ in /* headless: target sized in installGlobals */ }
        let getCurrentTexture: @convention(block) () -> JSValue = { [weak self] in
            self?.currentTexture() ?? JSValue(nullIn: self!.rt.context)
        }
        let unconfigure: @convention(block) () -> Void = {}
        context.setObject(configure, forKeyedSubscript: "configure" as NSString)
        context.setObject(getCurrentTexture, forKeyedSubscript: "getCurrentTexture" as NSString)
        context.setObject(unconfigure, forKeyedSubscript: "unconfigure" as NSString)
        return context
    }

    private func currentTexture() -> JSValue {
        if offscreenTarget == nil {
            var d = WGPUTextureDescriptor()
            d.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc
            d.dimension = WGPUTextureDimension_2D
            d.size = WGPUExtent3D(width: UInt32(targetW), height: UInt32(targetH), depthOrArrayLayers: 1)
            d.format = WGPUTextureFormat_RGBA8Unorm
            d.mipLevelCount = 1
            d.sampleCount = 1
            offscreenTarget = wgpuDeviceCreateTexture(ctx.device, &d)
        }
        guard let t = offscreenTarget else { return JSValue(nullIn: rt.context) }
        let createView: @convention(block) (JSValue?) -> JSValue = { [weak self] _ in
            guard let self, let v = wgpuTextureCreateView(t, nil) else { return JSValue(nullIn: self!.rt.context) }
            return self.wrap(v, [:])
        }
        return wrap(t, ["createView": createView])
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
