// Reference native host: boots EstellaContext with every WebGPU-relevant subsystem
// and renders one ECS scene through the production path — TransformSystem ->
// RenderFrame.begin/collectAll/flush/end -> present. The web harness
// (tests/renderer/webgpu_engine_bringup.cpp) gets its device from
// emscripten_webgpu_get_device() + configureSurface("#canvas"); this host builds
// the instance/adapter/device itself and calls
// configureSurface(NativeSurface{AndroidWindow}). Native Dawn -> Vulkan, no wasm.

#include <android_native_app_glue.h>
#include <android/log.h>
#include <android/native_window.h>

#include "esengine/core/EstellaContext.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include "esengine/ecs/components/Sprite.hpp"
#include "esengine/ecs/components/ShapeRenderer.hpp"
#include "esengine/ecs/components/Light2D.hpp"
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <glm/gtc/matrix_transform.hpp>

#define LOG_TAG "EstellaFrame"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace esengine;

namespace {

struct App {
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    WebGPUDevice* gfx = nullptr;            // owned by context after init; raw for present()
    EstellaContext* ctx = nullptr;
    ecs::Registry* registry = nullptr;
    f32 w = 0, h = 0;
    f32 elapsed = 0.0f;
    bool ready = false;
    uint64_t frame = 0;
};

void onDeviceError(WGPUDevice const*, WGPUErrorType t, WGPUStringView m, void*, void*) {
    LOGE("uncaptured error (0x%x): %.*s", (unsigned)t, (int)m.length, m.data ? m.data : "");
}
void onAdapter(WGPURequestAdapterStatus s, WGPUAdapter a, WGPUStringView m, void* ud1, void*) {
    if (s == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(ud1) = a;
    else LOGE("adapter fail: %.*s", (int)m.length, m.data ? m.data : "");
}
void onDevice(WGPURequestDeviceStatus s, WGPUDevice d, WGPUStringView m, void* ud1, void*) {
    if (s == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(ud1) = d;
    else LOGE("device fail: %.*s", (int)m.length, m.data ? m.data : "");
}

void buildScene(EstellaContext& ctx, ecs::Registry& reg, f32 W, f32 H) {
    auto& rm = ctx.require<resource::ResourceManager>();
    const f32 s = (W < H ? W : H);  // short side, for pixel sizes

    // 2x2 four-colour checker (red/green/blue/yellow).
    const u8 checker[16] = {
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,    255, 255, 0, 255,
    };
    auto checkerTex = rm.createTexture(2, 2, ConstSpan<u8>(checker, sizeof(checker)), TextureFormat::RGBA8);
    const u8 white[4] = {255, 255, 255, 255};
    auto whiteTex = rm.createTexture(1, 1, ConstSpan<u8>(white, sizeof(white)), TextureFormat::RGBA8);

    // Checker sprite, upper area.
    {
        auto e = reg.create();
        auto& t = reg.emplace<ecs::Transform>(e);
        t.position = {W * 0.5f, H * 0.62f, 0.0f};
        auto& sp = reg.emplace<ecs::Sprite>(e);
        sp.texture = checkerTex;
        sp.size = {s * 0.5f, s * 0.5f};
    }
    // Magenta SDF circle, middle.
    {
        auto e = reg.create();
        auto& t = reg.emplace<ecs::Transform>(e);
        t.position = {W * 0.32f, H * 0.42f, 0.0f};
        auto& sh = reg.emplace<ecs::ShapeRenderer>(e);
        sh.shapeType = 0;  // circle
        sh.color = {1.0f, 0.0f, 1.0f, 1.0f};
        sh.size = {s * 0.28f, s * 0.28f};
    }
    // Lit white sprite + a red point light + ambient, so lighting shows.
    {
        auto e = reg.create();
        auto& t = reg.emplace<ecs::Transform>(e);
        t.position = {W * 0.68f, H * 0.42f, 0.0f};
        auto& sp = reg.emplace<ecs::Sprite>(e);
        sp.texture = whiteTex;
        sp.size = {s * 0.28f, s * 0.28f};
        sp.lit = true;
    }
    {
        auto e = reg.create();
        auto& t = reg.emplace<ecs::Transform>(e);
        t.position = {W * 0.68f, H * 0.42f, 0.0f};
        auto& l = reg.emplace<ecs::Light2D>(e);
        l.type = static_cast<i32>(ecs::Light2DType::Point);
        l.color = {1.0f, 0.3f, 0.1f, 1.0f};
        l.intensity = 1.5f;
        l.radius = s * 0.5f;
    }
    {
        auto e = reg.create();
        reg.emplace<ecs::Transform>(e);
        auto& l = reg.emplace<ecs::Light2D>(e);
        l.type = static_cast<i32>(ecs::Light2DType::Ambient);
        l.color = {1.0f, 1.0f, 1.0f, 1.0f};
        l.intensity = 0.25f;
    }
}

void renderScene(App& a) {
    if (!a.ready) return;
    auto& ctx = *a.ctx;
    auto& reg = *a.registry;

    a.elapsed += 1.0f / 60.0f;
    ctx.require<RenderContext>().setFrameTime(a.elapsed, (u32)a.w, (u32)a.h);

    World world{reg, ctx.services(), 1.0f / 60.0f};
    ctx.require<ecs::TransformSystem>().update(world);

    // World units are pixels, y up.
    const glm::mat4 vp = glm::ortho(0.0f, a.w, 0.0f, a.h);

    auto& rf = ctx.require<RenderFrame>();
    rf.begin(vp, 0, RenderFrame::PassClear{true, true, glm::vec4(0.08f, 0.09f, 0.13f, 1.0f)});
    rf.collectAll(reg);
    rf.flush();
    rf.end();

    a.gfx->present();

    if (++a.frame % 120 == 0) LOGI("engine scene frame %llu", (unsigned long long)a.frame);
}

void initEngine(App& a, ANativeWindow* window) {
    WGPUInstanceFeatureName feats[] = {WGPUInstanceFeatureName_TimedWaitAny};
    WGPUInstanceDescriptor idesc = {};
    idesc.requiredFeatureCount = 1;
    idesc.requiredFeatures = feats;
    a.instance = wgpuCreateInstance(&idesc);

    WGPURequestAdapterOptions opts = {};
    opts.powerPreference = WGPUPowerPreference_HighPerformance;
    opts.backendType = WGPUBackendType_Vulkan;
    WGPURequestAdapterCallbackInfo aci = {};
    aci.mode = WGPUCallbackMode_WaitAnyOnly;
    aci.callback = onAdapter;
    aci.userdata1 = &a.adapter;
    WGPUFutureWaitInfo af = {wgpuInstanceRequestAdapter(a.instance, &opts, aci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &af, UINT64_MAX);
    if (!a.adapter) { LOGE("no adapter"); return; }

    WGPUDeviceDescriptor dd = {};
    dd.uncapturedErrorCallbackInfo.callback = onDeviceError;
    WGPURequestDeviceCallbackInfo dci = {};
    dci.mode = WGPUCallbackMode_WaitAnyOnly;
    dci.callback = onDevice;
    dci.userdata1 = &a.device;
    WGPUFutureWaitInfo df = {wgpuAdapterRequestDevice(a.adapter, &dd, dci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &df, UINT64_MAX);
    if (!a.device) { LOGE("no device"); return; }

    a.w = (f32)ANativeWindow_getWidth(window);
    a.h = (f32)ANativeWindow_getHeight(window);

    auto device = makeUnique<WebGPUDevice>(a.device, a.instance);
    a.gfx = device.get();  // stays valid: context owns it, we only borrow for present()
    if (!a.gfx->configureSurface(WebGPUDevice::NativeSurface{WebGPUDevice::NativeWindowKind::AndroidWindow, window},
                                 (u32)a.w, (u32)a.h)) {
        LOGE("configureSurface failed");
        return;
    }

    static EstellaContext context;
    a.ctx = &context;
    context.state().viewport_width = (i32)a.w;
    context.state().viewport_height = (i32)a.h;
    if (!context.init(std::move(device))) { LOGE("context.init failed"); return; }

    static ecs::Registry registry;
    a.registry = &registry;
    buildScene(context, registry, a.w, a.h);

    a.ready = true;
    LOGI("full engine up (%dx%d) — production render path on native Dawn", (int)a.w, (int)a.h);
}

void onAppCmd(android_app* app, int32_t cmd) {
    App* a = static_cast<App*>(app->userData);
    switch (cmd) {
        case APP_CMD_INIT_WINDOW:
            if (app->window && !a->ready) { LOGI("APP_CMD_INIT_WINDOW"); initEngine(*a, app->window); }
            break;
        default:
            break;
    }
}

}  // namespace

void android_main(android_app* app) {
    App a;
    app->userData = &a;
    app->onAppCmd = onAppCmd;
    while (true) {
        int events;
        android_poll_source* source;
        int timeoutMs = a.ready ? 0 : -1;
        while (ALooper_pollOnce(timeoutMs, nullptr, &events, (void**)&source) >= 0) {
            if (source) source->process(app, source);
            if (app->destroyRequested) return;
            timeoutMs = 0;
        }
        renderScene(a);
    }
}
