// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Headless acceptance through the same bindings used by the native game.
#include "esengine/bindings/BoundarySpan.hpp"
#include "esengine/bindings/RenderBinding.hpp"
#include "esengine/bindings/RendererBindings.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/Sprite.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include <webgpu/webgpu_cpp.h>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <future>

using namespace esengine;

static bool draw(WGPUInstance instance, WGPUAdapter adapter, WGPUDevice device) {
    EstellaContext context;
    g_activeContext = &context;
    if (!startRenderThread(context)) return false;
    auto& thread = context.renderThread();
    const auto caller = std::this_thread::get_id();
    if (!thread.invoke([&] { return thread.isOwner() && std::this_thread::get_id() != caller; })) return false;
    if (!thread.invoke([&] { return context.init(makeUnique<WebGPUDevice>(device, instance, adapter)); })) return false;
    struct {
        glm::mat4 matrix{1};
        std::array<u8, 32 * 32 * 4> pixels{};
    } input;
    setBoundaryRegion(reinterpret_cast<uintptr_t>(&input), sizeof(input));
    ES_RENDER_BIND(renderer_init)(32, 32);
    const auto target = ES_RENDER_BIND(renderer_createTarget)(32, 32, 1);
    if (!target) return false;
    ecs::Registry world;
    for (unsigned i = 0; i < 5; ++i) {
        const auto entity = world.create();
        world.emplace<ecs::Transform>(entity);
        auto& sprite = world.emplace<ecs::Sprite>(entity);
        sprite.color = i % 2 ? glm::vec4(1,0,0,1) : glm::vec4(0,1,0,1);
        sprite.size = {1,1};
        input.matrix = glm::mat4(1);
        ES_RENDER_BIND(renderer_beginFrame)(i / 60.f);
        ES_RENDER_BIND(renderer_setViewport)(0, 0, 32, 32);
        ES_RENDER_BIND(renderer_begin)(reinterpret_cast<uintptr_t>(&input.matrix), target, 3, 0,0,1,1, 0,0,32,32);
        ES_RENDER_BIND(renderer_submitAll)(world, 0, 0, 32, 32);
        // Hold the owner until AFTER the scene entity and its input matrix are gone.
        std::promise<void> release;
        auto gate = release.get_future();
        thread.enqueue([&gate] { gate.wait(); });
        ES_RENDER_BIND(renderer_flush)();
        ES_RENDER_BIND(renderer_end)();
        const auto fence = renderThread_fence();
        const bool outstanding = !renderThread_complete(fence);
        world.destroy(entity);
        input.matrix = glm::mat4(0);
        release.set_value();
        thread.wait(static_cast<RenderThread::Fence>(fence));
        if (!outstanding || !renderThread_complete(fence)) return false;
        const u32 read = ES_RENDER_BIND(renderer_captureTarget)(target, 32, 32);
        ES_RENDER_BIND(renderer_endFrame)();
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (ES_RENDER_BIND(renderer_pollFrameCapture)(read) == 0 && std::chrono::steady_clock::now() < deadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        if (!ES_RENDER_BIND(renderer_takeTargetCapture)(read, reinterpret_cast<uintptr_t>(input.pixels.data()), input.pixels.size())) return false;
        const u8* center = input.pixels.data() + 4 * (16 * 32 + 16);
        if (center[i % 2 ? 0 : 1] < 250 || center[2] > 4 || input.pixels[2] < 250) {
            std::fprintf(stderr, "frame %u center %u,%u,%u background %u,%u,%u\n", i,
                         center[0], center[1], center[2], input.pixels[0], input.pixels[1], input.pixels[2]);
            return false;
        }
    }
    ES_RENDER_BIND(renderer_releaseTarget)(target);
    renderThread_flush();
    context.shutdown();
    g_activeContext = nullptr;
    return !thread.enabled();
}

int main() {
    const WGPUInstanceFeatureName timed = WGPUInstanceFeatureName_TimedWaitAny;
    WGPUInstanceDescriptor desc{};
    desc.requiredFeatures = &timed;
    desc.requiredFeatureCount = 1;
    auto instance = wgpu::Instance::Acquire(wgpuCreateInstance(&desc));
    WGPUAdapter rawAdapter{};
    WGPURequestAdapterCallbackInfo adapterCallback{};
    adapterCallback.mode = WGPUCallbackMode_WaitAnyOnly;
    adapterCallback.userdata1 = &rawAdapter;
    adapterCallback.callback = [](WGPURequestAdapterStatus status, WGPUAdapter value, WGPUStringView, void* out, void*) {
        if (status == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(out) = value;
    };
    WGPUFutureWaitInfo a{wgpuInstanceRequestAdapter(instance.Get(), nullptr, adapterCallback), 0};
    wgpuInstanceWaitAny(instance.Get(), 1, &a, UINT64_MAX);
    if (!rawAdapter) return 1;
    auto adapter = wgpu::Adapter::Acquire(rawAdapter);
    WGPUDevice rawDevice{};
    WGPUDeviceDescriptor deviceDesc{};
    std::atomic_uint errors{0};
    deviceDesc.uncapturedErrorCallbackInfo.userdata1 = &errors;
    deviceDesc.uncapturedErrorCallbackInfo.callback = [](WGPUDevice const*, WGPUErrorType, WGPUStringView msg, void* n, void*) {
        ++*static_cast<std::atomic_uint*>(n);
        std::fprintf(stderr, "Dawn: %.*s\n", static_cast<int>(msg.length), msg.data);
    };
    WGPURequestDeviceCallbackInfo deviceCallback{};
    deviceCallback.mode = WGPUCallbackMode_WaitAnyOnly;
    deviceCallback.userdata1 = &rawDevice;
    deviceCallback.callback = [](WGPURequestDeviceStatus status, WGPUDevice value, WGPUStringView, void* out, void*) {
        if (status == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(out) = value;
    };
    WGPUFutureWaitInfo d{wgpuAdapterRequestDevice(adapter.Get(), &deviceDesc, deviceCallback), 0};
    wgpuInstanceWaitAny(instance.Get(), 1, &d, UINT64_MAX);
    if (!rawDevice) return 1;
    auto device = wgpu::Device::Acquire(rawDevice);
    if (!draw(instance.Get(), adapter.Get(), device.Get()) || errors.load()) return 1;
    std::puts("Native render thread: five sprite readbacks after entity destruction, CPU fences and shutdown passed.");
}
