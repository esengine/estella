// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Headless Metal acceptance. Both queues execute the same WGSL and the results are read through the graphics device.
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include <webgpu/webgpu_cpp.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

using namespace esengine;

static bool check(bool condition, const char* message) {
    std::printf("%s %s\n", condition ? "ok" : "FAIL", message);
    return condition;
}

static bool readBytes(WebGPUDevice& gfx, WGPUInstance instance, ReadbackHandle read, void* dst, usize size) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (gfx.pollReadback(read) == GfxReadbackStatus::Pending && std::chrono::steady_clock::now() < deadline) {
        wgpuInstanceProcessEvents(instance);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return gfx.takeReadback(read, dst, size);
}

static bool exercise(WGPUInstance instance, WGPUAdapter adapter, WGPUDevice device) {
    WebGPUDevice gfx(device, instance, adapter);
    gfx.init();
    bool ok = true;
#ifdef ES_ENABLE_METAL_ASYNC_COMPUTE
    ok &= check(gfx.supportsAsyncCompute(), "independent Metal compute queue available");
#else
    ok &= check(!gfx.supportsAsyncCompute(), "compile-time single-queue mode");
#endif
    const char* wgsl = R"(
        @group(0) @binding(0) var src: texture_2d<f32>;
        @group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
        @group(0) @binding(2) var<uniform> increment: vec4f;
        @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
            let p = vec2i(id.xy);
            textureStore(dst, p, textureLoad(src, p, 0) + increment);
        })";
    auto program = gfx.createCompute({GfxShaderLanguage::WGSL, wgsl, "main"});
    TextureDesc td{};
    td.width = td.height = 8;
    td.storage = true;
    std::array<u8, 256> seed{};
    for (size_t i = 0; i < seed.size(); ++i) seed[i] = i % 97;
    auto input = gfx.createTexture(td, GfxContent::retained(), seed.data());
    auto intermediate = gfx.createTexture(td, GfxContent::transient(), nullptr);
    auto output = gfx.createTexture(td, GfxContent::transient(), nullptr);
    const f32 amount[4] = {7.f / 255, 0, 0, 0};
    auto uniform = gfx.createBuffer({GfxBufferUsage::Uniform, sizeof(amount), true}, GfxContent::retained(), amount);
    auto dispatch = [&](TextureHandle src, TextureHandle dst) {
        const GfxComputeBinding bindings[] = {GfxComputeBinding::sampled(0, src), GfxComputeBinding::storageTexture(1, dst),
                                               GfxComputeBinding::uniform(2, uniform)};
        return gfx.dispatchCompute(program, bindings, 3, 8, 8);
    };
    for (bool enabled : {false, true, false}) {
        gfx.setAsyncComputeEnabled(enabled);
        ok &= check(gfx.beginAsyncComputeJob(), "job opened");
        ok &= check(!gfx.beginAsyncComputeJob(), "nested scope refused");
        ok &= check(dispatch(input, intermediate), "first dispatch");
        gfx.manualComputeBarrier();
        ok &= check(dispatch(intermediate, output), "dependent dispatch after barrier");
        auto fence = gfx.endAsyncComputeJob();
        ok &= check((fence != kNoAsyncComputeFence) == (enabled && gfx.supportsAsyncCompute()), "fence reflects actual queue");
        gfx.graphicsWaitOnAsyncComputeJob(kNoAsyncComputeFence);
        gfx.graphicsWaitOnAsyncComputeJob(fence);
        gfx.graphicsWaitOnAsyncComputeJob(fence);
        auto read = gfx.requestTextureReadback(output);
        std::array<u8, 256> actual{};
        ok &= check(readBytes(gfx, instance, read, actual.data(), actual.size()), "graphics queue readback");
        auto expected = seed;
        for (size_t i = 0; i < expected.size(); i += 4) expected[i] += 14;
        ok &= check(actual == expected, "every output channel matches after two dispatches");
    }
    TextureDesc ordinary{};
    ordinary.width = ordinary.height = 8;
    auto asset = gfx.createTexture(ordinary, GfxContent::retained(), seed.data());
    gfx.setAsyncComputeEnabled(true);
    gfx.beginAsyncComputeJob();
    ok &= check(dispatch(asset, output) && gfx.endAsyncComputeJob() == kNoAsyncComputeFence,
                "non-shareable texture runs inline on a capable device");
    gfx.deleteTexture(asset);

    const char* hdrShader = R"(
        @group(0) @binding(0) var dst: texture_storage_2d<rgba16float, write>;
        @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
            textureStore(dst, vec2i(id.xy), vec4f(0.5, 0.5, 0.5, 0.5));
        })";
    auto hdrProgram = gfx.createCompute({GfxShaderLanguage::WGSL, hdrShader, "main"});
    td.format = GfxPixelFormat::RGBA16F;
    auto hdr = gfx.createTexture(td, GfxContent::transient(), nullptr);
    const GfxComputeBinding hdrBindings[] = {GfxComputeBinding::storageTexture(0, hdr),
        GfxComputeBinding::depth(4, TextureHandle::Invalid), GfxComputeBinding::sampler(5, TextureFilter::Linear)};
    const u32 timer = gfx.createTimerQuery();
    if (timer) gfx.beginTimerQuery(timer);
    gfx.beginAsyncComputeJob();
    ok &= check(gfx.dispatchCompute(hdrProgram, hdrBindings, 3, 8, 8), "HDR post-process dispatch");
    auto hdrFence = gfx.endAsyncComputeJob();
    ok &= check((hdrFence > 0) == gfx.supportsAsyncCompute(), "HDR uses the eligible queue");
    if (timer) {
        // Enough submissions to span the native timer's quantization interval.
        for (int i = 0; i < 4 && gfx.supportsAsyncCompute(); ++i) {
            gfx.beginAsyncComputeJob();
            gfx.dispatchCompute(hdrProgram, hdrBindings, 3, 8, 8);
            gfx.endAsyncComputeJob();
        }
        gfx.endTimerQuery(); // The closing timestamp joins any outstanding job first.
        u64 elapsed = 0;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        bool ready = false;
        while (!(ready = gfx.getTimerQueryNs(timer, &elapsed)) && std::chrono::steady_clock::now() < deadline) {
            wgpuInstanceProcessEvents(instance);
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        // A single inline pass may begin and end within the same timestamp quantum.
        ok &= check(ready && (!gfx.supportsAsyncCompute() || elapsed > 0),
                    "frame GPU timestamps include the compute job and join");
    }
    gfx.graphicsWaitOnAsyncComputeJob(hdrFence);
    std::array<u16, 256> half{};
    ok &= check(readBytes(gfx, instance, gfx.requestTextureReadback(hdr), half.data(), sizeof(half)) &&
                std::all_of(half.begin(), half.end(), [](u16 bits) { return bits == 0x3800; }), "HDR half-float pixels match");
    gfx.deleteCompute(hdrProgram);
    gfx.deleteTexture(hdr);

    const char* transform = R"(
        @group(0) @binding(0) var<storage, read_write> values: array<u32>;
        @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
            values[id.x] = values[id.x] * 2u + 1u;
        })";
    auto storageProgram = gfx.createCompute({GfxShaderLanguage::WGSL, transform, "main"});
    std::array<u32, 8427> words{};
    for (size_t i = 0; i < words.size(); ++i) words[i] = static_cast<u32>(i);
    auto buffer = gfx.createBuffer({GfxBufferUsage::Storage, sizeof(words)}, GfxContent::transient(), words.data());
    const auto binding = GfxComputeBinding::storage(0, buffer);
    ok &= check(gfx.dispatchCompute(storageProgram, &binding, 1, words.size()), "graphics produces storage buffer");
    gfx.setAsyncComputeEnabled(true);
    ok &= check(gfx.beginAsyncComputeJob(AsyncComputePriority::High), "high-priority job opened");
    constexpr u32 first = 64, count = 8291;
    const auto subrange = GfxComputeBinding::storage(0, buffer, first * 4, count * 4);
    ok &= check(gfx.dispatchCompute(storageProgram, &subrange, 1, count), "compute modifies a non-aligned row count at a buffer offset");
    const auto bufferFence = gfx.endAsyncComputeJob();
#ifdef ES_ENABLE_METAL_ASYNC_COMPUTE
    ok &= check(bufferFence > 0, "storage buffer ran on the independent queue");
#else
    ok &= check(bufferFence == kNoAsyncComputeFence, "storage buffer ran inline");
#endif
    gfx.setAsyncComputeEnabled(false); // Disabling joins outstanding writes.
    std::array<u32, 8427> result{};
    ok &= check(readBytes(gfx, instance, gfx.requestBufferReadback(buffer, 0, sizeof(result)), result.data(), sizeof(result)),
                "storage buffer read back on graphics");
    for (size_t i = 0; i < words.size(); ++i) {
        words[i] = words[i] * 2 + 1;
        if (i >= first && i < first + count) words[i] = words[i] * 2 + 1;
    }
    ok &= check(result == words, "GPU-produced buffer survived first use on the other queue");
    gfx.deleteBuffer(buffer);
    gfx.deleteCompute(storageProgram);
    gfx.deleteCompute(program);
    gfx.deleteBuffer(uniform);
    gfx.deleteTexture(output);
    gfx.deleteTexture(intermediate);
    gfx.deleteTexture(input);
    return ok;
}

int main() {
    const WGPUInstanceFeatureName featuresRequired[] = {WGPUInstanceFeatureName_TimedWaitAny,
#ifdef ES_ENABLE_METAL_ASYNC_COMPUTE
        WGPUInstanceFeatureName_MultipleDevicesPerAdapter,
#endif
    };
    WGPUInstanceDescriptor instanceDesc{};
    instanceDesc.requiredFeatureCount = std::size(featuresRequired);
    instanceDesc.requiredFeatures = featuresRequired;
    auto instance = wgpu::Instance::Acquire(wgpuCreateInstance(&instanceDesc));
    WGPURequestAdapterOptions opts{};
    opts.backendType = WGPUBackendType_Metal;
    WGPUAdapter rawAdapter = nullptr;
    WGPURequestAdapterCallbackInfo adapterCb{};
    adapterCb.mode = WGPUCallbackMode_WaitAnyOnly;
    adapterCb.userdata1 = &rawAdapter;
    adapterCb.callback = [](WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView, void* out, void*) {
        if (status == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(out) = adapter;
    };
    WGPUFutureWaitInfo a{wgpuInstanceRequestAdapter(instance.Get(), &opts, adapterCb), 0};
    wgpuInstanceWaitAny(instance.Get(), 1, &a, UINT64_MAX);
    if (!check(rawAdapter, "Metal adapter")) return 1;
    auto adapter = wgpu::Adapter::Acquire(rawAdapter);
    WGPUDeviceDescriptor dd{};
    std::vector<WGPUFeatureName> features;
#ifdef ES_ENABLE_METAL_ASYNC_COMPUTE
    features = {WGPUFeatureName_SharedTextureMemoryIOSurface, WGPUFeatureName_SharedFenceMTLSharedEvent};
#endif
    if (wgpuAdapterHasFeature(adapter.Get(), WGPUFeatureName_TimestampQuery)) features.push_back(WGPUFeatureName_TimestampQuery);
    dd.requiredFeatures = features.data();
    dd.requiredFeatureCount = features.size();
    std::atomic_uint errors{0};
    dd.uncapturedErrorCallbackInfo.userdata1 = &errors;
    dd.uncapturedErrorCallbackInfo.callback = [](WGPUDevice const*, WGPUErrorType, WGPUStringView message, void* count, void*) {
        ++*static_cast<std::atomic_uint*>(count);
        std::fprintf(stderr, "Dawn: %.*s\n", static_cast<int>(message.length), message.data);
    };
    WGPUDevice rawDevice = nullptr;
    WGPURequestDeviceCallbackInfo deviceCb{};
    deviceCb.mode = WGPUCallbackMode_WaitAnyOnly;
    deviceCb.userdata1 = &rawDevice;
    deviceCb.callback = [](WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView, void* out, void*) {
        if (status == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(out) = device;
    };
    WGPUFutureWaitInfo d{wgpuAdapterRequestDevice(adapter.Get(), &dd, deviceCb), 0};
    wgpuInstanceWaitAny(instance.Get(), 1, &d, UINT64_MAX);
    if (!check(rawDevice, "Dawn device")) return 1;
    auto device = wgpu::Device::Acquire(rawDevice);
    const bool ok = exercise(instance.Get(), adapter.Get(), device.Get());
    return ok && errors.load() == 0 ? 0 : 1;
}
