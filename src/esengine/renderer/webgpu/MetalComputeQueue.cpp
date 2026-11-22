// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "MetalComputeQueue.hpp"
#include "WebGPUDevice.hpp"

#include <CoreVideo/CVPixelBuffer.h>
#include <IOSurface/IOSurfaceRef.h>
#include <webgpu/webgpu_cpp.h>
#include <algorithm>
#include <array>
#include <future>
#include <unordered_map>
#include <vector>

namespace esengine {
namespace {
struct Endpoint {
    wgpu::SharedTextureMemory memory;
    wgpu::Texture texture;
    wgpu::TextureView view;
};

struct SharedImage {
    Endpoint graphics;
    Endpoint compute;
};

IOSurfaceRef makeSurface(u32 width, u32 height, u32 pixelFormat, u32 bytesPerPixel) {
    const void* keys[] = {kIOSurfaceWidth, kIOSurfaceHeight, kIOSurfacePixelFormat, kIOSurfaceBytesPerElement};
    const i64 values[] = {width, height, pixelFormat, bytesPerPixel};
    CFNumberRef numbers[4];
    const void* entries[4];
    for (unsigned i = 0; i < 4; ++i) {
        numbers[i] = CFNumberCreate(nullptr, kCFNumberSInt64Type, &values[i]);
        entries[i] = numbers[i];
    }
    CFDictionaryRef properties = CFDictionaryCreate(nullptr, keys, entries, 4,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    IOSurfaceRef surface = IOSurfaceCreate(properties);
    CFRelease(properties);
    for (auto number : numbers) CFRelease(number);
    return surface;
}

bool importImage(Endpoint& endpoint, WGPUDevice device, IOSurfaceRef surface, const WGPUTextureDescriptor& desc) {
    WGPUSharedTextureMemoryIOSurfaceDescriptor io = WGPU_SHARED_TEXTURE_MEMORY_IO_SURFACE_DESCRIPTOR_INIT;
    io.ioSurface = surface;
    io.allowStorageBinding = (desc.usage & WGPUTextureUsage_StorageBinding) != 0;
    WGPUSharedTextureMemoryDescriptor shared{};
    shared.nextInChain = &io.chain;
    endpoint.memory = wgpu::SharedTextureMemory::Acquire(wgpuDeviceImportSharedTextureMemory(device, &shared));
    WGPUSharedTextureMemoryProperties properties{};
    if (!endpoint.memory || wgpuSharedTextureMemoryGetProperties(endpoint.memory.Get(), &properties) != WGPUStatus_Success ||
        properties.format != desc.format || (properties.usage & desc.usage) != desc.usage) return false;
    endpoint.texture = wgpu::Texture::Acquire(wgpuSharedTextureMemoryCreateTexture(endpoint.memory.Get(), &desc));
    if (!endpoint.texture) return false;
    endpoint.view = wgpu::TextureView::Acquire(wgpuTextureCreateView(endpoint.texture.Get(), nullptr));
    return !!endpoint.view;
}

void touch(WGPUDevice device, WGPUQueue queue, WGPUTexture image, WGPUBuffer scratch) {
    auto encoder = wgpu::CommandEncoder::Acquire(wgpuDeviceCreateCommandEncoder(device, nullptr));
    WGPUTexelCopyTextureInfo src{};
    src.texture = image;
    WGPUTexelCopyBufferInfo dst{};
    dst.buffer = scratch;
    dst.layout.bytesPerRow = 256;
    dst.layout.rowsPerImage = 1;
    const WGPUExtent3D pixel{1, 1, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder.Get(), &src, &dst, &pixel);
    auto commands = wgpu::CommandBuffer::Acquire(wgpuCommandEncoderFinish(encoder.Get(), nullptr));
    WGPUCommandBuffer raw = commands.Get();
    wgpuQueueSubmit(queue, 1, &raw);
}

struct BufferRange {
    u32 id, offset, words, width;
    bool writable;
    WGPUBuffer graphics, compute;
    SharedImage* image;

    void copy(WGPUCommandEncoder encoder, bool graphicsSide, bool toImage) const {
        WGPUTexelCopyBufferInfo buffer{};
        buffer.buffer = graphicsSide ? graphics : compute;
        buffer.layout.offset = offset;
        buffer.layout.bytesPerRow = (width * 4 + 255u) & ~255u;
        WGPUTexelCopyTextureInfo texture{};
        texture.texture = (graphicsSide ? image->graphics : image->compute).texture.Get();
        auto rows = [&](u32 w, u32 h) {
            const WGPUExtent3D extent{w, h, 1};
            buffer.layout.rowsPerImage = h;
            if (toImage) wgpuCommandEncoderCopyBufferToTexture(encoder, &buffer, &texture, &extent);
            else wgpuCommandEncoderCopyTextureToBuffer(encoder, &texture, &buffer, &extent);
        };
        const u32 full = words / width;
        rows(width, full);
        if (const u32 tail = words % width) {
            texture.origin.y = full;
            buffer.layout.offset += static_cast<u64>(full) * width * 4;
            rows(tail, 1);
        }
    }
};

void copyBuffers(const std::vector<BufferRange>& ranges, WGPUDevice device, WGPUQueue queue,
                 bool graphicsSide, bool toImage, bool outputs) {
    if (ranges.empty() || (outputs && std::none_of(ranges.begin(), ranges.end(), [](auto& r) { return r.writable; }))) return;
    auto encoder = wgpu::CommandEncoder::Acquire(wgpuDeviceCreateCommandEncoder(device, nullptr));
    for (const auto& range : ranges) if (!outputs || range.writable) range.copy(encoder.Get(), graphicsSide, toImage);
    auto commands = wgpu::CommandBuffer::Acquire(wgpuCommandEncoderFinish(encoder.Get(), nullptr));
    WGPUCommandBuffer raw = commands.Get();
    wgpuQueueSubmit(queue, 1, &raw);
}

enum class Transfer { Success, Restored, Lost };

Transfer transfer(Endpoint& from, Endpoint& to, WGPUDevice device) {
    WGPUSharedTextureMemoryEndAccessState end{};
    if (wgpuSharedTextureMemoryEndAccess(from.memory.Get(), from.texture.Get(), &end) != WGPUStatus_Success)
        return Transfer::Lost;

    std::vector<wgpu::SharedFence> imported;
    std::vector<WGPUSharedFence> handles;
    for (size_t i = 0; i < end.fenceCount; ++i) {
        WGPUSharedFenceMTLSharedEventExportInfo event = WGPU_SHARED_FENCE_MTL_SHARED_EVENT_EXPORT_INFO_INIT;
        WGPUSharedFenceExportInfo info{};
        info.nextInChain = &event.chain;
        wgpuSharedFenceExportInfo(end.fences[i], &info);
        if (!event.sharedEvent) break;
        WGPUSharedFenceMTLSharedEventDescriptor metal = WGPU_SHARED_FENCE_MTL_SHARED_EVENT_DESCRIPTOR_INIT;
        metal.sharedEvent = event.sharedEvent;
        WGPUSharedFenceDescriptor fd{};
        fd.nextInChain = &metal.chain;
        auto fence = wgpu::SharedFence::Acquire(wgpuDeviceImportSharedFence(device, &fd));
        if (!fence) break;
        handles.push_back(fence.Get());
        imported.push_back(std::move(fence));
    }

    WGPUSharedTextureMemoryBeginAccessDescriptor begin{};
    begin.initialized = end.initialized;
    begin.fenceCount = end.fenceCount;
    begin.signaledValueCount = end.signaledValueCount;
    begin.signaledValues = end.signaledValues;
    begin.fences = handles.data();
    Transfer result = Transfer::Success;
    if (handles.size() != end.fenceCount ||
        wgpuSharedTextureMemoryBeginAccess(to.memory.Get(), to.texture.Get(), &begin) != WGPUStatus_Success) {
        begin.fences = end.fences;
        result = wgpuSharedTextureMemoryBeginAccess(from.memory.Get(), from.texture.Get(), &begin) == WGPUStatus_Success
                     ? Transfer::Restored : Transfer::Lost;
    }
    wgpuSharedTextureMemoryEndAccessStateFreeMembers(end);
    return result;
}
}  // namespace

struct MetalComputeQueue::State {
    WebGPUDevice& graphics;
    wgpu::Device device;
    WebGPUDevice worker;
    wgpu::Buffer waitBuffer;
    wgpu::Buffer workerScratch;
    std::vector<wgpu::Texture> bufferSurfaces;
    std::vector<BufferRange> pendingCopies;
    std::unordered_map<WGPUTexture, SharedImage> images;
    std::vector<SharedImage*> pending;
    bool healthy = true;

    State(WebGPUDevice& g, wgpu::Device d)
        : graphics(g), device(std::move(d)), worker(device.Get(), g.instance_) {}
};

MetalComputeQueue::MetalComputeQueue(std::unique_ptr<State> state) : state_(std::move(state)) {}

MetalComputeQueue::~MetalComputeQueue() = default;

std::unique_ptr<MetalComputeQueue> MetalComputeQueue::create(WebGPUDevice& graphics) {
    constexpr std::array features{WGPUFeatureName_SharedTextureMemoryIOSurface, WGPUFeatureName_SharedFenceMTLSharedEvent};
    for (auto feature : features) if (!wgpuDeviceHasFeature(graphics.device_, feature)) return {};
    WGPUDeviceDescriptor desc{};
    desc.label = {"Estella async compute", WGPU_STRLEN};
    desc.requiredFeatures = features.data();
    desc.requiredFeatureCount = features.size();
    std::promise<WGPUDevice> request;
    auto result = request.get_future();
    WGPURequestDeviceCallbackInfo cb{};
    cb.mode = WGPUCallbackMode_AllowSpontaneous;
    cb.userdata1 = &request;
    cb.callback = [](WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView, void* result, void*) {
        static_cast<std::promise<WGPUDevice>*>(result)->set_value(status == WGPURequestDeviceStatus_Success ? device : nullptr);
    };
    wgpuAdapterRequestDevice(graphics.adapter_, &desc, cb);
    WGPUDevice raw = result.get();
    if (!raw) return {};
    auto state = std::make_unique<State>(graphics, wgpu::Device::Acquire(raw));
    WGPUBufferDescriptor bd{};
    bd.size = 256;
    bd.usage = WGPUBufferUsage_CopyDst;
    state->waitBuffer = wgpu::Buffer::Acquire(wgpuDeviceCreateBuffer(graphics.device_, &bd));
    if (!state->waitBuffer) return {};
    state->workerScratch = wgpu::Buffer::Acquire(wgpuDeviceCreateBuffer(raw, &bd));
    if (!state->workerScratch) return {};
    return std::unique_ptr<MetalComputeQueue>(new MetalComputeQueue(std::move(state)));
}

bool MetalComputeQueue::available() const { return state_->healthy; }

WGPUTexture MetalComputeQueue::makeTexture(const WGPUTextureDescriptor& desc) {
    if (!available() || desc.dimension != WGPUTextureDimension_2D || desc.size.depthOrArrayLayers != 1 ||
        desc.mipLevelCount != 1 || desc.sampleCount != 1) return nullptr;
    u32 format, bytes;
    switch (desc.format) {
        case WGPUTextureFormat_RGBA8Unorm: format = kCVPixelFormatType_32RGBA; bytes = 4; break;
        case WGPUTextureFormat_RGBA16Float: format = kCVPixelFormatType_64RGBAHalf; bytes = 8; break;
        default: return nullptr;
    }
    IOSurfaceRef surface = makeSurface(desc.size.width, desc.size.height, format, bytes);
    if (!surface) return nullptr;
    SharedImage image;
    bool ok = importImage(image.graphics, state_->graphics.device_, surface, desc) &&
              importImage(image.compute, state_->device.Get(), surface, desc);
    CFRelease(surface);
    WGPUSharedTextureMemoryBeginAccessDescriptor begin{};
    if (!ok || wgpuSharedTextureMemoryBeginAccess(image.graphics.memory.Get(), image.graphics.texture.Get(), &begin)
                   != WGPUStatus_Success) return nullptr;
    WGPUTexture texture = image.graphics.texture.Get();
    state_->images.emplace(texture, std::move(image));
    wgpuTextureAddRef(texture);
    return texture;
}

bool MetalComputeQueue::shareTexture(u32 id) {
    auto& s = *state_;
    auto& rec = s.graphics.textures_.at(id);
    if (s.images.contains(rec.texture)) return true;
    const auto* record = s.graphics.resourceRecords().textures.find(id);
    if (!record || (!record->desc.asyncShareable && !rec.storage) || rec.samples != 1 ||
        rec.mipLevels != 1 || rec.layers != 1 || rec.volume) return false;
    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.format = rec.format;
    td.size = {rec.width, rec.height, 1};
    td.sampleCount = td.mipLevelCount = 1;
    td.usage = wgpuTextureGetUsage(rec.texture);
    auto texture = wgpu::Texture::Acquire(makeTexture(td));
    if (!texture) return false;
    // Targets may have been allocated and rendered before the runtime switch was turned on.
    // Promote only on first use, preserving their contents and the RHI handle attached to each framebuffer.
    auto encoder = wgpu::CommandEncoder::Acquire(wgpuDeviceCreateCommandEncoder(s.graphics.device_, nullptr));
    WGPUTexelCopyTextureInfo src{}, dst{};
    src.texture = rec.texture;
    dst.texture = texture.Get();
    wgpuCommandEncoderCopyTextureToTexture(encoder.Get(), &src, &dst, &td.size);
    auto command = wgpu::CommandBuffer::Acquire(wgpuCommandEncoderFinish(encoder.Get(), nullptr));
    WGPUCommandBuffer raw = command.Get();
    wgpuQueueSubmit(s.graphics.queue_, 1, &raw);
    auto replacement = rec;
    replacement.texture = texture.MoveToCHandle();
    replacement.view = replacement.sampleView = s.images.at(replacement.texture).graphics.view.Get();
    wgpuTextureViewAddRef(replacement.view);
    s.graphics.releaseTexture(rec);
    rec = replacement;
    return true;
}

WGPUTexture MetalComputeQueue::bufferSurface(u32 slot, u32 width, u32 height) {
    auto& s = *state_;
    if (s.bufferSurfaces.size() <= slot) s.bufferSurfaces.resize(slot + 1);
    auto& texture = s.bufferSurfaces[slot];
    if (texture && wgpuTextureGetWidth(texture.Get()) == width && wgpuTextureGetHeight(texture.Get()) == height)
        return texture.Get();
    if (texture) s.images.erase(texture.Get());
    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.size = {width, height, 1};
    td.sampleCount = td.mipLevelCount = 1;
    td.format = WGPUTextureFormat_RGBA8Unorm;
    td.usage = WGPUTextureUsage_CopySrc | WGPUTextureUsage_CopyDst;
    texture = wgpu::Texture::Acquire(makeTexture(td));
    return texture.Get();
}

bool MetalComputeQueue::dispatch(u32 program, const GfxComputeBinding* bindings, u32 count, u32 x, u32 y, u32 z) {
    auto& s = *state_;
    auto& worker = s.worker;
    if (!available() || s.graphics.inPass() || s.graphics.armed_pass_tag_ || (s.graphics.span_open_ && !s.graphics.parallel_span_) ||
        count > WebGPUDevice::kMaxComputeBindings || std::max({x, y, z}) > WebGPUDevice::kMaxWorkgroupsPerDimension)
        return false;
    if (!worker.computes_.contains(program)) {
        const auto* p = s.graphics.resourceRecords().computes.find(program);
        if (!p || !worker.backendCreateCompute(program, {GfxShaderLanguage::WGSL, p->source.c_str(), p->entry.c_str()}, nullptr))
            return false;
    }
    std::vector<std::pair<u32, SharedImage*>> textures;
    std::vector<BufferRange> ranges;
    using Kind = GfxComputeBinding::Kind;
    for (u32 i = 0; i < count; ++i) {
        const auto& b = bindings[i];
        if (b.kind == Kind::Texture || b.kind == Kind::StorageTexture) {
            const u32 id = static_cast<u32>(b.texture);
            const auto original = s.graphics.textures_.find(id);
            if (original == s.graphics.textures_.end() || (b.kind == Kind::StorageTexture && !original->second.storage)) return false;
            if (!shareTexture(id)) return false;
            auto image = s.images.find(original->second.texture);
            if (std::none_of(textures.begin(), textures.end(), [id](auto& t) { return t.first == id; }))
                textures.emplace_back(id, &image->second);
        } else if (b.kind == Kind::StorageRead || b.kind == Kind::Storage) {
            const u32 id = static_cast<u32>(b.buffer);
            auto it = s.graphics.buffers_.find(id);
            if (it == s.graphics.buffers_.end() || it->second.usage != GfxBufferUsage::Storage) return false;
            const u64 allocation = wgpuBufferGetSize(it->second.buffer);
            if (b.offset >= allocation || b.offset % 4) return false;
            const u64 bytes = b.size ? b.size : allocation - b.offset;
            if (!bytes || bytes % 4 || bytes > allocation - b.offset) return false;
            const u32 words = static_cast<u32>(bytes / 4);
            const u32 width = std::min(8192u, words);
            const u32 height = (words + width - 1) / width;
            if (height > 8192) return false;
            const auto surface = bufferSurface(static_cast<u32>(ranges.size()), width, height);
            if (!surface) return false;
            if (!worker.buffers_.contains(id) &&
                !worker.backendCreateBuffer(id, {GfxBufferUsage::Storage, it->second.size}, nullptr)) return false;
            ranges.push_back({id, b.offset, words, width, b.kind == Kind::Storage, it->second.buffer,
                              worker.buffers_.at(id).buffer, &s.images.at(surface)});
        } else if (b.kind == Kind::Uniform) {
            const u32 id = static_cast<u32>(b.buffer);
            const auto* record = s.graphics.resourceRecords().buffers.find(id);
            if (!record || record->content.kind() != GfxContentKind::Retained || record->desc.usage != GfxBufferUsage::Uniform || record->bytes.size() != record->desc.size ||
                record->bytes.empty()) return false;
            auto mirror = worker.buffers_.find(id);
            if (mirror != worker.buffers_.end() && mirror->second.size != record->desc.size) worker.backendDeleteBuffer(id);
            if (worker.buffers_.contains(id)) worker.backendUpdateBuffer(id, 0, record->bytes.data(), record->desc.size);
            else if (!worker.backendCreateBuffer(id, record->desc, record->bytes.data())) return false;
        } else if (b.kind != Kind::Sampler && !(b.kind == Kind::DepthTexture && b.texture == TextureHandle::Invalid)) {
            return false;
        }
    }
    if (ranges.empty() && textures.empty()) return false;
    copyBuffers(ranges, s.graphics.device_, s.graphics.queue_, true, true, false);
    std::vector<SharedImage*> images;
    for (auto [id, image] : textures) images.push_back(image);
    for (auto& range : ranges) images.push_back(range.image);
    for (auto* image : images) {
        const Transfer result = transfer(image->graphics, image->compute, s.device.Get());
        if (result != Transfer::Success) {
            wait(); // Return any earlier textures before retrying the dispatch inline.
            s.healthy = false;
            if (result == Transfer::Lost)
                s.graphics.notifyDeviceLost(GfxDeviceLostReason::Unknown, "Metal shared texture ownership lost");
            return false;
        }
        s.pending.push_back(image);
    }
    copyBuffers(ranges, s.device.Get(), worker.queue_, false, false, false);
    for (auto [id, image] : textures) {
        auto rec = s.graphics.textures_.at(id);
        rec.texture = image->compute.texture.Get();
        rec.view = rec.sampleView = image->compute.view.Get();
        worker.textures_.emplace(id, rec);
    }
    const bool submitted = worker.backendDispatchCompute(program, bindings, count, x, y, z);
    for (auto [id, image] : textures) worker.textures_.erase(id); // Borrowed views.
    if (submitted && !ranges.empty()) {
        copyBuffers(ranges, s.device.Get(), worker.queue_, false, true, true);
        // Signal after the shader even for a read-only buffer. Its staging image was last used before dispatch.
        touch(s.device.Get(), worker.queue_, images.front()->compute.texture.Get(), s.workerScratch.Get());
        s.pendingCopies = std::move(ranges);
    }
    if (!submitted) wait();
    return submitted;
}

void MetalComputeQueue::wait() {
    auto& s = *state_;
    if (s.pending.empty()) return;
    bool ok = true;
    for (SharedImage* image : s.pending) {
        if (transfer(image->compute, image->graphics, s.graphics.device_) != Transfer::Success) ok = false;
    }
    auto* image = s.pending.front();
    s.pending.clear();
    if (!ok) {
        s.healthy = false;
        s.graphics.notifyDeviceLost(GfxDeviceLostReason::Unknown, "Metal compute queue could not return its textures");
        return;
    }
    // Dawn consumes the imported event on first texture use. Touch one texel so even subsequent
    // graphics commands that use none of these images are ordered after the requested fence.
    touch(s.graphics.device_, s.graphics.queue_, image->graphics.texture.Get(), s.waitBuffer.Get());
    copyBuffers(s.pendingCopies, s.graphics.device_, s.graphics.queue_, true, false, true);
    s.pendingCopies.clear();
}

void MetalComputeQueue::forgetTexture(WGPUTexture texture) {
    auto it = state_->images.find(texture);
    if (it == state_->images.end()) return;
    if (std::find(state_->pending.begin(), state_->pending.end(), &it->second) != state_->pending.end())
        state_->graphics.manualComputeBarrier();
    state_->images.erase(it);
}
void MetalComputeQueue::forgetBuffer(u32 id) {
    if (std::any_of(state_->pendingCopies.begin(), state_->pendingCopies.end(), [id](auto& range) { return range.id == id; }))
        state_->graphics.manualComputeBarrier();
    state_->worker.backendDeleteBuffer(id);
}
void MetalComputeQueue::forgetProgram(u32 id) { state_->worker.backendDeleteCompute(id); }

bool WebGPUDevice::supportsAsyncCompute() const {
    if (metal_compute_attempted_) return metal_compute_ && metal_compute_->available();
    return device_ && adapter_ && instance_ && queue_ && wgpuDeviceHasFeature(device_, WGPUFeatureName_SharedTextureMemoryIOSurface) &&
           wgpuDeviceHasFeature(device_, WGPUFeatureName_SharedFenceMTLSharedEvent);
}

void WebGPUDevice::backendSetAsyncComputeEnabled(bool enabled) {
    if (enabled && !metal_compute_attempted_ && supportsAsyncCompute()) {
        metal_compute_attempted_ = true;
        metal_compute_ = MetalComputeQueue::create(*this);
    }
}

bool WebGPUDevice::backendDispatchAsyncCompute(AsyncComputePriority, u32 id, const GfxComputeBinding* bindings,
                                               u32 count, u32 x, u32 y, u32 z) {
    // Metal's public Dawn interface accepts no queue priority. Priority is a scheduling hint.
    return metal_compute_ && metal_compute_->dispatch(id, bindings, count, x, y, z);
}

void WebGPUDevice::backendWaitAsyncCompute() {
    // Submit any independent draw recorded before the wait while it can still overlap the worker.
    if (inPass()) endRenderPass();
    if (metal_compute_) metal_compute_->wait();
}
}  // namespace esengine
