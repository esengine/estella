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
#include "BootLog.hpp"

#include "esengine/bindings/ActiveContext.hpp"   // g_activeContext — the context the generated bindings act on
#include "Shot.hpp"
#include "esengine/core/Log.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <chrono>

using namespace esengine;

namespace eshost {
namespace {

/** Dawn returns strings as pointer+length, with WGPU_STRLEN meaning "null-terminated". */
std::string svText(const WGPUStringView& v) {
    return v.data ? std::string(v.data, v.length == WGPU_STRLEN ? strlen(v.data) : v.length)
                  : std::string();
}

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

/** One cleared frame, presented — the host's own colour, since the game's lives
 *  on a Canvas that does not exist yet. */
void paintBootFrame(HostState& h) {
    if (!h.gfx || !h.ctx) return;
    auto& rf = h.ctx->require<RenderFrame>();
    rf.begin(glm::ortho(0.0f, h.w, 0.0f, h.h), 0, RenderFrame::PassClear{true, true, kFallbackClear});
    rf.end();
    h.gfx->present();
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
    // Without this, a validation failure is silent: WebGPU does not throw, the
    // offending call is dropped, and all that reaches anyone is a black frame.
    dd.uncapturedErrorCallbackInfo.callback =
        [](WGPUDevice const*, WGPUErrorType type, WGPUStringView message, void*, void*) {
            const std::string text = svText(message);
            ESHOST_LOGE("WebGPU: %s", text.c_str());
            // An out-of-memory or internal error is the device telling us it is
            // finished; the backend decides which kinds end it.
            if (hostAlive() && host().gfx) {
                host().gfx->reportUncapturedError(static_cast<uint32_t>(type), text.c_str());
            }
        };
    // Device loss can only be subscribed to HERE — WebGPU takes the callback in
    // the descriptor that creates the device, and there is no way to attach one
    // afterwards. A device created without it loses itself in silence.
    dd.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowSpontaneous;
    dd.deviceLostCallbackInfo.callback =
        [](WGPUDevice const*, WGPUDeviceLostReason reason, WGPUStringView message, void*, void*) {
            const std::string text = svText(message);
            ESHOST_LOGE("WebGPU device lost (%d): %s", (int)reason, text.c_str());
            if (hostAlive() && host().gfx) {
                host().gfx->notifyDeviceLost(
                    WebGPUDevice::reasonFromWgpu(static_cast<uint32_t>(reason)),
                    text, "Dawn device-lost callback");
            }
        };
    WGPURequestDeviceCallbackInfo dci = {};
    dci.mode = WGPUCallbackMode_WaitAnyOnly; dci.callback = onDevice; dci.userdata1 = &h.device;
    WGPUFutureWaitInfo df = {wgpuAdapterRequestDevice(h.adapter, &dd, dci), 0};
    wgpuInstanceWaitAny(h.instance, 1, &df, UINT64_MAX);
    if (!h.device) { ESHOST_LOGE("no device"); return false; }
    return true;
}

/**
 * Record which GPU this is.
 *
 * The first question about a failure that happens on someone else's phone and
 * not on yours, and the one a log without it cannot answer. Dawn knows it as
 * soon as the adapter exists.
 */
void logAdapter(HostState& h) {
    if (!h.adapter) return;
    WGPUAdapterInfo info = {};
    if (wgpuAdapterGetInfo(h.adapter, &info) != WGPUStatus_Success) return;
    bootNote("gpu: %s %s (%s) — %s", svText(info.vendor).c_str(), svText(info.device).c_str(),
             svText(info.architecture).c_str(), svText(info.description).c_str());
    wgpuAdapterInfoFreeMembers(info);
}

}  // namespace

bool bindSurface() {
    HostState& h = host();
    u32 w = 0, hh = 0;
    h.platform->surfaceSize(w, hh);
    h.w = (f32)w;
    h.h = (f32)hh;
    // Before configureSurface, always: the copy usage is part of the swapchain's
    // configuration, so asking afterwards would silently do nothing.
    h.gfx->setSurfaceReadback(shotWanted());
    if (!h.gfx->configureSurface(h.platform->surface(), w, hh)) {
        ESHOST_LOGE("configureSurface failed");
        return false;
    }
    h.surfaceReady = true;
    return true;
}

void surfaceLost() {
    if (!hostAlive()) return;
    host().surfaceReady = false;
    // The next frame is the first of a new run of them. Without this the game is
    // handed however long the app spent backgrounded — clamped, but still a
    // quarter-second jump the moment it comes back.
    host().haveLastFrame = false;
}

bool booted() { return hostAlive() && host().ready; }

bool surfaceBound() { return hostAlive() && host().surfaceReady; }

bool boot(Platform& platform) {
    createHost(platform);
    HostState& h = host();

    // The engine logs to stdout/stderr, which a browser shows and a phone throws
    // away — so on a device every ES_LOG_ERROR it ever wrote went nowhere, and a
    // renderer that refused to draw said so to no one. Forward it to the
    // platform's log, so there is ONE log wherever the engine runs.
    esengine::Log::addSink([](const esengine::LogEntry& entry) {
        hostLog(entry.level >= esengine::LogLevel::Error, "[engine] %s", entry.message.c_str());
    });

    // Opened before anything can fail, so a launch that dies in the GPU bring-up
    // still leaves a file saying so. Every ESHOST_LOG from here on lands in it.
    openBootLog(platform.logDir());
    installCrashHandler();
    bootNote("device: %s", platform.describe().c_str());
    // If the run before this one died, put its record where the player can find
    // it — the copy is made now, on a healthy launch, because a signal handler
    // may not copy files.
    if (const std::string at = publishPreviousCrash(platform.publicDirs()); !at.empty()) {
        ESHOST_LOGE("the previous run crashed — its record is at %s", at.c_str());
        bootNote("previous run CRASHED; its record was copied to %s", at.c_str());
    }
    if (!bootLogPath().empty()) ESHOST_LOGI("boot record: %s", bootLogPath().c_str());

    const double t0 = nowMs();
    bootPhase("gpu device");
    if (!createDevice(h)) return false;
    logAdapter(h);

    auto device = makeUnique<WebGPUDevice>(h.device, h.instance, h.adapter);
    h.gfx = device.get();
    bootPhase("surface");
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
    bootPhase("engine context");
    if (!context.init(std::move(device))) { ESHOST_LOGE("context.init failed"); return false; }

    static ecs::Registry registry;
    h.registry = &registry;
    ESHOST_LOGI("boot ms — Dawn instance/adapter/device + EstellaContext: %.0f", nowMs() - t0);
    ESHOST_LOGI("audio: %s", h.audio.init() ? "native engine up (miniaudio)" : "no device — silent");

    // Paint the surface before the slow part. Until the game's first frame the
    // window holds whatever was there — black — which is also what a process that
    // died leaves behind; they are the same picture for as long as boot takes, and
    // on a first launch that has to compile the SDK bundle that is seconds. One
    // filled frame is the difference between "starting" and "gone".
    paintBootFrame(h);

    bootPhase("js runtime");
    initRuntime(h);
    bootPhase("game script");
    if (!runPackagedGame(h)) return false;
    h.ready = true;
    bootReady(nowMs() - t0);
    ESHOST_LOGI("real SDK up (%dx%d) — esengine World over native Dawn", (int)h.w, (int)h.h);
    return true;
}

void frame() {
    if (!booted() || !host().surfaceReady) return;
    HostState& h = host();

    // A window can change size without being recreated: a rotation, an insets
    // change (the system bars leaving on the frame after launch), a layout on
    // iOS. The bound size is what the swapchain is configured to AND what the
    // camera maps a touch through, so a stale one both stretches the picture and
    // puts every hit test a proportion of a screen away from the finger.
    u32 liveW = 0, liveH = 0;
    h.platform->surfaceSize(liveW, liveH);
    if (liveW > 0 && liveH > 0 && ((f32)liveW != h.w || (f32)liveH != h.h)) {
        ESHOST_LOGI("surface resized: %dx%d -> %dx%d", (int)h.w, (int)h.h, (int)liveW, (int)liveH);
        if (!bindSurface()) return;
    }

    // How much time actually passed, not how much we wish had. A host is stepped
    // by the display — CADisplayLink on iOS, the Choreographer on Android — so the
    // rate is the panel's, and a fixed 1/60 is only right on a 60 Hz one. A 120 Hz
    // phone ran this game at 2.02x real speed for exactly that reason, which reads
    // as "the animations are too fast" rather than as a clock bug.
    //
    // Same policy as the web loop (App's rAF path): clamp the delta, because the
    // alternative to a long frame is a game that teleports through it. The ceiling
    // matches App.maxDeltaTime — one number, so a game behaves the same after a
    // stall wherever it runs.
    constexpr double kMaxDelta = 0.25;
    constexpr double kFirstFrameDelta = 1.0 / 60.0;
    const auto nowAt = std::chrono::steady_clock::now();
    double deltaSeconds = kFirstFrameDelta;
    if (h.haveLastFrame) {
        deltaSeconds = std::chrono::duration<double>(nowAt - h.lastFrameAt).count();
        if (deltaSeconds > kMaxDelta) deltaSeconds = kMaxDelta;
        if (deltaSeconds < 0.0) deltaSeconds = 0.0;   // a clock that went backwards
    }
    h.lastFrameAt = nowAt;
    h.haveLastFrame = true;

    // Booked before the game renders, because the copy is served from inside the
    // renderer's own endFrame (see Shot.hpp).
    shotBeforeFrame(*h.gfx, h.frame, (u32)h.w, (u32)h.h);

    JSValue dt = JS_NewFloat64(h.js, deltaSeconds);
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
    drainTextEditor(h);
    pumpJs(h);

    // app.tick above ran the SDK's render system, which resolved the scene's
    // cameras and drove RenderFrame through the es_renderer_* bindings. What is
    // left here is what only a host can do: flip the swapchain.
    if (!jsOwnsFrame(h)) fallbackFrame(h);
    h.gfx->present();
    if (shotAfterPresent(*h.gfx)) h.quitRequested = true;
    if (++h.frame % 120 == 0) ESHOST_LOGI("real-SDK frame %llu", (unsigned long long)h.frame);
}

bool quitRequested() { return hostAlive() && host().quitRequested; }

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

void pointer(int type, int button, float x, float y) {
    if (!booted()) return;
    HostState& h = host();
    JSValue args[4] = {
        JS_NewInt32(h.js, type), JS_NewInt32(h.js, button),
        JS_NewFloat64(h.js, x), JS_NewFloat64(h.js, y),
    };
    callJs(h, "es_onNativePointer", 4, args);
    for (JSValue& v : args) JS_FreeValue(h.js, v);
}

void wheel(float dx, float dy) {
    if (!booted()) return;
    HostState& h = host();
    JSValue args[2] = {JS_NewFloat64(h.js, dx), JS_NewFloat64(h.js, dy)};
    callJs(h, "es_onNativeWheel", 2, args);
    for (JSValue& v : args) JS_FreeValue(h.js, v);
}

void key(bool down, const char* code) {
    if (!booted() || !code || !code[0]) return;
    HostState& h = host();
    JSValue args[2] = {JS_NewBool(h.js, down), JS_NewString(h.js, code)};
    callJs(h, "es_onNativeKey", 2, args);
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
