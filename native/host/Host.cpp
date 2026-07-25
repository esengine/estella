// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Host.cpp
 * @brief   Boot, the frame, and the lifecycle signals — the entry points a
 *          platform's event loop drives (see Host.hpp).
 * @details What is left in C++ once the engine is native and the game is the real
 *          SDK: bring Dawn up, hand the engine its device, start the JS runtime,
 *          and then, each frame, let the SDK's App tick and flip the swapchain. The
 *          frame itself belongs to the SDK — its render system resolves the
 *          scene's cameras and drives RenderFrame through the generated
 *          es_renderer_* bindings, the same code path the web build takes.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include "esengine/bindings/ActiveContext.hpp"   // g_activeContext — the context the generated bindings act on
#include "esengine/core/World.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"

#include <glm/gtc/matrix_transform.hpp>

using namespace esengine;

namespace eshost {
namespace {

/** Has the SDK's render pipeline taken over the frame? It declares itself through
 *  `es_jsOwnsFrame` (see HOST_FLAGS in the SDK's nativeBindings) once installed. */
bool jsOwnsFrame(HostState& h) {
    JSValue global = JS_GetGlobalObject(h.js);
    JSValue v = JS_GetPropertyStr(h.js, global, "es_jsOwnsFrame");
    const bool owns = JS_ToBool(h.js, v) != 0;
    JS_FreeValue(h.js, v);
    JS_FreeValue(h.js, global);
    return owns;
}

/** The clear colour of the host's fallback pass. A game's own clear colour comes
 *  from its Canvas, through the SDK's pipeline; this only paints the frames where
 *  that pipeline is not installed. */
constexpr glm::vec4 kFallbackClear{0.07f, 0.08f, 0.12f, 1.0f};

/** One full-viewport pass, for a host build whose renderer bindings are absent.
 *  A shipped app never takes this path (they are generated); it exists so such a
 *  build shows the scene rather than a blank surface. */
void fallbackFrame(HostState& h) {
    auto& ctx = *h.ctx;
    ctx.require<RenderContext>().setFrameTime((f32)h.frame / 60.0f, (u32)h.w, (u32)h.h);
    World world{*h.registry, ctx.services(), 1.0f / 60.0f};
    ctx.require<ecs::TransformSystem>().update(world);
    const glm::mat4 vp = glm::ortho(0.0f, h.w, 0.0f, h.h);
    auto& rf = ctx.require<RenderFrame>();
    rf.begin(vp, 0, RenderFrame::PassClear{true, true, kFallbackClear});
    rf.collectAll(*h.registry);
    rf.flush();
    rf.end();
}

/** Ask Dawn for an adapter and a device on the platform's backend, enabling the
 *  block-compression families this adapter supports (a device rejects a format it
 *  did not opt into, even when the adapter advertises it). */
bool createDevice(HostState& h) {
    WGPUInstanceFeatureName feats[] = {WGPUInstanceFeatureName_TimedWaitAny};
    WGPUInstanceDescriptor idesc = {};
    idesc.requiredFeatureCount = 1;
    idesc.requiredFeatures = feats;
    h.instance = wgpuCreateInstance(&idesc);

    WGPURequestAdapterOptions opts = {};
    opts.backendType = h.platform->backend();
    auto onAdapter = [](WGPURequestAdapterStatus s, WGPUAdapter ad, WGPUStringView, void* u, void*) {
        if (s == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(u) = ad; };
    WGPURequestAdapterCallbackInfo aci = {};
    aci.mode = WGPUCallbackMode_WaitAnyOnly; aci.callback = onAdapter; aci.userdata1 = &h.adapter;
    WGPUFutureWaitInfo af = {wgpuInstanceRequestAdapter(h.instance, &opts, aci), 0};
    wgpuInstanceWaitAny(h.instance, 1, &af, UINT64_MAX);
    if (!h.adapter) { ESHOST_LOGE("no adapter"); return false; }

    WGPUFeatureName compFeats[3];
    size_t compCount = 0;
    for (WGPUFeatureName f : {WGPUFeatureName_TextureCompressionETC2,
                              WGPUFeatureName_TextureCompressionASTC,
                              WGPUFeatureName_TextureCompressionBC}) {
        if (wgpuAdapterHasFeature(h.adapter, f)) compFeats[compCount++] = f;
    }
    auto onDevice = [](WGPURequestDeviceStatus s, WGPUDevice d, WGPUStringView, void* u, void*) {
        if (s == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(u) = d; };
    WGPUDeviceDescriptor dd = {};
    dd.requiredFeatureCount = compCount;
    dd.requiredFeatures = compCount ? compFeats : nullptr;
    WGPURequestDeviceCallbackInfo dci = {};
    dci.mode = WGPUCallbackMode_WaitAnyOnly; dci.callback = onDevice; dci.userdata1 = &h.device;
    WGPUFutureWaitInfo df = {wgpuAdapterRequestDevice(h.adapter, &dd, dci), 0};
    wgpuInstanceWaitAny(h.instance, 1, &df, UINT64_MAX);
    if (!h.device) { ESHOST_LOGE("no device"); return false; }
    return true;
}

}  // namespace

bool bindSurface() {
    HostState& h = host();
    u32 w = 0, hh = 0;
    h.platform->surfaceSize(w, hh);
    h.w = (f32)w;
    h.h = (f32)hh;
    if (!h.gfx->configureSurface(h.platform->surface(), w, hh)) {
        ESHOST_LOGE("configureSurface failed");
        return false;
    }
    h.surfaceReady = true;
    return true;
}

void surfaceLost() {
    if (hostAlive()) host().surfaceReady = false;
}

bool booted() { return hostAlive() && host().ready; }

bool surfaceBound() { return hostAlive() && host().surfaceReady; }

bool boot(Platform& platform) {
    createHost(platform);
    HostState& h = host();

    const double t0 = nowMs();
    if (!createDevice(h)) return false;

    auto device = makeUnique<WebGPUDevice>(h.device, h.instance, h.adapter);
    h.gfx = device.get();
    if (!bindSurface()) return false;

    static EstellaContext context;
    h.ctx = &context;
    // The binding entry points (the generated es_* wrappers call the same ones
    // embind does) reach the engine through activeCtx(); install ours, exactly as
    // the web entry does at initRenderer. Without this they would act on the
    // fallback context and render into a different engine than the host presents.
    g_activeContext = &context;
    context.state().viewport_width = (i32)h.w;
    context.state().viewport_height = (i32)h.h;
    if (!context.init(std::move(device))) { ESHOST_LOGE("context.init failed"); return false; }

    static ecs::Registry registry;
    h.registry = &registry;
    ESHOST_LOGI("boot ms — Dawn instance/adapter/device + EstellaContext: %.0f", nowMs() - t0);
    ESHOST_LOGI("audio: %s", h.audio.init() ? "native engine up (miniaudio)" : "no device — silent");

    initRuntime(h);
    if (!runPackagedGame(h)) return false;
    h.ready = true;
    ESHOST_LOGI("real SDK up (%dx%d) — esengine World over native Dawn", (int)h.w, (int)h.h);
    return true;
}

void frame() {
    if (!booted() || !host().surfaceReady) return;
    HostState& h = host();
    JSValue dt = JS_NewFloat64(h.js, 1.0 / 60.0);
    callJs(h, "update", 1, &dt);
    JS_FreeValue(h.js, dt);
    pumpJs(h);   // run the App tick's async systems and any timers they set

    // Notify JS of voices that ended on their own (the audio thread never touches
    // QuickJS; we poll on this thread and push, like touch). onEnd handlers may
    // start new sounds synchronously — safe, pumpEnded iterates a snapshot.
    h.audio.pumpEnded([&h](int voiceId) {
        JSValue arg = JS_NewInt32(h.js, voiceId);
        callJs(h, "es_onNativeAudioEnded", 1, &arg);
        JS_FreeValue(h.js, arg);
    });

    // Run the callbacks for any HTTP replies that landed since last frame, then
    // let their .then() continuations run.
    drainFetches(h);
    pumpJs(h);

    // app.tick above ran the SDK's render system, which resolved the scene's
    // cameras and drove RenderFrame through the es_renderer_* bindings. What is
    // left here is what only a host can do: flip the swapchain.
    if (!jsOwnsFrame(h)) fallbackFrame(h);
    h.gfx->present();
    if (++h.frame % 120 == 0) ESHOST_LOGI("real-SDK frame %llu", (unsigned long long)h.frame);
}

// Push one host touch to the game's es_onNativeTouch(type,id,x,y), which fans it
// out to the NativeBridge's registered listener.
void touch(int type, int id, float x, float y) {
    if (!booted()) return;
    HostState& h = host();
    JSValue args[4] = {
        JS_NewInt32(h.js, type), JS_NewInt32(h.js, id),
        JS_NewFloat64(h.js, x), JS_NewFloat64(h.js, y),
    };
    callJs(h, "es_onNativeTouch", 4, args);
    for (JSValue& v : args) JS_FreeValue(h.js, v);
}

// The app went to background (visible=false) or returned. Suspend/resume the
// audio device at the native layer — correct even while the JS tick is paused —
// then push the signal to JS, where the Lifecycle plugin auto-pauses the game.
void setVisible(bool visible) {
    if (!booted()) return;
    HostState& h = host();
    if (visible) h.audio.resumeAll(); else h.audio.suspendAll();
    JSValue arg = JS_NewBool(h.js, visible);
    callJs(h, "es_onNativeVisibility", 1, &arg);
    JS_FreeValue(h.js, arg);
    pumpJs(h);
}

// OS memory pressure — let the SDK's residency caches drop evictable entries
// (the audio buffer cache trims). Held buffers keep playing; only re-fetch cost
// returns for evicted ones.
void memoryWarning() {
    if (!booted()) return;
    callJs(host(), "es_onNativeMemoryWarning", 0, nullptr);
    pumpJs(host());
}

}  // namespace eshost
