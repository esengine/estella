// Estella native JS host — a thin C++ shell that runs the REAL SDK. Three layers,
// only this one is C++:
//   1. This host (native/js/main.cpp): boots Dawn, installs the es_* native
//      bindings as globals, feeds Android touch to JS, reads the APK, and renders.
//   2. The SDK bundle (dist/index.native.bundled.js, embedded): the actual esengine
//      TS SDK — createNativeApp / World / Input — installed as `ESEngine`. Not here.
//   3. The game (assets/game.js, an APK asset loaded at runtime): developer content.
//      It calls ESEngine.createNativeApp(__esNativeBridge) and authors the scene.
//      NOT compiled into the host — it ships as an asset, like a real game.
//
// The host installs the native side of the registry contract as globals:
//   * entity + hierarchy (hand-written here): es_createEntity / es_destroyEntity /
//     es_setParent / es_hasParent / es_removeParent / es_hasChildren / es_getChildren
//   * per-component (EHT-generated, esn_register): es_set_<C> / es_<C>_buffer /
//     es_<C>_has / es_<C>_remove
//   * resources + assets (hand-written): es_createTexture, es_setClear, es_readAsset
// createNativeRegistry + NativeMemoryProvider inside the SDK bundle read these off
// globalThis. Entity ids are the native Entity's raw u32 (round-tripped via
// Entity::fromRaw), so hierarchy queries return ids the SDK recognises.

#include <android_native_app_glue.h>
#include <android/log.h>
#include <android/input.h>
#include <android/asset_manager.h>
#include <android/native_window.h>

#include "esn_shim.hpp"          // quickjs + the esn_* plumbing decls (+ esn_register)
#include "esengine_bundle.h"     // the real SDK, bundled: installs globalThis.ESEngine

#include "esengine/core/EstellaContext.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/TransformSystem.hpp"          // TransformSystem + ecs::setParent
#include "esengine/ecs/components/Hierarchy.hpp"      // Parent / Children
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <glm/gtc/matrix_transform.hpp>

// stb_image for the native image-decode path (NativeBridge.loadImagePixels). The
// engine core doesn't use stb_image, so this TU owns the implementation.
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <string>
#include <vector>

#define LOG_TAG "EstellaSDK"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace esengine;

// Host platform bootstrap — HOST code, not game. It fans host touch out to the SDK
// listener and builds the NativeBridge from the host's es_* capabilities. The game
// (game.js, loaded from the APK's assets/) then calls createNativeApp(__esNativeBridge).
static const char* kBootstrapJS = R"JS(
globalThis.es_onNativeTouch = function (type, id, x, y) {
    var l = globalThis.__esInputListener;
    if (!l) return;
    if (type === 0) l.onTouchStart(id, x, y);
    else if (type === 1) l.onTouchMove(id, x, y);
    else if (type === 2) l.onTouchEnd(id);
    else l.onTouchCancel(id);
};
globalThis.__esNativeBridge = {
    readFile: function (path) {
        var b = es_readAsset(path);
        return b ? Promise.resolve(b) : Promise.reject(new Error('asset not found: ' + path));
    },
    fileExists: function (path) { return Promise.resolve(es_readAsset(path) != null); },
    fetch: function () { return Promise.resolve({ ok: false, status: 404 }); },
    loadImagePixels: function (path) {
        var r = es_loadImagePixels(path);
        return r ? Promise.resolve({ width: r.width, height: r.height, pixels: new Uint8Array(r.pixels) })
                 : Promise.reject(new Error('image decode failed: ' + path));
    },
    getStorageItem: function () { return null; },
    setStorageItem: function () {},
    removeStorageItem: function () {},
    storageKeys: function () { return []; },
    registerInput: function (l) { globalThis.__esInputListener = l; return function () { globalThis.__esInputListener = null; }; },
    devicePixelRatio: function () { return 1; },
};
)JS";

namespace {

struct App {
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    WebGPUDevice* gfx = nullptr;
    EstellaContext* ctx = nullptr;
    ecs::Registry* registry = nullptr;
    JSRuntime* rt = nullptr;
    JSContext* js = nullptr;
    AAssetManager* assets = nullptr;        // APK assets/ — the game + its content
    std::string cacheDir;                   // app private dir — SDK bytecode cache
    glm::vec4 clear{0.07f, 0.08f, 0.12f, 1.0f};
    f32 w = 0, h = 0;
    bool ready = false;         // engine + JS booted once
    bool surfaceReady = false;  // a live window surface is bound (false while screen off)
    uint64_t frame = 0;
};

App* g_app = nullptr;

}  // namespace

// ---- the esn_shim plumbing the generated component bindings call ------------

ecs::Registry& esn_reg() { return *g_app->registry; }

// Entity ids cross the boundary as the native Entity's raw u32.
Entity esn_entity(JSContext* ctx, JSValueConst v) {
    uint32_t raw = Entity::INVALID_RAW;
    JS_ToUint32(ctx, &raw, v);
    return Entity::fromRaw(raw);
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
    return JS_NewArrayBuffer(ctx, reinterpret_cast<uint8_t*>(ptr), size, nullptr, nullptr, false);
}

namespace {

// ---- entity + hierarchy: the base Registry surface the SDK World drives ------

JSValue js_createEntity(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewUint32(ctx, g_app->registry->create().id());
}
JSValue js_destroyEntity(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->registry->destroy(esn_entity(ctx, argv[0]));
    return JS_UNDEFINED;
}
JSValue js_setParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*g_app->registry, esn_entity(ctx, argv[0]), esn_entity(ctx, argv[1]));
    return JS_UNDEFINED;
}
JSValue js_hasParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    return JS_NewBool(ctx, g_app->registry->has<ecs::Parent>(esn_entity(ctx, argv[0])));
}
JSValue js_removeParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*g_app->registry, esn_entity(ctx, argv[0]), INVALID_ENTITY);
    return JS_UNDEFINED;
}
JSValue js_hasChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto* c = g_app->registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]));
    return JS_NewBool(ctx, c && !c->entities.empty());
}
JSValue js_getChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    JSValue arr = JS_NewArray(ctx);
    if (auto* c = g_app->registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]))) {
        uint32_t i = 0;
        for (Entity child : c->entities) {
            JS_SetPropertyUint32(ctx, arr, i++, JS_NewUint32(ctx, child.id()));
        }
    }
    return arr;
}

// ---- resources + clear (not reflected; the native ResourceManagerBindings analog) -

JSValue js_setClear(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double r = 0, g = 0, b = 0;
    JS_ToFloat64(ctx, &r, argv[0]); JS_ToFloat64(ctx, &g, argv[1]); JS_ToFloat64(ctx, &b, argv[2]);
    g_app->clear = {(f32)r, (f32)g, (f32)b, 1.0f};
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

// Read an APK asset (assets/<path>) fully into a buffer; empty if missing. This is
// the native NativeBridge.readFile capability — a packaged (project-relative) file.
std::vector<u8> readAsset(App& a, const char* path) {
    std::vector<u8> out;
    if (!a.assets) return out;
    AAsset* asset = AAssetManager_open(a.assets, path, AASSET_MODE_BUFFER);
    if (!asset) return out;
    off_t len = AAsset_getLength(asset);
    if (len > 0) {
        out.resize((size_t)len);
        AAsset_read(asset, out.data(), (size_t)len);
    }
    AAsset_close(asset);
    return out;
}

// es_readAsset(path) -> ArrayBuffer | null. Backs the bridge's readFile.
JSValue js_readAsset(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> bytes = readAsset(*g_app, path);
    JS_FreeCString(ctx, path);
    if (bytes.empty()) return JS_NULL;
    return JS_NewArrayBufferCopy(ctx, bytes.data(), bytes.size());
}

// es_loadImagePixels(path) -> { width, height, pixels: ArrayBuffer(RGBA) } | null.
// Decodes an APK image asset to top-first RGBA via stb_image — the native
// NativeBridge.loadImagePixels ("Path 2": decode -> createTextureFromPixels).
JSValue js_loadImagePixels(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> file = readAsset(*g_app, path);
    JS_FreeCString(ctx, path);
    if (file.empty()) return JS_NULL;
    int w = 0, h = 0, ch = 0;
    stbi_uc* px = stbi_load_from_memory(file.data(), (int)file.size(), &w, &h, &ch, 4);
    if (!px) { LOGE("stb_image decode failed"); return JS_NULL; }
    JSValue buf = JS_NewArrayBufferCopy(ctx, px, (size_t)w * (size_t)h * 4);
    stbi_image_free(px);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, h));
    JS_SetPropertyStr(ctx, obj, "pixels", buf);   // ArrayBuffer; the bootstrap wraps it Uint8Array
    return obj;
}

void logJsError(JSContext* ctx, const char* where) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    LOGE("JS error in %s: %s", where, s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, e);
}
void evalJs(App& a, const char* src, const char* name) {
    JSValue r = JS_Eval(a.js, src, strlen(src), name, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) logJsError(a.js, name);
    JS_FreeValue(a.js, r);
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

// Drain QuickJS's microtask queue. app.tick() is async: its synchronous prefix
// (finishPlugins, resource inserts) runs on call, but the systems run in jobs.
void pumpJobs(App& a) {
    JSContext* c;
    while (JS_ExecutePendingJob(a.rt, &c) > 0) { /* ran a job */ }
}

// Push one Android touch to the game's es_onNativeTouch(type,id,x,y), which fans it
// out to the NativeBridge's registered listener. type: 0 start / 1 move / 2 end / 3 cancel.
void dispatchTouch(App& a, int type, int id, float x, float y) {
    JSValue global = JS_GetGlobalObject(a.js);
    JSValue fn = JS_GetPropertyStr(a.js, global, "es_onNativeTouch");
    if (JS_IsFunction(a.js, fn)) {
        JSValue args[4] = {
            JS_NewInt32(a.js, type), JS_NewInt32(a.js, id),
            JS_NewFloat64(a.js, x), JS_NewFloat64(a.js, y),
        };
        JSValue r = JS_Call(a.js, fn, global, 4, args);
        if (JS_IsException(r)) logJsError(a.js, "es_onNativeTouch");
        JS_FreeValue(a.js, r);
        for (JSValue& v : args) JS_FreeValue(a.js, v);
    }
    JS_FreeValue(a.js, fn);
    JS_FreeValue(a.js, global);
}

void bindGlobal(App& a, JSValue global, const char* name, JSCFunction* fn, int argc) {
    JS_SetPropertyStr(a.js, global, name, JS_NewCFunction(a.js, fn, name, argc));
}

double nowMs() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

// FNV-1a of the bundle — a changed SDK invalidates its bytecode cache.
uint64_t hashBytes(const char* p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) { h ^= (uint8_t)p[i]; h *= 1099511628211ull; }
    return h;
}

// Evaluate a global script, reusing a cached bytecode compile. QuickJS is an
// interpreter: parsing the ~700 KB SDK bundle costs ~8 s every launch. So compile
// once (JS_WriteObject the bytecode, tagged with the bundle hash), and on later
// launches JS_ReadObject it — skipping the parse. The same QuickJS build writes and
// reads it, so the format always matches; the hash guards against a stale bundle,
// and a bad read just recompiles. Cache file: [8-byte hash][bytecode].
JSValue evalCachedScript(App& a, const char* src, size_t srcLen, const char* filename,
                         const std::string& cachePath) {
    const uint64_t want = hashBytes(src, srcLen);

    if (!cachePath.empty()) {
        FILE* f = fopen(cachePath.c_str(), "rb");
        if (f) {
            uint64_t got = 0;
            std::vector<u8> bc;
            if (fread(&got, sizeof(got), 1, f) == 1 && got == want) {
                fseek(f, 0, SEEK_END);
                long sz = ftell(f);
                fseek(f, (long)sizeof(got), SEEK_SET);
                if (sz > (long)sizeof(got)) {
                    bc.resize((size_t)sz - sizeof(got));
                    if (fread(bc.data(), 1, bc.size(), f) != bc.size()) bc.clear();
                }
            }
            fclose(f);
            if (!bc.empty()) {
                JSValue obj = JS_ReadObject(a.js, bc.data(), bc.size(), JS_READ_OBJ_BYTECODE);
                if (!JS_IsException(obj)) {
                    LOGI("SDK bundle: loaded from bytecode cache");
                    return JS_EvalFunction(a.js, obj);
                }
                JSValue e = JS_GetException(a.js); JS_FreeValue(a.js, e);  // stale/corrupt -> recompile
            }
        }
    }

    // Parse once (slow), cache the bytecode, run.
    JSValue fn = JS_Eval(a.js, src, srcLen, filename, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fn)) return fn;
    if (!cachePath.empty()) {
        size_t bcLen = 0;
        uint8_t* bc = JS_WriteObject(a.js, &bcLen, fn, JS_WRITE_OBJ_BYTECODE);
        if (bc) {
            FILE* f = fopen(cachePath.c_str(), "wb");
            if (f) { fwrite(&want, sizeof(want), 1, f); fwrite(bc, 1, bcLen, f); fclose(f); }
            js_free(a.js, bc);
            LOGI("SDK bundle: compiled + cached bytecode (%zu bytes)", bcLen);
        }
    }
    return JS_EvalFunction(a.js, fn);   // consumes fn
}

void initJS(App& a) {
    const double t0 = nowMs();
    a.rt = JS_NewRuntime();
    a.js = JS_NewContext(a.rt);
    JSValue global = JS_GetGlobalObject(a.js);

    JS_SetPropertyStr(a.js, global, "W", JS_NewFloat64(a.js, a.w));
    JS_SetPropertyStr(a.js, global, "H", JS_NewFloat64(a.js, a.h));
    JS_SetPropertyStr(a.js, global, "S", JS_NewFloat64(a.js, a.w < a.h ? a.w : a.h));

    // Entity + hierarchy (base Registry surface).
    bindGlobal(a, global, "es_createEntity", js_createEntity, 0);
    bindGlobal(a, global, "es_destroyEntity", js_destroyEntity, 1);
    bindGlobal(a, global, "es_setParent", js_setParent, 2);
    bindGlobal(a, global, "es_hasParent", js_hasParent, 1);
    bindGlobal(a, global, "es_removeParent", js_removeParent, 1);
    bindGlobal(a, global, "es_hasChildren", js_hasChildren, 1);
    bindGlobal(a, global, "es_getChildren", js_getChildren, 1);
    // Resources + clear + asset reads.
    bindGlobal(a, global, "es_setClear", js_setClear, 3);
    bindGlobal(a, global, "es_createTexture", js_createTexture, 3);
    bindGlobal(a, global, "es_readAsset", js_readAsset, 1);
    bindGlobal(a, global, "es_loadImagePixels", js_loadImagePixels, 1);
    // Per-component bindings (EHT-generated): es_set_<C> / es_<C>_buffer / _has / _remove.
    esn_register(a.js, global);
    JS_FreeValue(a.js, global);

    // Layers: the real SDK bundle (engine, embedded) installs ESEngine; the host
    // bootstrap (host platform glue) installs the NativeBridge; the game (an APK
    // asset, developer content) authors on top.
    const double tCtx = nowMs();
    std::string bcPath = a.cacheDir.empty() ? std::string() : (a.cacheDir + "/esengine.native.bc");
    JSValue br = evalCachedScript(a, kSdkBundleJS, strlen(kSdkBundleJS), "esengine.native.js", bcPath);
    if (JS_IsException(br)) logJsError(a.js, "SDK bundle");
    JS_FreeValue(a.js, br);
    const double tBundle = nowMs();
    evalJs(a, kBootstrapJS, "bootstrap.js");
    std::vector<u8> game = readAsset(a, "game.js");
    if (game.empty()) { LOGE("game.js asset missing from the APK"); return; }
    std::string src(reinterpret_cast<const char*>(game.data()), game.size());
    evalJs(a, src.c_str(), "game.js");
    const double tGame = nowMs();
    callJs(a, "init", 0, nullptr);
    pumpJobs(a);
    const double tInit = nowMs();
    LOGI("boot ms — qjs ctx: %.0f | SDK bundle eval: %.0f | bootstrap+game: %.0f | init(): %.0f | total JS: %.0f",
         tCtx - t0, tBundle - tCtx, tGame - tBundle, tInit - tGame, tInit - t0);
    LOGI("game.js (APK asset) init() ran on the real SDK App");
}

void renderScene(App& a) {
    if (!a.ready || !a.surfaceReady) return;
    auto& ctx = *a.ctx;
    JSValue dt = JS_NewFloat64(a.js, 1.0 / 60.0);
    callJs(a, "update", 1, &dt);
    JS_FreeValue(a.js, dt);
    pumpJobs(a);   // run the App tick's async systems

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
    if (++a.frame % 120 == 0) LOGI("real-SDK frame %llu", (unsigned long long)a.frame);
}

// Bind (or re-bind) the render surface to a window. Called on first boot and again
// on APP_CMD_INIT_WINDOW after a screen-off/on, which destroys + recreates the
// window (configureSurface is re-entrant: it drops the old surface first).
bool configureForWindow(App& a, ANativeWindow* window) {
    a.w = (f32)ANativeWindow_getWidth(window);
    a.h = (f32)ANativeWindow_getHeight(window);
    if (!a.gfx->configureSurface(
            WebGPUDevice::NativeSurface{WebGPUDevice::NativeWindowKind::AndroidWindow, window},
            (u32)a.w, (u32)a.h)) {
        LOGE("configureSurface failed");
        return false;
    }
    a.surfaceReady = true;
    return true;
}

void initEngine(App& a, ANativeWindow* window) {
    const double te0 = nowMs();
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
    a.gfx = device.get();
    if (!configureForWindow(a, window)) return;
    static EstellaContext context;
    a.ctx = &context;
    context.state().viewport_width = (i32)a.w;
    context.state().viewport_height = (i32)a.h;
    if (!context.init(std::move(device))) { LOGE("context.init failed"); return; }
    static ecs::Registry registry;
    a.registry = &registry;
    LOGI("boot ms — Dawn instance/adapter/device + EstellaContext: %.0f", nowMs() - te0);
    initJS(a);
    a.ready = true;
    LOGI("real SDK up (%dx%d) — esengine World over native Dawn", (int)a.w, (int)a.h);
}

int32_t onInput(android_app* app, AInputEvent* ev) {
    App* a = static_cast<App*>(app->userData);
    if (!a->ready || AInputEvent_getType(ev) != AINPUT_EVENT_TYPE_MOTION) return 0;
    const int32_t action = AMotionEvent_getAction(ev) & AMOTION_EVENT_ACTION_MASK;
    const float x = AMotionEvent_getX(ev, 0);
    const float y = AMotionEvent_getY(ev, 0);
    int type;
    switch (action) {
        case AMOTION_EVENT_ACTION_DOWN:
        case AMOTION_EVENT_ACTION_POINTER_DOWN: type = 0; break;
        case AMOTION_EVENT_ACTION_MOVE:         type = 1; break;
        case AMOTION_EVENT_ACTION_UP:
        case AMOTION_EVENT_ACTION_POINTER_UP:   type = 2; break;
        default:                                type = 3; break;
    }
    dispatchTouch(*a, type, 0, x, y);
    return 1;
}

void onAppCmd(android_app* app, int32_t cmd) {
    App* a = static_cast<App*>(app->userData);
    switch (cmd) {
        case APP_CMD_INIT_WINDOW:
            // First time: boot the engine. Afterwards (screen-on): just rebind the
            // new window surface — the engine + JS World stay alive.
            if (app->window) {
                if (!a->ready) initEngine(*a, app->window);
                else configureForWindow(*a, app->window);
            }
            break;
        case APP_CMD_TERM_WINDOW:
            // Screen-off / backgrounded: the window is gone, stop presenting to it.
            a->surfaceReady = false;
            break;
        default:
            break;
    }
}

}  // namespace

void android_main(android_app* app) {
    App a;
    g_app = &a;
    a.assets = app->activity->assetManager;   // APK assets/ (game.js + content)
    if (app->activity->internalDataPath) a.cacheDir = app->activity->internalDataPath;
    app->userData = &a;
    app->onAppCmd = onAppCmd;
    app->onInputEvent = onInput;
    while (true) {
        int events;
        android_poll_source* source;
        // Poll (0) while we can render; block (-1) when there's no surface (screen
        // off) so we wait for the next window event instead of spinning.
        int timeoutMs = (a.ready && a.surfaceReady) ? 0 : -1;
        while (ALooper_pollOnce(timeoutMs, nullptr, &events, (void**)&source) >= 0) {
            if (source) source->process(app, source);
            if (app->destroyRequested) return;
            timeoutMs = 0;
        }
        renderScene(a);
    }
}
