import Foundation
import Cwgpu

/// Native WebGPU (wgpu-native) instance/adapter/device/queue — the native GPU the Fork A
/// render bridge drives (REARCH_NATIVE.md §3.3.2). The JS WebGPU shim's host functions will
/// call into an object like this; standing it up + proving it from Swift is the first slice
/// of the native backend.
public final class WgpuContext {
    public let instance: WGPUInstance
    public let adapter: WGPUAdapter
    public let device: WGPUDevice
    public let queue: WGPUQueue

    private var surface: WGPUSurface?
    private var surfaceFormat = WGPUTextureFormat_BGRA8Unorm

    public init() throws {
        guard let inst = wgpuCreateInstance(nil) else { throw HostError.bootFailure("wgpuCreateInstance failed") }
        instance = inst
        adapter = try WgpuContext.requestAdapter(inst)
        device = try WgpuContext.requestDevice(inst, adapter)
        guard let q = wgpuDeviceGetQueue(device) else { throw HostError.bootFailure("wgpuDeviceGetQueue failed") }
        queue = q
    }

    deinit {
        if let surface { wgpuSurfaceRelease(surface) }
        wgpuQueueRelease(queue)
        wgpuDeviceRelease(device)
        wgpuAdapterRelease(adapter)
        wgpuInstanceRelease(instance)
    }

    /// Wrap a CAMetalLayer as the WebGPU surface and (re)configure the swapchain. `metalLayer`
    /// is the CAMetalLayer object pointer (Unmanaged.passUnretained(...).toOpaque()).
    public func configureSurface(metalLayer: UnsafeMutableRawPointer, width: Int, height: Int) {
        if surface == nil {
            var metal = WGPUSurfaceSourceMetalLayer()
            metal.chain.sType = WGPUSType_SurfaceSourceMetalLayer
            metal.layer = metalLayer
            withUnsafeMutablePointer(to: &metal) { mptr in
                var desc = WGPUSurfaceDescriptor()
                desc.nextInChain = UnsafeMutableRawPointer(mptr).assumingMemoryBound(to: WGPUChainedStruct.self)
                surface = wgpuInstanceCreateSurface(instance, &desc)
            }
        }
        guard let surface else { return }
        var cfg = WGPUSurfaceConfiguration()
        cfg.device = device
        cfg.format = surfaceFormat
        cfg.usage = WGPUTextureUsage_RenderAttachment
        cfg.width = UInt32(width)
        cfg.height = UInt32(height)
        cfg.alphaMode = WGPUCompositeAlphaMode_Auto
        cfg.presentMode = WGPUPresentMode_Fifo
        wgpuSurfaceConfigure(surface, &cfg)
    }

    /// Acquire the surface's current frame, clear it, submit and present — an on-screen frame
    /// through the real native GPU. The engine-driven path (slice 4) will replace the clear
    /// with the engine's WebGPU command stream.
    public func presentClear(_ c: (r: Double, g: Double, b: Double, a: Double)) {
        guard let surface else { return }
        var st = WGPUSurfaceTexture()
        wgpuSurfaceGetCurrentTexture(surface, &st)
        guard st.status == WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal
                || st.status == WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal,
              let tex = st.texture, let view = wgpuTextureCreateView(tex, nil),
              let enc = wgpuDeviceCreateCommandEncoder(device, nil) else { return }
        var color = WGPURenderPassColorAttachment()
        color.view = view
        color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED
        color.loadOp = WGPULoadOp_Clear
        color.storeOp = WGPUStoreOp_Store
        color.clearValue = WGPUColor(r: c.r, g: c.g, b: c.b, a: c.a)
        withUnsafePointer(to: &color) { colorPtr in
            var pass = WGPURenderPassDescriptor()
            pass.colorAttachmentCount = 1
            pass.colorAttachments = colorPtr
            let rp = wgpuCommandEncoderBeginRenderPass(enc, &pass)
            wgpuRenderPassEncoderEnd(rp)
            wgpuRenderPassEncoderRelease(rp)
        }
        if let cmd = wgpuCommandEncoderFinish(enc, nil) {
            withUnsafePointer(to: cmd) { wgpuQueueSubmit(queue, 1, $0) }
            wgpuCommandBufferRelease(cmd)
        }
        _ = wgpuSurfacePresent(surface)
        wgpuCommandEncoderRelease(enc)
        wgpuTextureViewRelease(view)
        wgpuTextureRelease(tex)
    }

    /// Human-readable adapter identity (proves the native GPU is live).
    public func adapterDescription() -> String {
        var info = WGPUAdapterInfo()
        guard wgpuAdapterGetInfo(adapter, &info) == WGPUStatus_Success else { return "<no adapter info>" }
        defer { wgpuAdapterInfoFreeMembers(info) }
        return "\(WgpuContext.string(info.device)) [\(WgpuContext.string(info.description))] backend=\(info.backendType.rawValue)"
    }

    // MARK: - async request helpers (wgpu-native settles them via processEvents)

    private final class Box<T> { var value: T? }

    private static func requestAdapter(_ inst: WGPUInstance) throws -> WGPUAdapter {
        let box = Box<WGPUAdapter>()
        let boxPtr = Unmanaged.passRetained(box).toOpaque()
        defer { Unmanaged<Box<WGPUAdapter>>.fromOpaque(boxPtr).release() }
        var cb = WGPURequestAdapterCallbackInfo()
        cb.mode = WGPUCallbackMode_AllowProcessEvents
        cb.userdata1 = boxPtr
        cb.callback = { status, adapter, _, ud1, _ in
            let box = Unmanaged<Box<WGPUAdapter>>.fromOpaque(ud1!).takeUnretainedValue()
            if status == WGPURequestAdapterStatus_Success { box.value = adapter }
        }
        _ = wgpuInstanceRequestAdapter(inst, nil, cb)
        var spins = 0
        while box.value == nil && spins < 1000 { wgpuInstanceProcessEvents(inst); spins += 1 }
        guard let a = box.value else { throw HostError.bootFailure("requestAdapter returned no adapter") }
        return a
    }

    private static func requestDevice(_ inst: WGPUInstance, _ adapter: WGPUAdapter) throws -> WGPUDevice {
        let box = Box<WGPUDevice>()
        let boxPtr = Unmanaged.passRetained(box).toOpaque()
        defer { Unmanaged<Box<WGPUDevice>>.fromOpaque(boxPtr).release() }
        var cb = WGPURequestDeviceCallbackInfo()
        cb.mode = WGPUCallbackMode_AllowProcessEvents
        cb.userdata1 = boxPtr
        cb.callback = { status, device, _, ud1, _ in
            let box = Unmanaged<Box<WGPUDevice>>.fromOpaque(ud1!).takeUnretainedValue()
            if status == WGPURequestDeviceStatus_Success { box.value = device }
        }
        _ = wgpuAdapterRequestDevice(adapter, nil, cb)
        var spins = 0
        while box.value == nil && spins < 1000 { wgpuInstanceProcessEvents(inst); spins += 1 }
        guard let d = box.value else { throw HostError.bootFailure("requestDevice returned no device") }
        return d
    }

    private static func string(_ sv: WGPUStringView) -> String {
        guard let data = sv.data, sv.length > 0 else { return "" }
        return String(decoding: UnsafeRawBufferPointer(start: data, count: sv.length), as: UTF8.self)
    }
}

public extension WgpuContext {
    /// Clear an offscreen RGBA8 texture to `clear` and read the top-left pixel back — proves
    /// the full render + submit + readback path on the real GPU, headlessly (no window).
    /// Returns the pixel as (r,g,b,a) bytes.
    func offscreenClearReadback(width: Int, height: Int,
                                clear: (r: Double, g: Double, b: Double, a: Double)) throws
        -> (UInt8, UInt8, UInt8, UInt8) {
        // Render target + a 256-row-aligned readback buffer (WebGPU copy alignment rule).
        var texDesc = WGPUTextureDescriptor()
        texDesc.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc
        texDesc.dimension = WGPUTextureDimension_2D
        texDesc.size = WGPUExtent3D(width: UInt32(width), height: UInt32(height), depthOrArrayLayers: 1)
        texDesc.format = WGPUTextureFormat_RGBA8Unorm
        texDesc.mipLevelCount = 1
        texDesc.sampleCount = 1
        guard let tex = wgpuDeviceCreateTexture(device, &texDesc),
              let view = wgpuTextureCreateView(tex, nil) else { throw HostError.bootFailure("createTexture/View") }
        defer { wgpuTextureViewRelease(view); wgpuTextureRelease(tex) }

        let bytesPerRow = ((width * 4 + 255) / 256) * 256
        var bufDesc = WGPUBufferDescriptor()
        bufDesc.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead
        bufDesc.size = UInt64(bytesPerRow * height)
        guard let buf = wgpuDeviceCreateBuffer(device, &bufDesc) else { throw HostError.bootFailure("createBuffer") }
        defer { wgpuBufferRelease(buf) }

        // Encode: a clear-only render pass, then copy the texture into the readback buffer.
        guard let enc = wgpuDeviceCreateCommandEncoder(device, nil) else { throw HostError.bootFailure("encoder") }
        var color = WGPURenderPassColorAttachment()
        color.view = view
        color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED
        color.loadOp = WGPULoadOp_Clear
        color.storeOp = WGPUStoreOp_Store
        color.clearValue = WGPUColor(r: clear.r, g: clear.g, b: clear.b, a: clear.a)
        withUnsafePointer(to: &color) { colorPtr in
            var pass = WGPURenderPassDescriptor()
            pass.colorAttachmentCount = 1
            pass.colorAttachments = colorPtr
            let rp = wgpuCommandEncoderBeginRenderPass(enc, &pass)
            wgpuRenderPassEncoderEnd(rp)
            wgpuRenderPassEncoderRelease(rp)
        }

        var src = WGPUTexelCopyTextureInfo()
        src.texture = tex
        src.mipLevel = 0
        src.origin = WGPUOrigin3D(x: 0, y: 0, z: 0)
        src.aspect = WGPUTextureAspect_All
        var dst = WGPUTexelCopyBufferInfo()
        dst.buffer = buf
        dst.layout.offset = 0
        dst.layout.bytesPerRow = UInt32(bytesPerRow)
        dst.layout.rowsPerImage = UInt32(height)
        var ext = WGPUExtent3D(width: UInt32(width), height: UInt32(height), depthOrArrayLayers: 1)
        wgpuCommandEncoderCopyTextureToBuffer(enc, &src, &dst, &ext)

        guard let cmd = wgpuCommandEncoderFinish(enc, nil) else { throw HostError.bootFailure("finish") }
        withUnsafePointer(to: cmd) { wgpuQueueSubmit(queue, 1, $0) }
        wgpuCommandBufferRelease(cmd)
        wgpuCommandEncoderRelease(enc)

        // Map the buffer and read the first pixel.
        final class MapBox { var done = false; var ok = false }
        let mbox = MapBox()
        let mboxPtr = Unmanaged.passRetained(mbox).toOpaque()
        defer { Unmanaged<MapBox>.fromOpaque(mboxPtr).release() }
        var mcb = WGPUBufferMapCallbackInfo()
        mcb.mode = WGPUCallbackMode_AllowProcessEvents
        mcb.userdata1 = mboxPtr
        mcb.callback = { status, _, ud1, _ in
            let b = Unmanaged<MapBox>.fromOpaque(ud1!).takeUnretainedValue()
            b.ok = (status == WGPUMapAsyncStatus_Success); b.done = true
        }
        _ = wgpuBufferMapAsync(buf, WGPUMapMode_Read, 0, Int(bufDesc.size), mcb)
        var spins = 0
        while !mbox.done && spins < 100000 { wgpuInstanceProcessEvents(instance); spins += 1 }
        guard mbox.ok, let raw = wgpuBufferGetMappedRange(buf, 0, Int(bufDesc.size)) else {
            throw HostError.bootFailure("buffer map failed")
        }
        let p = raw.assumingMemoryBound(to: UInt8.self)
        let pixel = (p[0], p[1], p[2], p[3])
        wgpuBufferUnmap(buf)
        return pixel
    }
}
