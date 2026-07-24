// Estella native JS host — a QuickJS game script drives the native C++ engine.
//
// This is the arm64 sibling of the web runtime, and the architecture is
// single-sourced end to end:
//
//   * es_set_<Component> / es_<Component>_buffer live in the generated
//     NativeBindings.generated.cpp, emitted by EHT (tools/eht) from the SAME
//     reflection that emits the web embind bindings — the two surfaces can't drift.
//   * ptraccessors_js.h is the REAL SDK sdk/src/ecs/ptrAccessors.generated.ts,
//     transpiled to plain JS. POD components are wasm32/arm64 layout-identical, so
//     the SDK's marshalling code writes native component memory unchanged, through
//     a zero-copy ArrayBuffer over the native component (the es_<C>_buffer path).
//   * The engine C++ core is the same source the web build compiles to wasm; only
//     the game script is interpreted (QuickJS), the engine runs native/full speed.
//
// QuickJS interprets init()/update(dt); native C++ renders via EstellaContext ->
// ECS Registry -> TransformSystem -> RenderFrame -> WebGPUDevice -> Dawn -> Vulkan.
// Device gets its surface from configureSurface(NativeSurface{AndroidWindow}).
//
// NOTE: kGameScript below is a self-contained reference script. The product path
// loads the real SDK bundle + the shipped game script through a NativeBridge
// (fs/asset plumbing); that arrives with the native SDK runtime.

#include <android_native_app_glue.h>
#include <android/log.h>
#include <android/native_window.h>

#include "esn_shim.hpp"        // quickjs + the esn_* plumbing decls
#include "ptraccessors_js.h"   // the real SDK ptrAccessors.generated.ts, as JS

#include "esengine/core/EstellaContext.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/Sprite.hpp"  // js_useWhiteTexture touches Sprite directly
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <cstring>
#include <vector>

#define LOG_TAG "EstellaJS"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace esengine;

// Reference game script — composes the generated component setters the way the
// TS SDK does, and exercises the SDK fast path (ptrAccessors over a zero-copy
// ArrayBuffer). Replaced by the shipped bundle once the native SDK runtime lands.
static const char* kGameScript = R"JS(
function texSprite(x, y, size, tex) {
    var e = es_createEntity();
    es_set_Transform(e, { position: [x, y, 0] });
    es_set_Sprite(e, { texture: tex, color: [1, 1, 1, 1], size: [size, size], enabled: true });
    return e;
}
function litSprite(x, y, size) {
    var e = es_createEntity();
    es_set_Transform(e, { position: [x, y, 0] });
    es_set_Sprite(e, { color: [1, 1, 1, 1], size: [size, size], lit: true, enabled: true });
    es_useWhiteTexture(e);
    return e;
}
function circle(x, y, size, r, g, b) {
    var e = es_createEntity();
    es_set_Transform(e, { position: [x, y, 0] });
    es_set_ShapeRenderer(e, { shapeType: 0, color: [r, g, b, 1], size: [size, size], enabled: true });
    return e;
}
// The BuiltinBridge dispatch pattern with a NATIVE memory backend: on web the
// bridge writes via mod.HEAPF32 + a wasm ptr; here the backend hands it zero-copy
// views over the native component (the generated es_<Component>_buffer binding)
// and ptr 0. The dispatch (PTR_ACCESSORS[cppName].fill/write) is the REAL SDK
// table — generic for any component, no per-type code.
function nativeViews(cppName, e) {
    var buf = globalThis['es_' + cppName + '_buffer'](e);
    return { f32: new Float32Array(buf), u32: new Uint32Array(buf), u8: new Uint8Array(buf) };
}
function readComponent(cppName, e) {          // ~ BuiltinBridge.resolvePtrGetter
    var acc = PTR_ACCESSORS[cppName];
    var v = nativeViews(cppName, e);
    var d = acc.create();
    acc.fill(v.f32, v.u32, v.u8, 0, d);
    return d;
}
function setComponent(cppName, e, data) {     // ~ BuiltinBridge.resolvePtrSetter
    var acc = PTR_ACCESSORS[cppName];
    var v = nativeViews(cppName, e);
    acc.write(v.f32, v.u32, v.u8, 0, data);
}
function bufferSprite(x, y, size, tex, r, g, b) {
    var e = es_createEntity();
    es_set_Transform(e, { position: [x, y, 0] });
    var d = readComponent('Sprite', e);       // real dispatch: fill from native
    d.texture = tex;
    d.color = { r: r, g: g, b: b, a: 1 };
    d.size = { x: size, y: size };
    setComponent('Sprite', e, d);             // real dispatch: write to native
    return e;
}
var moving, orbit;
function init() {
    es_setClear(0.07, 0.08, 0.12);
    var tex = es_createTexture(2, 2, [
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,    255, 255, 0, 255 ]);
    moving = texSprite(W * 0.5, H * 0.62, S * 0.42, tex);
    orbit  = circle(W * 0.5, H * 0.42, S * 0.26, 1.0, 0.2, 0.9);
    var l = es_createEntity();
    es_set_Transform(l, { position: [W * 0.32, H * 0.30, 0] });
    es_set_Light2D(l, { type: 0, color: [1.0, 0.55, 0.15, 1], intensity: 1.6, radius: S * 0.7, enabled: true });
    var la = es_createEntity();
    es_set_Light2D(la, { type: 2, color: [1, 1, 1, 1], intensity: 0.25, enabled: true });
    litSprite(W * 0.32, H * 0.30, S * 0.26);
    bufferSprite(W * 0.68, H * 0.30, S * 0.26, tex, 0.2, 1.0, 0.5);
}
var t = 0.0;
function update(dt) {
    t += dt;
    es_set_Transform(moving, { position: [W * 0.5 + Math.sin(t * 1.6) * S * 0.55, H * 0.62, 0] });
    es_set_Transform(orbit,  { position: [W * 0.5 + Math.cos(t * 1.2) * S * 0.30, H * 0.42 + Math.sin(t * 1.2) * S * 0.14, 0] });
}
)JS";

namespace {

struct App {
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    WebGPUDevice* gfx = nullptr;            // owned by context after init; raw for present()
    EstellaContext* ctx = nullptr;
    ecs::Registry* registry = nullptr;
    JSRuntime* rt = nullptr;
    JSContext* js = nullptr;
    std::vector<Entity> entities;           // script entity id -> Entity
    resource::TextureHandle whiteTex{};
    glm::vec4 clear{0.07f, 0.08f, 0.12f, 1.0f};
    f32 w = 0, h = 0;
    bool ready = false;
    uint64_t frame = 0;
};

App* g_app = nullptr;

}  // namespace

// ---- shim the generated bindings call (declared in esn_shim.hpp) ------------

ecs::Registry& esn_reg() { return *g_app->registry; }

Entity esn_entity(JSContext* ctx, JSValueConst v) {
    int32_t id = 0;
    JS_ToInt32(ctx, &id, v);
    return (id >= 0 && id < (int)g_app->entities.size()) ? g_app->entities[id] : Entity{};
}

bool esn_getnum(JSContext* ctx, JSValueConst obj, const char* key, double* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    bool ok = !JS_IsUndefined(p) && !JS_IsNull(p) && JS_ToFloat64(ctx, out, p) == 0;
    JS_FreeValue(ctx, p);
    return ok;
}
bool esn_getbool(JSContext* ctx, JSValueConst obj, const char* key, int* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsUndefined(p) || JS_IsNull(p)) { JS_FreeValue(ctx, p); return false; }
    *out = JS_ToBool(ctx, p);
    JS_FreeValue(ctx, p);
    return true;
}
void esn_getvec(JSContext* ctx, JSValueConst obj, const char* key, float* dst, int n) {
    JSValue arr = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsArray(arr)) {
        for (int i = 0; i < n; ++i) {
            JSValue el = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
            double d = 0;
            JS_ToFloat64(ctx, &d, el);
            dst[i] = (float)d;
            JS_FreeValue(ctx, el);
        }
    }
    JS_FreeValue(ctx, arr);
}
JSValue esn_arraybuffer(JSContext* ctx, void* ptr, size_t size) {
    // Native owns the memory (the ECS component) — no free callback, not shared.
    return JS_NewArrayBuffer(ctx, reinterpret_cast<uint8_t*>(ptr), size, nullptr, nullptr, false);
}

namespace {

// Hand-written bindings for the bits reflection can't spell: entity creation,
// clear colour, and binding a shared texture (a resource handle). These are the
// native analog of the web ResourceManagerBindings — resources aren't reflected.
JSValue js_createEntity(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    g_app->entities.push_back(g_app->registry->create());
    return JS_NewInt32(ctx, (int)g_app->entities.size() - 1);
}
JSValue js_setClear(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double r = 0, g = 0, b = 0;
    JS_ToFloat64(ctx, &r, argv[0]); JS_ToFloat64(ctx, &g, argv[1]); JS_ToFloat64(ctx, &b, argv[2]);
    g_app->clear = {(f32)r, (f32)g, (f32)b, 1.0f};
    return JS_UNDEFINED;
}
JSValue js_useWhiteTexture(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    Entity e = esn_entity(ctx, argv[0]);
    if (auto* s = g_app->registry->tryGet<ecs::Sprite>(e)) s->texture = g_app->whiteTex;
    return JS_UNDEFINED;
}
JSValue js_createTexture(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int32_t w = 0, h = 0;
    JS_ToInt32(ctx, &w, argv[0]);
    JS_ToInt32(ctx, &h, argv[1]);
    uint32_t len = 0;
    JSValue lv = JS_GetPropertyStr(ctx, argv[2], "length");
    JS_ToUint32(ctx, &len, lv);
    JS_FreeValue(ctx, lv);
    std::vector<u8> pixels(len);
    for (uint32_t i = 0; i < len; ++i) {
        JSValue el = JS_GetPropertyUint32(ctx, argv[2], i);
        int32_t v = 0;
        JS_ToInt32(ctx, &v, el);
        pixels[i] = (u8)v;
        JS_FreeValue(ctx, el);
    }
    auto handle = g_app->ctx->require<resource::ResourceManager>().createTexture(
        (u32)w, (u32)h, ConstSpan<u8>(pixels.data(), pixels.size()), TextureFormat::RGBA8, false);
    return JS_NewInt64(ctx, (int64_t)handle.id());
}

void logJsError(JSContext* ctx, const char* where) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    LOGE("JS error in %s: %s", where, s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, e);
}
void callJs(App& a, const char* fn, int argc, JSValue* argv) {
    JSValue global = JS_GetGlobalObject(a.js);
    JSValue f = JS_GetPropertyStr(a.js, global, fn);
    if (JS_IsFunction(a.js, f)) {
        JSValue r = JS_Call(a.js, f, global, argc, argv);
        if (JS_IsException(r)) logJsError(a.js, fn);
        JS_FreeValue(a.js, r);
    }
    JS_FreeValue(a.js, f);
    JS_FreeValue(a.js, global);
}

void initJS(App& a) {
    a.rt = JS_NewRuntime();
    a.js = JS_NewContext(a.rt);
    JSValue global = JS_GetGlobalObject(a.js);
    JS_SetPropertyStr(a.js, global, "W", JS_NewFloat64(a.js, a.w));
    JS_SetPropertyStr(a.js, global, "H", JS_NewFloat64(a.js, a.h));
    JS_SetPropertyStr(a.js, global, "S", JS_NewFloat64(a.js, a.w < a.h ? a.w : a.h));
    JS_SetPropertyStr(a.js, global, "es_createEntity", JS_NewCFunction(a.js, js_createEntity, "es_createEntity", 0));
    JS_SetPropertyStr(a.js, global, "es_setClear", JS_NewCFunction(a.js, js_setClear, "es_setClear", 3));
    JS_SetPropertyStr(a.js, global, "es_useWhiteTexture", JS_NewCFunction(a.js, js_useWhiteTexture, "es_useWhiteTexture", 1));
    JS_SetPropertyStr(a.js, global, "es_createTexture", JS_NewCFunction(a.js, js_createTexture, "es_createTexture", 3));
    esn_register(a.js, global);  // the EHT-generated es_set_<Component> / es_<C>_buffer
    JS_FreeValue(a.js, global);

    // Load the REAL SDK ptrAccessors (writeSprite/fillSprite/createSpriteData, …)
    // as globals, so the game script drives native components through actual SDK code.
    JSValue pr = JS_Eval(a.js, kPtrAccessorsJS, strlen(kPtrAccessorsJS), "ptrAccessors.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(pr)) logJsError(a.js, "ptrAccessors eval");
    JS_FreeValue(a.js, pr);

    JSValue r = JS_Eval(a.js, kGameScript, strlen(kGameScript), "game.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) logJsError(a.js, "eval");
    JS_FreeValue(a.js, r);
    callJs(a, "init", 0, nullptr);
    LOGI("game script init() ran via generated bindings — %zu entities", g_app->entities.size());
}

void renderScene(App& a) {
    if (!a.ready) return;
    auto& ctx = *a.ctx;
    JSValue dt = JS_NewFloat64(a.js, 1.0 / 60.0);
    callJs(a, "update", 1, &dt);
    JS_FreeValue(a.js, dt);

    ctx.require<RenderContext>().setFrameTime((f32)a.frame / 60.0f, (u32)a.w, (u32)a.h);
    World world{*a.registry, ctx.services(), 1.0f / 60.0f};
    ctx.require<ecs::TransformSystem>().update(world);
    const glm::mat4 vp = glm::ortho(0.0f, a.w, 0.0f, a.h);
    auto& rf = ctx.require<RenderFrame>();
    rf.begin(vp, 0, RenderFrame::PassClear{true, true, a.clear});
    rf.collectAll(*a.registry);
    rf.flush();
    rf.end();
    a.gfx->present();
    if (++a.frame % 120 == 0) LOGI("JS-driven frame %llu", (unsigned long long)a.frame);
}

void initEngine(App& a, ANativeWindow* window) {
    WGPUInstanceFeatureName feats[] = {WGPUInstanceFeatureName_TimedWaitAny};
    WGPUInstanceDescriptor idesc = {};
    idesc.requiredFeatureCount = 1;
    idesc.requiredFeatures = feats;
    a.instance = wgpuCreateInstance(&idesc);
    WGPURequestAdapterOptions opts = {};
    opts.backendType = WGPUBackendType_Vulkan;
    auto onA = [](WGPURequestAdapterStatus s, WGPUAdapter ad, WGPUStringView, void* u, void*) {
        if (s == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(u) = ad; };
    WGPURequestAdapterCallbackInfo aci = {};
    aci.mode = WGPUCallbackMode_WaitAnyOnly; aci.callback = onA; aci.userdata1 = &a.adapter;
    WGPUFutureWaitInfo af = {wgpuInstanceRequestAdapter(a.instance, &opts, aci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &af, UINT64_MAX);
    if (!a.adapter) { LOGE("no adapter"); return; }
    auto onD = [](WGPURequestDeviceStatus s, WGPUDevice d, WGPUStringView, void* u, void*) {
        if (s == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(u) = d; };
    WGPUDeviceDescriptor dd = {};
    WGPURequestDeviceCallbackInfo dci = {};
    dci.mode = WGPUCallbackMode_WaitAnyOnly; dci.callback = onD; dci.userdata1 = &a.device;
    WGPUFutureWaitInfo df = {wgpuAdapterRequestDevice(a.adapter, &dd, dci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &df, UINT64_MAX);
    if (!a.device) { LOGE("no device"); return; }

    a.w = (f32)ANativeWindow_getWidth(window);
    a.h = (f32)ANativeWindow_getHeight(window);
    auto device = makeUnique<WebGPUDevice>(a.device, a.instance);
    a.gfx = device.get();  // stays valid: context owns it, we only borrow for present()
    if (!a.gfx->configureSurface(WebGPUDevice::NativeSurface{WebGPUDevice::NativeWindowKind::AndroidWindow, window},
                                 (u32)a.w, (u32)a.h)) { LOGE("configureSurface failed"); return; }
    static EstellaContext context;
    a.ctx = &context;
    context.state().viewport_width = (i32)a.w;
    context.state().viewport_height = (i32)a.h;
    if (!context.init(std::move(device))) { LOGE("context.init failed"); return; }
    static ecs::Registry registry;
    a.registry = &registry;
    const u8 white[4] = {255, 255, 255, 255};
    a.whiteTex = context.require<resource::ResourceManager>().createTexture(
        1, 1, ConstSpan<u8>(white, sizeof(white)), TextureFormat::RGBA8);
    initJS(a);
    a.ready = true;
    LOGI("JS host up (%dx%d) — QuickJS game script driving native Dawn", (int)a.w, (int)a.h);
}

void onAppCmd(android_app* app, int32_t cmd) {
    App* a = static_cast<App*>(app->userData);
    if (cmd == APP_CMD_INIT_WINDOW && app->window && !a->ready) initEngine(*a, app->window);
}

}  // namespace

void android_main(android_app* app) {
    App a;
    g_app = &a;
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
