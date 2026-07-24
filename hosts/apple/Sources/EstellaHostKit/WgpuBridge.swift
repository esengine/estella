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
    private var offscreenTarget: OpaquePointer?   // offscreen render target (headless / no-drawable fallback)
    private var acquiredSurfaceTexture: OpaquePointer?  // this frame's surface backbuffer (until present)
    private var presentableThisFrame = false      // did this frame render to the real surface?
    private var targetW = 0, targetH = 0
    private var lastClear: (r: Double, g: Double, b: Double, a: Double) = (0, 0, 0, 0)
    public var lastClearColor: (r: Double, g: Double, b: Double, a: Double) { lastClear }
    // Native Metal surfaces only support BGRA8Unorm; the engine requests RGBA8Unorm. We
    // substitute here and rewrite draw-pipeline color targets to match. Shader-output
    // semantics are format-neutral, so colors are unaffected.
    private var surfaceColorFormat = WGPUTextureFormat_RGBA8Unorm

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
        method("createSampler") { [weak self] in self!.createSampler($0) }
        method("createBindGroupLayout") { [weak self] in self!.createBindGroupLayout($0) }
        method("createPipelineLayout") { [weak self] in self!.createPipelineLayout($0) }
        method("createBindGroup") { [weak self] in self!.createBindGroup($0) }
        method("createRenderPipeline") { [weak self] in self!.createRenderPipeline($0) }

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
        let fmtStr = desc.objectForKeyedSubscript("format")?.toString() ?? "rgba8unorm"
        d.format = texFormat(fmtStr)
        d.mipLevelCount = max(1, u32(desc.objectForKeyedSubscript("mipLevelCount")))
        d.sampleCount = max(1, u32(desc.objectForKeyedSubscript("sampleCount")))
        guard let tex = wgpuDeviceCreateTexture(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        let createView: @convention(block) (JSValue?) -> JSValue = { [weak self] _ in
            guard let self, let view = wgpuTextureCreateView(tex, nil) else { return JSValue(nullIn: self!.rt.context) }
            return self.wrap(view, ["_kind": "view"])
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
        let setPipeline: @convention(block) (JSValue) -> Void = { [weak self] p in
            wgpuRenderPassEncoderSetPipeline(pass, self?.nativeHandle(of: p))
        }
        let setBindGroup: @convention(block) (JSValue, JSValue, JSValue) -> Void = { [weak self] idx, grp, offs in
            guard let self else { return }
            if offs.isArray {
                let n = Int(offs.objectForKeyedSubscript("length").toInt32())
                var arr = [UInt32](); for i in 0..<n { arr.append(self.u32(offs.atIndex(i))) }
                arr.withUnsafeBufferPointer { wgpuRenderPassEncoderSetBindGroup(pass, self.u32(idx), self.nativeHandle(of: grp), n, $0.baseAddress) }
            } else {
                wgpuRenderPassEncoderSetBindGroup(pass, self.u32(idx), self.nativeHandle(of: grp), 0, nil)
            }
        }
        let setVertexBuffer: @convention(block) (JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] slot, buf, off, size in
            guard let self else { return }
            wgpuRenderPassEncoderSetVertexBuffer(pass, self.u32(slot), self.nativeHandle(of: buf),
                                                 self.u64(off), size.isUndefined ? UInt64.max : self.u64(size))
        }
        let setIndexBuffer: @convention(block) (JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] buf, fmt, off, size in
            guard let self else { return }
            wgpuRenderPassEncoderSetIndexBuffer(pass, self.nativeHandle(of: buf), self.indexFormat(fmt.toString()),
                                                self.u64(off), size.isUndefined ? UInt64.max : self.u64(size))
        }
        let draw: @convention(block) (JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] vc, ic, fv, fi in
            guard let self else { return }
            wgpuRenderPassEncoderDraw(pass, self.u32(vc), ic.isUndefined ? 1 : self.u32(ic), self.u32(fv), self.u32(fi))
        }
        let drawIndexed: @convention(block) (JSValue, JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] ic, inst, fi, bv, fin in
            guard let self else { return }
            wgpuRenderPassEncoderDrawIndexed(pass, self.u32(ic), inst.isUndefined ? 1 : self.u32(inst),
                                             self.u32(fi), Int32(bitPattern: self.u32(bv)), self.u32(fin))
        }
        let setViewport: @convention(block) (JSValue, JSValue, JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] x, y, w, h, mn, mx in
            guard let self else { return }
            wgpuRenderPassEncoderSetViewport(pass, Float(self.f64(x)), Float(self.f64(y)), Float(self.f64(w)),
                                             Float(self.f64(h)), Float(self.f64(mn)), Float(self.f64(mx)))
        }
        let setScissorRect: @convention(block) (JSValue, JSValue, JSValue, JSValue) -> Void = { [weak self] x, y, w, h in
            guard let self else { return }
            wgpuRenderPassEncoderSetScissorRect(pass, self.u32(x), self.u32(y), self.u32(w), self.u32(h))
        }
        return wrap(pass, [
            "end": end, "setPipeline": setPipeline, "setBindGroup": setBindGroup,
            "setVertexBuffer": setVertexBuffer, "setIndexBuffer": setIndexBuffer,
            "draw": draw, "drawIndexed": drawIndexed,
            "setViewport": setViewport, "setScissorRect": setScissorRect,
        ])
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

    // MARK: - draw-path enum marshalling (WebGPU string enums -> wgpu-native)

    private func vertexFormat(_ s: String?) -> WGPUVertexFormat {
        switch s {
        case "float32": return WGPUVertexFormat_Float32
        case "float32x2": return WGPUVertexFormat_Float32x2
        case "float32x3": return WGPUVertexFormat_Float32x3
        case "float32x4": return WGPUVertexFormat_Float32x4
        case "uint32": return WGPUVertexFormat_Uint32
        case "uint32x2": return WGPUVertexFormat_Uint32x2
        case "uint32x4": return WGPUVertexFormat_Uint32x4
        case "uint8x4": return WGPUVertexFormat_Uint8x4
        case "unorm8x4": return WGPUVertexFormat_Unorm8x4
        case "sint32": return WGPUVertexFormat_Sint32
        default: return WGPUVertexFormat_Float32x2
        }
    }
    private func blendFactor(_ s: String?) -> WGPUBlendFactor {
        switch s {
        case "zero": return WGPUBlendFactor_Zero
        case "one": return WGPUBlendFactor_One
        case "src": return WGPUBlendFactor_Src
        case "one-minus-src": return WGPUBlendFactor_OneMinusSrc
        case "src-alpha": return WGPUBlendFactor_SrcAlpha
        case "one-minus-src-alpha": return WGPUBlendFactor_OneMinusSrcAlpha
        case "dst": return WGPUBlendFactor_Dst
        case "one-minus-dst": return WGPUBlendFactor_OneMinusDst
        case "dst-alpha": return WGPUBlendFactor_DstAlpha
        case "one-minus-dst-alpha": return WGPUBlendFactor_OneMinusDstAlpha
        default: return WGPUBlendFactor_One
        }
    }
    private func blendOp(_ s: String?) -> WGPUBlendOperation {
        switch s {
        case "subtract": return WGPUBlendOperation_Subtract
        case "reverse-subtract": return WGPUBlendOperation_ReverseSubtract
        case "min": return WGPUBlendOperation_Min
        case "max": return WGPUBlendOperation_Max
        default: return WGPUBlendOperation_Add
        }
    }
    private func topology(_ s: String?) -> WGPUPrimitiveTopology {
        switch s {
        case "point-list": return WGPUPrimitiveTopology_PointList
        case "line-list": return WGPUPrimitiveTopology_LineList
        case "line-strip": return WGPUPrimitiveTopology_LineStrip
        case "triangle-strip": return WGPUPrimitiveTopology_TriangleStrip
        default: return WGPUPrimitiveTopology_TriangleList
        }
    }
    private func cullMode(_ s: String?) -> WGPUCullMode {
        switch s { case "front": return WGPUCullMode_Front; case "back": return WGPUCullMode_Back; default: return WGPUCullMode_None }
    }
    private func frontFace(_ s: String?) -> WGPUFrontFace {
        s == "cw" ? WGPUFrontFace_CW : WGPUFrontFace_CCW
    }
    private func stepMode(_ s: String?) -> WGPUVertexStepMode {
        s == "instance" ? WGPUVertexStepMode_Instance : WGPUVertexStepMode_Vertex
    }
    private func compareFunc(_ s: String?) -> WGPUCompareFunction {
        switch s {
        case "never": return WGPUCompareFunction_Never
        case "less": return WGPUCompareFunction_Less
        case "equal": return WGPUCompareFunction_Equal
        case "less-equal": return WGPUCompareFunction_LessEqual
        case "greater": return WGPUCompareFunction_Greater
        case "not-equal": return WGPUCompareFunction_NotEqual
        case "greater-equal": return WGPUCompareFunction_GreaterEqual
        case "always": return WGPUCompareFunction_Always
        default: return WGPUCompareFunction_Always
        }
    }
    private func indexFormat(_ s: String?) -> WGPUIndexFormat {
        s == "uint32" ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16
    }
    private func filterMode(_ s: String?) -> WGPUFilterMode { s == "linear" ? WGPUFilterMode_Linear : WGPUFilterMode_Nearest }
    private func mipmapFilter(_ s: String?) -> WGPUMipmapFilterMode { s == "linear" ? WGPUMipmapFilterMode_Linear : WGPUMipmapFilterMode_Nearest }
    private func addressMode(_ s: String?) -> WGPUAddressMode {
        switch s { case "repeat": return WGPUAddressMode_Repeat; case "mirror-repeat": return WGPUAddressMode_MirrorRepeat; default: return WGPUAddressMode_ClampToEdge }
    }
    private func optionalBool(_ v: JSValue?) -> WGPUOptionalBool {
        guard let v, v.isBoolean else { return WGPUOptionalBool_Undefined }
        return v.toBool() ? WGPUOptionalBool_True : WGPUOptionalBool_False
    }
    private func blendComponent(_ v: JSValue?) -> WGPUBlendComponent {
        var c = WGPUBlendComponent()
        c.operation = blendOp(v?.objectForKeyedSubscript("operation")?.toString())
        c.srcFactor = blendFactor(v?.objectForKeyedSubscript("srcFactor")?.toString())
        c.dstFactor = blendFactor(v?.objectForKeyedSubscript("dstFactor")?.toString())
        return c
    }
    private func stencilFace(_ v: JSValue?) -> WGPUStencilFaceState {
        var s = WGPUStencilFaceState()
        s.compare = compareFunc(v?.objectForKeyedSubscript("compare")?.toString())
        return s
    }

    // MARK: - samplers / layouts / bind groups / render pipeline

    private func createSampler(_ desc: JSValue) -> JSValue {
        var d = WGPUSamplerDescriptor()
        d.addressModeU = addressMode(desc.objectForKeyedSubscript("addressModeU")?.toString())
        d.addressModeV = addressMode(desc.objectForKeyedSubscript("addressModeV")?.toString())
        d.addressModeW = addressMode(desc.objectForKeyedSubscript("addressModeW")?.toString())
        d.magFilter = filterMode(desc.objectForKeyedSubscript("magFilter")?.toString())
        d.minFilter = filterMode(desc.objectForKeyedSubscript("minFilter")?.toString())
        d.mipmapFilter = mipmapFilter(desc.objectForKeyedSubscript("mipmapFilter")?.toString())
        d.lodMinClamp = Float(f64(desc.objectForKeyedSubscript("lodMinClamp")))
        let lodMax = desc.objectForKeyedSubscript("lodMaxClamp")
        d.lodMaxClamp = (lodMax?.isNumber == true) ? Float(f64(lodMax)) : 32
        d.maxAnisotropy = 1
        guard let s = wgpuDeviceCreateSampler(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        return wrap(s, ["_kind": "sampler"])
    }

    private func createBindGroupLayout(_ desc: JSValue) -> JSValue {
        let arena = Arena()
        let entriesJS = desc.objectForKeyedSubscript("entries")!
        let n = Int(entriesJS.objectForKeyedSubscript("length").toInt32())
        var entries = [WGPUBindGroupLayoutEntry]()
        for i in 0..<n {
            let e = entriesJS.atIndex(i)!
            var le = WGPUBindGroupLayoutEntry()
            le.binding = u32(e.objectForKeyedSubscript("binding"))
            le.visibility = WGPUShaderStage(u64(e.objectForKeyedSubscript("visibility")))
            if let b = e.objectForKeyedSubscript("buffer"), !b.isUndefined, !b.isNull {
                le.buffer.type = bufferBindingType(b.objectForKeyedSubscript("type")?.toString())
                le.buffer.hasDynamicOffset = bool(b.objectForKeyedSubscript("hasDynamicOffset")) ? 1 : 0
                le.buffer.minBindingSize = u64(b.objectForKeyedSubscript("minBindingSize"))
            } else if let s = e.objectForKeyedSubscript("sampler"), !s.isUndefined, !s.isNull {
                le.sampler.type = samplerBindingType(s.objectForKeyedSubscript("type")?.toString())
            } else if let t = e.objectForKeyedSubscript("texture"), !t.isUndefined, !t.isNull {
                le.texture.sampleType = textureSampleType(t.objectForKeyedSubscript("sampleType")?.toString())
                le.texture.viewDimension = WGPUTextureViewDimension_2D
            }
            entries.append(le)
        }
        var d = WGPUBindGroupLayoutDescriptor()
        d.entryCount = entries.count
        d.entries = arena.array(entries)
        guard let l = wgpuDeviceCreateBindGroupLayout(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        return wrap(l, [:])
    }

    private func createPipelineLayout(_ desc: JSValue) -> JSValue {
        let arena = Arena()
        let bglsJS = desc.objectForKeyedSubscript("bindGroupLayouts")!
        let n = Int(bglsJS.objectForKeyedSubscript("length").toInt32())
        var bgls = [WGPUBindGroupLayout?]()
        for i in 0..<n { bgls.append(nativeHandle(of: bglsJS.atIndex(i))) }
        var d = WGPUPipelineLayoutDescriptor()
        d.bindGroupLayoutCount = bgls.count
        d.bindGroupLayouts = arena.array(bgls)
        guard let l = wgpuDeviceCreatePipelineLayout(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        return wrap(l, [:])
    }

    private func createBindGroup(_ desc: JSValue) -> JSValue {
        let arena = Arena()
        var d = WGPUBindGroupDescriptor()
        d.layout = nativeHandle(of: desc.objectForKeyedSubscript("layout"))
        let entriesJS = desc.objectForKeyedSubscript("entries")!
        let n = Int(entriesJS.objectForKeyedSubscript("length").toInt32())
        var entries = [WGPUBindGroupEntry]()
        for i in 0..<n {
            let e = entriesJS.atIndex(i)!
            var be = WGPUBindGroupEntry()
            be.binding = u32(e.objectForKeyedSubscript("binding"))
            // resource is { buffer, offset?, size? } | a sampler | a textureView wrapper
            // (wrappers are tagged with _kind so we pick the right WGPUBindGroupEntry slot).
            if let res {
                let kind = res.objectForKeyedSubscript("_kind")?.toString()
                if kind == "sampler" {
                    be.sampler = nativeHandle(of: res)
                } else if kind == "view" {
                    be.textureView = nativeHandle(of: res)
                } else if let buf = res.objectForKeyedSubscript("buffer"), buf.isObject {
                    be.buffer = nativeHandle(of: buf)
                    be.offset = u64(res.objectForKeyedSubscript("offset"))
                    let sz = res.objectForKeyedSubscript("size")
                    be.size = (sz?.isNumber == true) ? u64(sz) : UInt64.max
                }
            }
            entries.append(be)
        }
        d.entryCount = entries.count
        d.entries = arena.array(entries)
        guard let g = wgpuDeviceCreateBindGroup(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        return wrap(g, [:])
    }

    private func createRenderPipeline(_ desc: JSValue) -> JSValue {
        let arena = Arena()

        var vertex = WGPUVertexState()
        let vs = desc.objectForKeyedSubscript("vertex")!
        vertex.module = nativeHandle(of: vs.objectForKeyedSubscript("module"))
        vertex.entryPoint = arena.stringView(vs.objectForKeyedSubscript("entryPoint")?.toString() ?? "vs")
        if let buffersJS = vs.objectForKeyedSubscript("buffers"), buffersJS.isArray {
            let bn = Int(buffersJS.objectForKeyedSubscript("length").toInt32())
            var bufLayouts = [WGPUVertexBufferLayout]()
            for i in 0..<bn {
                let b = buffersJS.atIndex(i)!
                var bl = WGPUVertexBufferLayout()
                bl.stepMode = stepMode(b.objectForKeyedSubscript("stepMode")?.toString())
                bl.arrayStride = u64(b.objectForKeyedSubscript("arrayStride"))
                let attrsJS = b.objectForKeyedSubscript("attributes")!
                let an = Int(attrsJS.objectForKeyedSubscript("length").toInt32())
                var attrs = [WGPUVertexAttribute]()
                for j in 0..<an {
                    let a = attrsJS.atIndex(j)!
                    var at = WGPUVertexAttribute()
                    at.format = vertexFormat(a.objectForKeyedSubscript("format")?.toString())
                    at.offset = u64(a.objectForKeyedSubscript("offset"))
                    at.shaderLocation = u32(a.objectForKeyedSubscript("shaderLocation"))
                    attrs.append(at)
                }
                bl.attributeCount = attrs.count
                bl.attributes = arena.array(attrs)
                bufLayouts.append(bl)
            }
            vertex.bufferCount = bufLayouts.count
            vertex.buffers = arena.array(bufLayouts)
        }

        var fragment = WGPUFragmentState()
        var hasFragment = false
        if let fs = desc.objectForKeyedSubscript("fragment"), fs.isObject {
            hasFragment = true
            fragment.module = nativeHandle(of: fs.objectForKeyedSubscript("module"))
            fragment.entryPoint = arena.stringView(fs.objectForKeyedSubscript("entryPoint")?.toString() ?? "fs")
            let targetsJS = fs.objectForKeyedSubscript("targets")!
            let tn = Int(targetsJS.objectForKeyedSubscript("length").toInt32())
            var targets = [WGPUColorTargetState]()
            for i in 0..<tn {
                let t = targetsJS.atIndex(i)!
                var ct = WGPUColorTargetState()
                var fmt = texFormat(t.objectForKeyedSubscript("format")?.toString() ?? "rgba8unorm")
                if ctx.hasSurface, fmt == WGPUTextureFormat_RGBA8Unorm { fmt = surfaceColorFormat }
                ct.format = fmt
                let wm = u64(t.objectForKeyedSubscript("writeMask"))
                ct.writeMask = WGPUColorWriteMask(wm == 0 ? 0xF : wm)
                if let bl = t.objectForKeyedSubscript("blend"), bl.isObject {
                    var blend = WGPUBlendState()
                    blend.color = blendComponent(bl.objectForKeyedSubscript("color"))
                    blend.alpha = blendComponent(bl.objectForKeyedSubscript("alpha"))
                    ct.blend = arena.single(blend)
                }
                targets.append(ct)
            }
            fragment.targetCount = targets.count
            fragment.targets = arena.array(targets)
        }

        var primitive = WGPUPrimitiveState()
        if let p = desc.objectForKeyedSubscript("primitive"), p.isObject {
            primitive.topology = topology(p.objectForKeyedSubscript("topology")?.toString())
            primitive.frontFace = frontFace(p.objectForKeyedSubscript("frontFace")?.toString())
            primitive.cullMode = cullMode(p.objectForKeyedSubscript("cullMode")?.toString())
        } else {
            primitive.topology = WGPUPrimitiveTopology_TriangleList
        }

        var multisample = WGPUMultisampleState()
        multisample.count = max(1, u32(desc.objectForKeyedSubscript("multisample")?.objectForKeyedSubscript("count")))
        multisample.mask = 0xFFFFFFFF

        var depthStencilPtr: UnsafePointer<WGPUDepthStencilState>?
        if let ds = desc.objectForKeyedSubscript("depthStencil"), ds.isObject {
            var dss = WGPUDepthStencilState()
            dss.format = texFormat(ds.objectForKeyedSubscript("format")?.toString() ?? "depth24plus-stencil8")
            dss.depthWriteEnabled = optionalBool(ds.objectForKeyedSubscript("depthWriteEnabled"))
            dss.depthCompare = compareFunc(ds.objectForKeyedSubscript("depthCompare")?.toString())
            dss.stencilFront = stencilFace(ds.objectForKeyedSubscript("stencilFront"))
            dss.stencilBack = stencilFace(ds.objectForKeyedSubscript("stencilBack"))
            dss.stencilReadMask = u32(ds.objectForKeyedSubscript("stencilReadMask"))
            dss.stencilWriteMask = u32(ds.objectForKeyedSubscript("stencilWriteMask"))
            depthStencilPtr = arena.single(dss)
        }

        var d = WGPURenderPipelineDescriptor()
        d.layout = nativeHandle(of: desc.objectForKeyedSubscript("layout"))
        d.vertex = vertex
        d.primitive = primitive
        d.multisample = multisample
        d.depthStencil = depthStencilPtr
        if hasFragment { d.fragment = arena.single(fragment) }

        guard let pipeline = wgpuDeviceCreateRenderPipeline(ctx.device, &d) else { return JSValue(nullIn: rt.context) }
        let getBindGroupLayout: @convention(block) (JSValue) -> JSValue = { [weak self] idx in
            guard let self, let bgl = wgpuRenderPipelineGetBindGroupLayout(pipeline, self.u32(idx)) else {
                return JSValue(nullIn: self!.rt.context)
            }
            return self.wrap(bgl, [:])
        }
        return wrap(pipeline, ["getBindGroupLayout": getBindGroupLayout])
    }

    private func bufferBindingType(_ s: String?) -> WGPUBufferBindingType {
        switch s { case "storage": return WGPUBufferBindingType_Storage; case "read-only-storage": return WGPUBufferBindingType_ReadOnlyStorage; default: return WGPUBufferBindingType_Uniform }
    }
    private func samplerBindingType(_ s: String?) -> WGPUSamplerBindingType {
        switch s { case "non-filtering": return WGPUSamplerBindingType_NonFiltering; case "comparison": return WGPUSamplerBindingType_Comparison; default: return WGPUSamplerBindingType_Filtering }
    }
    private func textureSampleType(_ s: String?) -> WGPUTextureSampleType {
        switch s { case "unfilterable-float": return WGPUTextureSampleType_UnfilterableFloat; case "depth": return WGPUTextureSampleType_Depth; default: return WGPUTextureSampleType_Float }
    }

    // MARK: - canvas context (the engine's swapchain surface)

    private func makeContextObject() -> JSValue {
        let context = JSValue(newObjectIn: rt.context)!
        let configure: @convention(block) (JSValue) -> Void = { [weak self] _ in
            // On a real surface, use the Metal-supported BGRA8Unorm (not the engine's RGBA8Unorm
            // request, which wgpu-native rejects). Remember it so draw pipelines target it too.
            guard let self, self.ctx.hasSurface else { return }
            self.surfaceColorFormat = WGPUTextureFormat_BGRA8Unorm
            self.ctx.configureSurfaceFormat(WGPUTextureFormat_BGRA8Unorm, width: self.targetW, height: self.targetH)
        }
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
        // On-screen: the surface backbuffer when the CAMetalLayer can vend a drawable; if it
        // can't yet (window not composited), fall back to an offscreen target so engine init
        // never fails. Headless: always the offscreen target. On a real device the surface is
        // available from the first frame, so this renders on-screen.
        // WebGPU: getCurrentTexture returns the SAME backbuffer until present. Re-acquiring the
        // surface before present is a validation error ("already acquired"), so cache per frame.
        let target: OpaquePointer?
        if let cached = acquiredSurfaceTexture {
            target = cached
        } else if ctx.hasSurface, let surfaceTex = ctx.currentSurfaceTexture() {
            acquiredSurfaceTexture = surfaceTex
            presentableThisFrame = true
            target = surfaceTex
        } else {
            presentableThisFrame = false
            target = fallbackTarget()
        }
        guard let t = target else { return JSValue(nullIn: rt.context) }
        let createView: @convention(block) (JSValue?) -> JSValue = { [weak self] _ in
            guard let self, let v = wgpuTextureCreateView(t, nil) else { return JSValue(nullIn: self!.rt.context) }
            return self.wrap(v, ["_kind": "view"])
        }
        return wrap(t, ["createView": createView])
    }

    private func fallbackTarget() -> OpaquePointer? {
        if offscreenTarget == nil {
            var d = WGPUTextureDescriptor()
            d.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc
            d.dimension = WGPUTextureDimension_2D
            d.size = WGPUExtent3D(width: UInt32(max(1, targetW)), height: UInt32(max(1, targetH)), depthOrArrayLayers: 1)
            d.format = ctx.hasSurface ? surfaceColorFormat : WGPUTextureFormat_RGBA8Unorm
            d.mipLevelCount = 1
            d.sampleCount = 1
            offscreenTarget = wgpuDeviceCreateTexture(ctx.device, &d)
        }
        return offscreenTarget
    }

    /// Present the surface backbuffer (call after the engine's tick); no-op if this frame
    /// rendered to the offscreen fallback (no drawable was available).
    public func present() {
        if presentableThisFrame { ctx.presentSurface() }
        presentableThisFrame = false
        acquiredSurfaceTexture = nil   // next frame re-acquires
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

/// Holds C memory alive across a single wgpu create* call so nested descriptor arrays / strings
/// (vertex buffers -> attributes, fragment targets -> blend, entryPoints) stay valid until the
/// call copies them; freed on deinit right after.
private final class Arena {
    private var allocs: [UnsafeMutableRawPointer] = []
    func array<T>(_ items: [T]) -> UnsafePointer<T>? {
        guard !items.isEmpty else { return nil }
        let p = UnsafeMutablePointer<T>.allocate(capacity: items.count)
        items.withUnsafeBufferPointer { p.initialize(from: $0.baseAddress!, count: items.count) }
        allocs.append(UnsafeMutableRawPointer(p))
        return UnsafePointer(p)
    }
    func single<T>(_ item: T) -> UnsafePointer<T> {
        let p = UnsafeMutablePointer<T>.allocate(capacity: 1)
        p.initialize(to: item)
        allocs.append(UnsafeMutableRawPointer(p))
        return UnsafePointer(p)
    }
    func stringView(_ s: String) -> WGPUStringView {
        let bytes = Array(s.utf8)
        let p = UnsafeMutablePointer<CChar>.allocate(capacity: bytes.count + 1)
        for (i, b) in bytes.enumerated() { p[i] = CChar(bitPattern: b) }
        p[bytes.count] = 0
        allocs.append(UnsafeMutableRawPointer(p))
        return WGPUStringView(data: p, length: bytes.count)
    }
    deinit { for a in allocs { a.deallocate() } }
}
