// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebSDKEntry.cpp
 * @brief   ESEngine Web SDK entry point with rendering support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */


#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>

#include "EngineContext.hpp"
#include "ActiveContext.hpp"
#include "RenderBinding.hpp"
#include "ResourceManagerBindings.hpp"
#include "RendererBindings.hpp"
#include "TestProbeBindings.hpp"
#include "UIBindings.hpp"
#include "BoundarySpan.hpp"
#include "ImmediateDrawBindings.hpp"
#include "GeometryBindings.hpp"
#include "AnimationBindings.hpp"
#include "MaterialBindings.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessBindings.hpp"
#endif
#ifdef ES_ENABLE_TILEMAP
#include "TilemapBindings.hpp"
#endif

#include "../ui/UILayoutSystem.hpp"
#include "../ui/UIHitTestSystem.hpp"
#include "../ui/UIRenderOrderSystem.hpp"
#include "../ui/UISystem.hpp"

#include "../renderer/rhi/OpenGLHeaders.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#ifdef ES_ENABLE_WEBGPU
#include "../renderer/webgpu/WebGPUDevice.hpp"
#endif
#include "../renderer/frame/RenderContext.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../resource/ShaderParser.hpp"
#ifdef ES_ENABLE_BITMAP_TEXT
#include "../text/SdfGenerator.hpp"
#endif
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Velocity.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/RigidBody2D.hpp"
#include "../ecs/components/Collider2D.hpp"
#include "../ecs/components/ShapeRenderer.hpp"
#include "../animation/TweenSystem.hpp"
#include "../core/Log.hpp"

#include <glm/glm.hpp>
#include <cstdlib>
#include <cstring>
#include <cstddef>
#include <malloc.h>

static_assert(sizeof(void*) == 4, "EM_JS pointer passing assumes wasm32 (4-byte pointers)");

namespace esengine {

static EngineContext& legacyCtx() { return EngineContext::instance(); }
// Single source of truth for the active context lives in activeCtx()
// (ActiveContext.hpp), which now carries the headless fallback uniformly — so
// this is just the file-local short alias, identical to every other binding's.
static EstellaContext& ctx() { return activeCtx(); }

#define g_initialized (ctx().state().initialized)
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#define g_renderContext (ctx().tryGet<RenderContext>())

// Bytes malloc has handed out and not got back, for the resource census. The
// reserved heap size cannot answer this: emscripten's heap only grows, so a leak
// hides until it crosses a growth step. This is exact, and it falls on free.
f64 es_getMallocBytes() {
    const struct mallinfo mi = mallinfo();
    return static_cast<f64>(static_cast<u32>(mi.uordblks));
}

// Cook-time introspection: assembles both GLSL stages exactly as the runtime would
// (same parser + injected headers), plus the reflection a GLSL→WGSL converter needs
// (texture params → sampler units). The export cook feeds the assembled stages through
// glslang+naga and appends the result as `#pragma vertex|fragment wgsl full` twins,
// so twin-less user .esshader assets run on WebGPU (REARCH_WGSL Phase 4). Runs under
// plain Node (the web glue loads there), so the cook needs no browser context.
emscripten::val esshader_cookInfo(const std::string& source, const std::string& featuresCsv) {
    emscripten::val out = emscripten::val::object();
    resource::ParsedShader parsed = resource::ShaderParser::parse(source);
    out.set("valid", parsed.valid);
    if (!parsed.valid) {
        out.set("error", parsed.errorMessage);
        return out;
    }
    const std::vector<std::string> features = resource::ShaderParser::splitFeatures(featuresCsv);
    const std::string vert = resource::ShaderParser::assembleStage(
        parsed, resource::ShaderStage::Vertex, "", features,
        resource::ShaderTargetLanguage::GLSL_ES300);
    const std::string frag = resource::ShaderParser::assembleStage(
        parsed, resource::ShaderStage::Fragment, "", features,
        resource::ShaderTargetLanguage::GLSL_ES300);
    out.set("name", parsed.name);
    out.set("domain", parsed.domain);
    out.set("hasWgslVertex", parsed.wgslStages.count(resource::ShaderStage::Vertex) != 0);
    out.set("hasWgslFragment", parsed.wgslStages.count(resource::ShaderStage::Fragment) != 0);
    out.set("hasSwitches", !parsed.switches.empty());
    out.set("canonicalVaryings", resource::ShaderParser::canonicalVaryingsWGSL(parsed));
    // The switch/feature NAMES, so a cook can enumerate the permutations it has
    // to emit a twin for — WGSL resolves them at assembly time (preprocessConditionals),
    // which needs every branch present in the body.
    emscripten::val switches = emscripten::val::array();
    u32 switchCount = 0;
    for (const auto& s : parsed.switches) switches.set(switchCount++, s.name);
    out.set("switches", switches);
    emscripten::val featureNames = emscripten::val::array();
    u32 featureCount = 0;
    for (const auto& f : parsed.features) featureNames.set(featureCount++, f);
    out.set("features", featureNames);
    out.set("vertGlsl", vert);
    out.set("fragGlsl", frag);
    emscripten::val textures = emscripten::val::array();
    u32 count = 0;
    for (const auto& p : parsed.properties) {
        if (p.fromParam && p.type == resource::ShaderPropertyType::Texture && p.textureUnit >= 0) {
            emscripten::val tex = emscripten::val::object();
            tex.set("name", p.name);
            tex.set("unit", p.textureUnit);
            textures.set(count++, tex);
        }
    }
    out.set("textures", textures);
    return out;
}

// Build provenance signature — kept self-contained (not via the umbrella
// header) so the literal is guaranteed to land in this translation unit and
// survive in the shipped binary. Emitted once at init as an origin marker.
static constexpr const char* kEstellaBuildProvenance =
    "estella-build:9abbd5b4-06f3-47df-b968-826763c6879a";

bool initRendererInternal(const char* canvasSelector) {
    if (g_initialized) return true;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
#ifdef ES_RENDER_THREADS
    attrs.proxyContextToMainThread = EMSCRIPTEN_WEBGL_CONTEXT_PROXY_DISALLOW;
#endif
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = true;
    attrs.depth = true;
    attrs.stencil = true;
    attrs.antialias = true;
    attrs.premultipliedAlpha = true;
    attrs.preserveDrawingBuffer = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;
    attrs.failIfMajorPerformanceCaveat = false;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglCtx = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (webglCtx <= 0) {
        ES_LOG_ERROR("Failed to create WebGL2 context for '{}': {}", canvasSelector, webglCtx);
        return false;
    }

    ES_LOG_INFO("WebGL2 context created for '{}'", canvasSelector);
    ES_LOG_INFO("Estella runtime provenance {}", kEstellaBuildProvenance);

    g_activeContext = &legacyCtx().context();
    if (!g_activeContext->init(static_cast<int>(webglCtx), true)) {
        // This path creates the context; an externally supplied handle is borrowed.
        emscripten_webgl_destroy_context(webglCtx);
        return false;
    }
    return true;
}

#ifdef ES_ENABLE_WEBGPU
EM_JS_DEPS(estella_webgpu_replacement, "$WebGPU");

// The page's replacement GPUDevice, as a WGPUDevice. Imported rather than read
// through emscripten_webgpu_get_device, which caches the FIRST device and would
// hand back the dead one forever.
EM_JS(uintptr_t, es_takePendingWebGPUDevice, (), {
    var device = Module['pendingWebGPUDevice'];
    if (!device) return 0;
    Module['pendingWebGPUDevice'] = null;
    return WebGPU.importJsDevice(device);
});
#endif

// The WebGPU mirror of initRendererInternal — the same platform boundary,
// injecting the backend instead of a GL context handle. The page acquires the
// GPUDevice asynchronously (navigator.gpu) BEFORE instantiating the module and
// hands it over via Module.preinitializedWebGPUDevice; the wasm side stays
// fully synchronous. @p width/@p height size the canvas swapchain (the SDK
// passes the canvas backing size it already manages).
bool initRendererWebGPU(const std::string& canvasSelector, u32 width, u32 height,
                        bool readback, bool preferBGRA) {
#ifdef ES_ENABLE_WEBGPU
    if (g_initialized) return true;

    const bool worker = ctx().renderThread().isOwner();
    WGPUDevice raw = worker ? reinterpret_cast<WGPUDevice>(es_takePendingWebGPUDevice())
                            : emscripten_webgpu_get_device();
    if (!raw) {
        ES_LOG_ERROR("initRendererWebGPU: no Module.preinitializedWebGPUDevice — the host "
                     "must acquire a GPUDevice before instantiating the module");
        return false;
    }
    auto device = makeUnique<WebGPUDevice>(raw);
    device->ownDeviceReference();
    // Before the surface is configured, because the usage is fixed there: a host
    // that will ask what was drawn (the editor's viewport capture, a pixel gate)
    // has to say so now.
    device->setLateSurfaceAcquire(worker);
    device->setSurfaceReadback(readback);
    // navigator.gpu.getPreferredCanvasFormat(), as the page reported it: any other
    // format makes the browser copy the whole frame on every present.
    device->setPreferredSurfaceBGRA(preferBGRA);
    if (!device->configureSurface(canvasSelector.c_str(), width, height)) {
        ES_LOG_ERROR("initRendererWebGPU: surface configuration failed for '{}'", canvasSelector);
        return false;
    }

    ES_LOG_INFO("WebGPU device injected for '{}' ({}x{})", canvasSelector, width, height);
    ES_LOG_INFO("Estella runtime provenance {}", kEstellaBuildProvenance);

    auto& context = legacyCtx().context();
    if (!worker) g_activeContext = &context;
    return context.init(std::move(device));
#else
    (void)canvasSelector; (void)width; (void)height; (void)readback; (void)preferBGRA;
    ES_LOG_ERROR("initRendererWebGPU: this build carries no WebGPU backend (ES_ENABLE_WEBGPU off)");
    return false;
#endif
}

// OffscreenCanvas context creation can itself wait for the browser UI event loop.
static std::atomic<int> threadedBoot{0};

#ifdef ES_RENDER_THREADS
// These callbacks run in the owner realm. A browser GPUDevice cannot be
// transferred from the page into the worker that owns the surface.
extern "C" EMSCRIPTEN_KEEPALIVE void estella_threaded_surface_ready(int glHandle, int width, int height, int bgra, int readback) {
    const bool gpu = glHandle < 0;
    const bool ok = gpu ? initRendererWebGPU("#canvas", width, height, readback != 0, bgra != 0)
                        : glHandle && ctx().init(glHandle, true);
    if (glHandle > 0 && !ok) emscripten_webgl_destroy_context(glHandle);
    threadedBoot.store(ok ? (gpu ? 2 : 1) : -1);
}

bool provideReplacementDevice();
void notifyDeviceLost(u32 reason, const std::string& message);
extern "C" EMSCRIPTEN_KEEPALIVE void estella_threaded_device_lost(int reason) {
    if (threadedBoot.load() > 0) notifyDeviceLost(reason, "Worker graphics device lost");
}
extern "C" EMSCRIPTEN_KEEPALIVE bool estella_threaded_replace_device() {
    return threadedBoot.load() == 2 && provideReplacementDevice();
}
EM_JS_DEPS(estella_threaded_surface, "$GL");
EM_JS(void, es_startWorkerSurface, (int preferGPU, const char* features, int readback), {
    const canvas = Module['canvas'];
    const wanted = UTF8ToString(features).split(',').filter(Boolean);
    let live = true;
    Module['estellaDisposeSurface'] = () => {
        live = false;
        const device = Module['preinitializedWebGPUDevice'];
        Module['estellaGLBackBuffer'] = Module['estellaGLPresent'] = null;
        Module['pendingWebGPUDevice'] = Module['preinitializedWebGPUDevice'] = null;
        if (device) device.destroy();
    };
    const setupGL = () => {
        // A pass can span worker tasks. Only publish complete frames, and keep
        // depth, stencil and antialiasing on the private WebGL drawing surface.
        const back = new OffscreenCanvas(canvas.width, canvas.height);
        const bitmap = canvas.getContext('bitmaprenderer');
        const display = bitmap || canvas.getContext('2d');
        const handle = display && GL.createContext(back, { majorVersion: 2, minorVersion: 0,
            alpha: true, depth: true, stencil: true, antialias: true, premultipliedAlpha: true,
            preserveDrawingBuffer: true, enableExtensionsByDefault: true });
        if (handle) {
            Module['estellaGLBackBuffer'] = back;
            Module['estellaGLPresent'] = bitmap
                ? () => bitmap.transferFromImageBitmap(back.transferToImageBitmap())
                : () => { display.globalCompositeOperation = 'copy'; display.drawImage(back, 0, 0); };
            back.addEventListener('webglcontextlost', event => {
                event.preventDefault();
                _estella_threaded_device_lost(1);
            });
        }
        _estella_threaded_surface_ready(handle || 0, canvas.width, canvas.height, 0, readback);
    };
    const gl = () => {
        if (!live) return;
        try { setupGL(); }
        catch (error) {
            console.error('Worker WebGL initialization failed', error);
            _estella_threaded_surface_ready(0, canvas.width, canvas.height, 0, readback);
        }
    };
    if (!preferGPU || !navigator.gpu) { gl(); return; }
    const request = async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter && adapter.requestDevice({ requiredFeatures: wanted.filter(name => adapter.features.has(name)) });
    };
    const watch = device => {
        device.addEventListener('uncapturederror', event => console.error('[webgpu]', event.error.message));
        device.lost.then(async info => {
            if (!live || Module['preinitializedWebGPUDevice'] !== device) return;
            _estella_threaded_device_lost(info.reason === 'destroyed' ? 5 : 0);
            try {
                const next = await request();
                if (!next) return;
                if (!live || Module['preinitializedWebGPUDevice'] !== device) { next.destroy(); return; }
                Module['pendingWebGPUDevice'] = next;
                if (_estella_threaded_replace_device()) {
                    Module['preinitializedWebGPUDevice'] = next;
                    watch(next);
                }
            } catch (error) { console.warn('[webgpu] worker replacement device:', error); }
        });
    };
    request().then(device => {
        if (!live) { if (device) device.destroy(); return; }
        if (!device) { gl(); return; }
        Module['pendingWebGPUDevice'] = Module['preinitializedWebGPUDevice'] = device;
        watch(device);
        _estella_threaded_surface_ready(-1, canvas.width, canvas.height, navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm', readback);
    }, gl);
});
#endif

bool initRendererThreaded(bool preferGPU, const std::string& features, bool readback) {
#ifdef ES_RENDER_THREADS
    auto& context = legacyCtx().context();
    if (context.renderThread().enabled()) return threadedBoot.load() >= 0;
    if (context.isInitialized()) return false;
    g_activeContext = &context;
    if (!startRenderThread(context, "#canvas")) return false;
    threadedBoot.store(0);
#ifndef ES_ENABLE_WEBGPU
    preferGPU = false;
#endif
    context.renderThread().enqueue([=] { es_startWorkerSurface(preferGPU, features.c_str(), readback); });
    return true;
#else
    (void)preferGPU; (void)features; (void)readback;
    return false;
#endif
}

i32 renderThread_bootStatus() { return threadedBoot.load(); }

void renderThread_resizeSurface(u32 width, u32 height) {
#ifdef ES_RENDER_THREADS
    auto& queue = ctx().renderThread();
    if (queue.enabled()) queue.enqueue([=] {
        emscripten_set_canvas_element_size("#canvas", width, height);
        EM_ASM({
            const back = Module['estellaGLBackBuffer'];
            if (back) { back.width = $0; back.height = $1; }
        }, width, height);
        renderer_resize(width, height);
    });
#else
    (void)width; (void)height;
#endif
}

bool initRenderer() {
    return initRendererInternal("#canvas");
}

bool initRendererWithContext(int contextHandle) {
    if (g_initialized) return true;
    if (contextHandle <= 0) {
        ES_LOG_ERROR("Invalid WebGL context handle: {}", contextHandle);
        return false;
    }

    g_activeContext = &legacyCtx().context();
    return g_activeContext->init(contextHandle);
}

void shutdownRenderer() {
    threadedBoot.store(-1);
    if (!g_activeContext) return;
    auto& context = *g_activeContext;
#ifdef ES_RENDER_THREADS
    if (context.renderThread().enabled()) {
        context.renderThread().invoke([&] {
            context.shutdown();
            EM_ASM({
                if (Module['estellaDisposeSurface']) Module['estellaDisposeSurface']();
                Module['estellaDisposeSurface'] = null;
            });
        });
        context.renderThread().stop();
    } else
#endif
    {
        context.shutdown();
    }
    g_activeContext = nullptr;
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager;
}

// =============================================================================
// Device Loss
// =============================================================================

namespace {
GfxDevice* activeGfxDevice() {
    return activeCtx().tryGet<GfxDevice>();
}
}  // namespace

/** @brief The device's status (see GfxDeviceStatus). Live when no device exists yet. */
u32 deviceStatus() {
    GfxDevice* device = activeGfxDevice();
    return static_cast<u32>(device ? device->deviceStatus() : GfxDeviceStatus::Live);
}

/** @brief The formatted loss report; empty while the device is live. */
std::string deviceLostReport() {
    GfxDevice* device = activeGfxDevice();
    if (!device) return {};
    const GfxDeviceLostInfo* info = device->deviceLostInfo();
    return info ? gfxFormatDeviceLost(*info) : std::string();
}

/**
 * @brief Who the device is, as `backend|vendor|renderer|version`.
 * @details Readable while the device is LIVE, which the loss report is not — a
 *          crash report needs the GPU it ran on, and by then the backend cannot
 *          be asked. Pipe-joined: one crossing, and these are driver strings
 *          rather than a schema.
 */
std::string deviceIdentity() {
    GfxDevice* device = activeGfxDevice();
    if (!device) return {};
    const GfxDeviceIdentity& id = device->deviceIdentity();
    if (!id.known()) return {};
    return id.backend + "|" + id.vendor + "|" + id.renderer + "|" + id.version;
}

/**
 * @brief Hands the backend a replacement device the page acquired.
 * @details WebGPU only: a device belongs to whoever created it, so a lost one
 *          can only be replaced from the page. Taken up by the next recovery
 *          attempt, which keeps one order of operations for both backends.
 */
bool provideReplacementDevice() {
#ifdef ES_ENABLE_WEBGPU
    GfxDevice* device = activeGfxDevice();
    if (!device) return false;
    const uintptr_t raw = es_takePendingWebGPUDevice();
    if (!raw) return false;
    return device->provideReplacementDevice(reinterpret_cast<void*>(raw));
#else
    return false;
#endif
}

/**
 * @brief Rebuilds the device and everything it issued; see GfxDevice::recoverDevice.
 * @details The device stays Recovering, drawing, until the content it is owed
 *          has been refilled or given up on, then turns Live by itself.
 */
bool recoverDevice() {
    GfxDevice* device = activeGfxDevice();
    if (!device || !device->recoverDevice()) return false;
    // What the render context built from code it builds again; everything else owed has a provider on the other side.
    if (auto* context = g_renderContext) context->restoreBuiltinContent();
    return true;
}

/**
 * @brief Reports a loss the page observed.
 * @details The browser tells JS, not wasm: `webglcontextlost` fires on the
 *          canvas element and a GPUDevice resolves its `lost` promise. Both
 *          arrive here so the C++ device stops submitting on the same frame
 *          rather than after its own next poll.
 */
void notifyDeviceLost(u32 reason, const std::string& message) {
    if (GfxDevice* device = activeGfxDevice()) {
        device->notifyDeviceLost(static_cast<GfxDeviceLostReason>(reason), message, "host");
    }
}

// Runtime glyph atlas: a Canvas2D-rasterized alpha bitmap to a signed distance
// field. Both buffers are caller-allocated in WASM linear memory and are
// width*height. Under the text flag, because the generator it calls is.
#ifdef ES_ENABLE_BITMAP_TEXT
void web_sdfFromAlpha(uintptr_t alphaPtr, uintptr_t outPtr, u32 width, u32 height, f32 spread) {
    const u64 pixels = static_cast<u64>(width) * height;
    const u8* alpha = boundarySpan<u8>(alphaPtr, pixels, "sdfFromAlpha.alpha");
    u8* out = boundarySpanMut<u8>(outPtr, pixels, "sdfFromAlpha.out");
    if (!alpha || !out) return;
    text::sdfFromAlpha(alpha, out, width, height, spread);
}
#endif

double registryLayoutEpoch(ecs::Registry& r) {
    return r.layoutEpoch();
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_layout_epoch) {
    emscripten::function("registryLayoutEpoch", &esengine::registryLayoutEpoch);
}

// Engine instancing: expose EstellaContext as
// a JS-newable instance + an explicit active-context setter, so the editor can
// own / create / destroy isolated engine contexts rather than every App being
// hard-bound to the process singleton (EngineContext::instance()). PURE ADDITION
// — the existing initRenderer paths are untouched until N3 routes through these.
// JS owns the instance (new module.EstellaContext() ... ctx.delete()), exactly
// like new module.Registry().
EMSCRIPTEN_BINDINGS(esengine_context) {
    emscripten::class_<esengine::EstellaContext>("EstellaContext")
        .constructor<>()
        // The WebGL overload — JS hands over a context handle. The
        // device-injection overload is C++-side only (harnesses/backends).
        .function("init", emscripten::select_overload<bool(int)>(&esengine::EstellaContext::init))
        .function("shutdown", &esengine::EstellaContext::shutdown)
        .function("isInitialized", &esengine::EstellaContext::isInitialized);
    // Pointer (not reference) so JS can pass null to clear the active context.
    emscripten::function(
        "setActiveContext",
        +[](esengine::EstellaContext* c) {
            if (esengine::g_activeContext) esengine::g_activeContext->renderThread().flush();
            esengine::g_activeContext = c;
        },
        emscripten::allow_raw_pointers());
}

EMSCRIPTEN_BINDINGS(esengine_renderer) {
    emscripten::function("renderThread_resizeSurface", &esengine::renderThread_resizeSurface);
    emscripten::function("renderThread_bootStatus", &esengine::renderThread_bootStatus);
    emscripten::function("initRendererThreaded", &esengine::initRendererThreaded);
    emscripten::function("initRenderer", &esengine::initRenderer);
    emscripten::function("initRendererWithContext", &esengine::initRendererWithContext);
    // Registered in every build variant; without ES_ENABLE_WEBGPU it reports
    // and returns false, so the JS surface never drifts across variants.
    emscripten::function("initRendererWebGPU", &esengine::initRendererWebGPU);
    emscripten::function("shutdownRenderer", &esengine::shutdownRenderer);
    emscripten::function("getResourceManager", &esengine::getResourceManager, emscripten::allow_raw_pointers());
#ifdef ES_ENABLE_BITMAP_TEXT
    emscripten::function("sdfFromAlpha", &esengine::web_sdfFromAlpha);
#endif
    emscripten::function("deviceStatus", ES_RENDER_BIND(deviceStatus));
    emscripten::function("deviceLostReport", ES_RENDER_BIND(deviceLostReport));
    emscripten::function("deviceIdentity", ES_RENDER_BIND(deviceIdentity));
    emscripten::function("notifyDeviceLost", ES_RENDER_BIND(notifyDeviceLost));
    emscripten::function("recoverDevice", ES_RENDER_BIND(recoverDevice));
    emscripten::function("provideReplacementDevice", ES_RENDER_BIND(provideReplacementDevice));

    emscripten::class_<esengine::resource::ResourceManager>("ResourceManager")
        .function("createTexture", ES_RENDER_BIND(rm_createTexture))
        .function("createTextureEx", ES_RENDER_BIND(rm_createTextureEx))
        .function("createTextureArray", ES_RENDER_BIND(rm_createTextureArray))
        .function("createShader", ES_RENDER_BIND(rm_createShader))
        .function("supportsCompressedFormat", ES_RENDER_BIND(rm_supportsCompressedFormat))
        .function("createCompressedTexture", ES_RENDER_BIND(rm_createCompressedTexture))
        .function("registerExternalTexture", ES_RENDER_BIND(rm_registerExternalTexture))
        .function("registerExternalTextureSized", ES_RENDER_BIND(rm_registerExternalTextureSized))
        .function("wrapDeviceTexture", ES_RENDER_BIND(rm_wrapDeviceTexture))
        .function("texturesAwaitingReupload", ES_RENDER_BIND(rm_texturesAwaitingReupload))
        .function("forgoTextureContent", ES_RENDER_BIND(rm_forgoTextureContent))
        .function("restoreTextureContent", ES_RENDER_BIND(rm_restoreTextureContent))
        .function("getTextureNativeId", ES_RENDER_BIND(rm_getTextureNativeId))
        .function("meshesAwaitingRemat", ES_RENDER_BIND(rm_meshesAwaitingRemat))
        .function("meshRealizations", ES_RENDER_BIND(rm_meshRealizations))
        .function("adoptTextureContent", ES_RENDER_BIND(rm_adoptTextureContent))
        .function("releaseTexture", ES_RENDER_BIND(rm_releaseTexture))
        .function("getTextureRefCount", ES_RENDER_BIND(rm_getTextureRefCount))
        .function("releaseShader", ES_RENDER_BIND(rm_releaseShader))
        .function("getShaderRefCount", ES_RENDER_BIND(rm_getShaderRefCount))
        .function("getTextureGLId", ES_RENDER_BIND(rm_getTextureGLId))
        .function("getTextureDimensions", ES_RENDER_BIND(rm_getTextureDimensions))
        .function("setTextureMetadata", ES_RENDER_BIND(rm_setTextureMetadata))
        .function("updateTextureSubregion", ES_RENDER_BIND(rm_updateTextureSubregion))
        .function("registerTextureWithPath", ES_RENDER_BIND(rm_registerTextureWithPath))
        .function("setTextureBudget", ES_RENDER_BIND(rm_setTextureBudget))
        .function("setRetainedBudget", ES_RENDER_BIND(rm_setRetainedBudget))
        .function("acquireTextureByPath", ES_RENDER_BIND(rm_acquireTextureByPath))
        .function("invalidateTexturePath", ES_RENDER_BIND(rm_invalidateTexturePath))
        .function("trimTextureCache", ES_RENDER_BIND(rm_trimTextureCache))
        .function("getResourceStats", ES_RENDER_BIND(rm_getResourceStats))
#ifdef ES_ENABLE_BITMAP_TEXT
        .function("loadBitmapFont", ES_RENDER_BIND(rm_loadBitmapFont))
        .function("createLabelAtlasFont", ES_RENDER_BIND(rm_createLabelAtlasFont))
        .function("releaseBitmapFont", ES_RENDER_BIND(rm_releaseBitmapFont))
        .function("getBitmapFontRefCount", ES_RENDER_BIND(rm_getBitmapFontRefCount))
        .function("measureBitmapText", ES_RENDER_BIND(rm_measureBitmapText))
#endif
        ;

    // Every skeletal runtime is a side module; this is the one door their posed
    // geometry comes through, so it belongs to neither of their build flags.
    emscripten::function("renderer_submitSkeletalBatchByEntity", ES_RENDER_BIND(renderer_submitSkeletalBatchByEntity));
    emscripten::function("renderer_submitSkeletalBatchByEntityEx", ES_RENDER_BIND(renderer_submitSkeletalBatchByEntityEx));
    emscripten::function("renderer_entityVisibleToCamera", ES_RENDER_BIND(renderer_entityVisibleToCamera));
    emscripten::function("renderer_submitTextBatch", ES_RENDER_BIND(renderer_submitTextBatch));
    emscripten::function("renderer_retainedTextBegin", ES_RENDER_BIND(renderer_retainedTextBegin));
    emscripten::function("renderer_retainedTextBeginInWorld", ES_RENDER_BIND(renderer_retainedTextBeginInWorld));
    emscripten::function("renderer_retainedTextBatch", ES_RENDER_BIND(renderer_retainedTextBatch));
    emscripten::function("renderer_retainedTextBatchInWorld", ES_RENDER_BIND(renderer_retainedTextBatchInWorld));
    emscripten::function("renderer_retainedTextClear", ES_RENDER_BIND(renderer_retainedTextClear));
    emscripten::function("renderer_retainedTextClearInWorld", ES_RENDER_BIND(renderer_retainedTextClearInWorld));
    emscripten::function("renderer_retainedTextStale", ES_RENDER_BIND(renderer_retainedTextStale));
    emscripten::function("renderer_retainedTextSubmit", ES_RENDER_BIND(renderer_retainedTextSubmit));
    emscripten::function("meshRenderer_setGeometry", ES_RENDER_BIND(meshRenderer_setGeometry));
    emscripten::function("meshRenderer_trySetGeometry", ES_RENDER_BIND(meshRenderer_trySetGeometry));
    emscripten::function("meshInstances_set", ES_RENDER_BIND(meshInstances_set));
    emscripten::function("mesh_createFromChannels", ES_RENDER_BIND(mesh_createFromChannels));
    emscripten::function("mesh_rematerializeFromChannels", ES_RENDER_BIND(mesh_rematerializeFromChannels));
    emscripten::function("mesh_setClusters", ES_RENDER_BIND(mesh_setClusters));
    emscripten::function("mesh_setSkinChunks", ES_RENDER_BIND(mesh_setSkinChunks));
    emscripten::function("mesh_release", ES_RENDER_BIND(mesh_release));
    emscripten::function("environment_create", ES_RENDER_BIND(environment_create));
    emscripten::function("environment_setSky", ES_RENDER_BIND(environment_setSky));
    emscripten::function("environment_setSun", ES_RENDER_BIND(environment_setSun));
    emscripten::function("environment_release", ES_RENDER_BIND(environment_release));
    emscripten::function("renderer_setSkyEnvironment", ES_RENDER_BIND(renderer_setSkyEnvironment));
    emscripten::function("probe_volume_create", ES_RENDER_BIND(probe_volume_create));
    emscripten::function("probe_volume_createBricks", ES_RENDER_BIND(probe_volume_createBricks));
    emscripten::function("probe_volume_getResolution", ES_RENDER_BIND(probe_volume_getResolution));
    emscripten::function("probe_volume_getBricks", ES_RENDER_BIND(probe_volume_getBricks));
    emscripten::function("probe_volume_release", ES_RENDER_BIND(probe_volume_release));
    emscripten::function("probe_volume_setSkyVisibility", ES_RENDER_BIND(probe_volume_setSkyVisibility));
    emscripten::function("meshRenderer_localBounds", ES_RENDER_BIND(meshRenderer_localBounds));
    emscripten::function("meshRenderer_makeAllResident", ES_RENDER_BIND(meshRenderer_makeAllResident));
    emscripten::function("meshRenderer_setMeshAll", ES_RENDER_BIND(meshRenderer_setMeshAll));
    emscripten::function("meshRenderer_setMaterialAll", ES_RENDER_BIND(meshRenderer_setMaterialAll));

    emscripten::function("material_compileEsshader", ES_RENDER_BIND(material_compileEsshader));
    emscripten::function("esshader_cookInfo", &esengine::esshader_cookInfo);
    emscripten::function("es_getMallocBytes", &esengine::es_getMallocBytes);
    emscripten::function("material_define", ES_RENDER_BIND(material_define));
    emscripten::function("material_setUniform", ES_RENDER_BIND(material_setUniform));
    emscripten::function("material_setTexture", ES_RENDER_BIND(material_setTexture));
    emscripten::function("material_undefine", ES_RENDER_BIND(material_undefine));

    emscripten::function("draw_begin", ES_RENDER_BIND(draw_begin));
    emscripten::function("draw_end", ES_RENDER_BIND(draw_end));
    emscripten::function("draw_deferEnd", ES_RENDER_BIND(draw_deferEnd));
    emscripten::function("draw_line", ES_RENDER_BIND(draw_line));
    emscripten::function("draw_line3D", ES_RENDER_BIND(draw_line3D));
    emscripten::function("draw_line3DScreen", ES_RENDER_BIND(draw_line3DScreen));
    emscripten::function("draw_line3DScreenOffset", ES_RENDER_BIND(draw_line3DScreenOffset));
    emscripten::function("draw_rect", ES_RENDER_BIND(draw_rect));
    emscripten::function("draw_rectOutline", ES_RENDER_BIND(draw_rectOutline));
    emscripten::function("draw_circle", ES_RENDER_BIND(draw_circle));
    emscripten::function("draw_circleOutline", ES_RENDER_BIND(draw_circleOutline));
    emscripten::function("draw_texture", ES_RENDER_BIND(draw_texture));
    emscripten::function("draw_textureRotated", ES_RENDER_BIND(draw_textureRotated));
    emscripten::function("draw_triangles", ES_RENDER_BIND(draw_triangles));
    emscripten::function("draw_createTriangleMesh", ES_RENDER_BIND(draw_createTriangleMesh));
    emscripten::function("draw_destroyTriangleMesh", ES_RENDER_BIND(draw_destroyTriangleMesh));
    emscripten::function("draw_triangleMesh", ES_RENDER_BIND(draw_triangleMesh));
    emscripten::function("draw_triangleMeshMany", ES_RENDER_BIND(draw_triangleMeshMany));
    emscripten::function("draw_setLayer", ES_RENDER_BIND(draw_setLayer));
    emscripten::function("draw_setDepth", ES_RENDER_BIND(draw_setDepth));
    emscripten::function("draw_getDrawCallCount", ES_RENDER_BIND(draw_getDrawCallCount));
    emscripten::function("draw_getPrimitiveCount", ES_RENDER_BIND(draw_getPrimitiveCount));
    emscripten::function("draw_setBlendMode", ES_RENDER_BIND(draw_setBlendMode));
    emscripten::function("draw_setDepthTest", ES_RENDER_BIND(draw_setDepthTest));
    emscripten::function("draw_getDepthState", ES_RENDER_BIND(draw_getDepthState));
    emscripten::function("draw_setDepthState", ES_RENDER_BIND(draw_setDepthState));
    emscripten::function("draw_deferBegin", ES_RENDER_BIND(draw_deferBegin));
    emscripten::function("draw_mesh", ES_RENDER_BIND(draw_mesh));
    emscripten::function("draw_meshWithUniforms", ES_RENDER_BIND(draw_meshWithUniforms));
    emscripten::function("draw_meshWithMaterial", ES_RENDER_BIND(draw_meshWithMaterial));

    emscripten::function("geometry_create", ES_RENDER_BIND(geometry_create));
    emscripten::function("geometry_init", ES_RENDER_BIND(geometry_init));
    emscripten::function("geometry_setIndices16", ES_RENDER_BIND(geometry_setIndices16));
    emscripten::function("geometry_setIndices32", ES_RENDER_BIND(geometry_setIndices32));
    emscripten::function("geometry_updateVertices", ES_RENDER_BIND(geometry_updateVertices));
    emscripten::function("geometry_release", ES_RENDER_BIND(geometry_release));
    emscripten::function("geometry_isValid", ES_RENDER_BIND(geometry_isValid));

#ifdef ES_ENABLE_POSTPROCESS
    emscripten::function("postprocess_init", ES_RENDER_BIND(postprocess_init));
    emscripten::function("postprocess_shutdown", ES_RENDER_BIND(postprocess_shutdown));
    emscripten::function("postprocess_resize", ES_RENDER_BIND(postprocess_resize));
    emscripten::function("postprocess_addPass", ES_RENDER_BIND(postprocess_addPass));
    emscripten::function("postprocess_addComputePass", ES_RENDER_BIND(postprocess_addComputePass));
    emscripten::function("postprocess_supportsCompute", ES_RENDER_BIND(postprocess_supportsCompute));
    emscripten::function("postprocess_addNativePass", ES_RENDER_BIND(postprocess_addNativePass));
    emscripten::function("postprocess_setGIScene", ES_RENDER_BIND(postprocess_setGIScene));
    emscripten::function("postprocess_updateGIField", ES_RENDER_BIND(postprocess_updateGIField));
    emscripten::function("postprocess_setPassScale", ES_RENDER_BIND(postprocess_setPassScale));
    emscripten::function("postprocess_setPassContinuesEffect", ES_RENDER_BIND(postprocess_setPassContinuesEffect));
    emscripten::function("postprocess_requestSkyCapture", ES_RENDER_BIND(postprocess_requestSkyCapture));
    emscripten::function("postprocess_pollSkyCapture", ES_RENDER_BIND(postprocess_pollSkyCapture));
    emscripten::function("postprocess_takeSkyCapture", ES_RENDER_BIND(postprocess_takeSkyCapture));
    emscripten::function("postprocess_giStats", ES_RENDER_BIND(postprocess_giStats));
    emscripten::function("postprocess_setMsaaSamples", ES_RENDER_BIND(postprocess_setMsaaSamples));
    emscripten::function("postprocess_effectiveMsaaSamples", ES_RENDER_BIND(postprocess_effectiveMsaaSamples));
    emscripten::function("postprocess_maxMsaaSamples", ES_RENDER_BIND(postprocess_maxMsaaSamples));
    emscripten::function("postprocess_hdrFormat", ES_RENDER_BIND(postprocess_hdrFormat));
    emscripten::function("postprocess_hdrFormatNames", ES_RENDER_BIND(postprocess_hdrFormatNames));
    emscripten::function("postprocess_setUniformFloat", ES_RENDER_BIND(postprocess_setUniformFloat));
    emscripten::function("postprocess_setUniformVec4", ES_RENDER_BIND(postprocess_setUniformVec4));
    emscripten::function("postprocess_setPassTexture", ES_RENDER_BIND(postprocess_setPassTexture));
    emscripten::function("postprocess_begin", ES_RENDER_BIND(postprocess_begin));
    emscripten::function("postprocess_end", ES_RENDER_BIND(postprocess_end));
    emscripten::function("postprocess_isInitialized", ES_RENDER_BIND(postprocess_isInitialized));
    emscripten::function("postprocess_setBypass", ES_RENDER_BIND(postprocess_setBypass));
    emscripten::function("postprocess_setOutputTransform", ES_RENDER_BIND(postprocess_setOutputTransform));
    emscripten::function("postprocess_setDisplayLut", ES_RENDER_BIND(postprocess_setDisplayLut));
    emscripten::function("postprocess_setViewExposure", ES_RENDER_BIND(postprocess_setViewExposure));
    emscripten::function("postprocess_clearPasses", ES_RENDER_BIND(postprocess_clearPasses));
    emscripten::function("postprocess_setOutputViewport", ES_RENDER_BIND(postprocess_setOutputViewport));
    emscripten::function("postprocess_setPresentRequired", ES_RENDER_BIND(postprocess_setPresentRequired));
    emscripten::function("postprocess_beginScreenCapture", ES_RENDER_BIND(postprocess_beginScreenCapture));
    emscripten::function("postprocess_endScreenCapture", ES_RENDER_BIND(postprocess_endScreenCapture));
    emscripten::function("postprocess_executeScreenPasses", ES_RENDER_BIND(postprocess_executeScreenPasses));
    emscripten::function("postprocess_addScreenPass", ES_RENDER_BIND(postprocess_addScreenPass));
    emscripten::function("postprocess_clearScreenPasses", ES_RENDER_BIND(postprocess_clearScreenPasses));
    emscripten::function("postprocess_setScreenUniformFloat", ES_RENDER_BIND(postprocess_setScreenUniformFloat));
    emscripten::function("postprocess_setScreenUniformVec4", ES_RENDER_BIND(postprocess_setScreenUniformVec4));
#endif

#ifdef ES_ENABLE_TILEMAP
    // Tilemaps registered here with every other binding, from the same
    // TilemapBindings.hpp declarations the native wrappers are generated from.
    emscripten::function("tilemap_initLayer", ES_RENDER_BIND(tilemap_initLayer));
    emscripten::function("tilemap_initLayerInWorld", ES_RENDER_BIND(tilemap_initLayerInWorld));
    emscripten::function("tilemap_initInfinite", ES_RENDER_BIND(tilemap_initInfinite));
    emscripten::function("tilemap_initInfiniteInWorld", ES_RENDER_BIND(tilemap_initInfiniteInWorld));
    emscripten::function("tilemap_destroyLayer", ES_RENDER_BIND(tilemap_destroyLayer));
    emscripten::function("tilemap_destroyLayerInWorld", ES_RENDER_BIND(tilemap_destroyLayerInWorld));
    emscripten::function("tilemap_setTile", ES_RENDER_BIND(tilemap_setTile));
    emscripten::function("tilemap_setTileInWorld", ES_RENDER_BIND(tilemap_setTileInWorld));
    emscripten::function("tilemap_getTile", ES_RENDER_BIND(tilemap_getTile));
    emscripten::function("tilemap_getTileInWorld", ES_RENDER_BIND(tilemap_getTileInWorld));
    emscripten::function("tilemap_fillRect", ES_RENDER_BIND(tilemap_fillRect));
    emscripten::function("tilemap_fillRectInWorld", ES_RENDER_BIND(tilemap_fillRectInWorld));
    emscripten::function("tilemap_setTiles", ES_RENDER_BIND(tilemap_setTiles));
    emscripten::function("tilemap_setTilesInWorld", ES_RENDER_BIND(tilemap_setTilesInWorld));
    emscripten::function("tilemap_setTilesets", ES_RENDER_BIND(tilemap_setTilesets));
    emscripten::function("tilemap_setTilesetsInWorld", ES_RENDER_BIND(tilemap_setTilesetsInWorld));
    emscripten::function("tilemap_hasLayer", ES_RENDER_BIND(tilemap_hasLayer));
    emscripten::function("tilemap_hasLayerInWorld", ES_RENDER_BIND(tilemap_hasLayerInWorld));
    emscripten::function("tilemap_getEditRevision", ES_RENDER_BIND(tilemap_getEditRevision));
    emscripten::function("tilemap_getEditRevisionInWorld", ES_RENDER_BIND(tilemap_getEditRevisionInWorld));
    emscripten::function("tilemap_getGeneration", ES_RENDER_BIND(tilemap_getGeneration));
    emscripten::function("tilemap_getGenerationInWorld", ES_RENDER_BIND(tilemap_getGenerationInWorld));
    emscripten::function("tilemap_readChunkIndex", ES_RENDER_BIND(tilemap_readChunkIndex));
    emscripten::function("tilemap_readChunkIndexInWorld", ES_RENDER_BIND(tilemap_readChunkIndexInWorld));
    emscripten::function("tilemap_readChunkTiles", ES_RENDER_BIND(tilemap_readChunkTiles));
    emscripten::function("tilemap_readChunkTilesInWorld", ES_RENDER_BIND(tilemap_readChunkTilesInWorld));
    emscripten::function("tilemap_setRenderProps", ES_RENDER_BIND(tilemap_setRenderProps));
    emscripten::function("tilemap_setRenderPropsInWorld", ES_RENDER_BIND(tilemap_setRenderPropsInWorld));
    emscripten::function("tilemap_setTint", ES_RENDER_BIND(tilemap_setTint));
    emscripten::function("tilemap_setTintInWorld", ES_RENDER_BIND(tilemap_setTintInWorld));
    emscripten::function("tilemap_setVisible", ES_RENDER_BIND(tilemap_setVisible));
    emscripten::function("tilemap_setVisibleInWorld", ES_RENDER_BIND(tilemap_setVisibleInWorld));
    emscripten::function("tilemap_setOriginEntity", ES_RENDER_BIND(tilemap_setOriginEntity));
    emscripten::function("tilemap_setOriginEntityInWorld", ES_RENDER_BIND(tilemap_setOriginEntityInWorld));
    emscripten::function("tilemap_exportChunks", ES_RENDER_BIND(tilemap_exportChunks));
    emscripten::function("tilemap_exportChunksInWorld", ES_RENDER_BIND(tilemap_exportChunksInWorld));
    emscripten::function("tilemap_importChunks", ES_RENDER_BIND(tilemap_importChunks));
    emscripten::function("tilemap_importChunksInWorld", ES_RENDER_BIND(tilemap_importChunksInWorld));
    emscripten::function("tilemap_importChunksFromBytes", ES_RENDER_BIND(tilemap_importChunksFromBytes));
    emscripten::function("tilemap_importChunksFromBytesInWorld", ES_RENDER_BIND(tilemap_importChunksFromBytesInWorld));
    emscripten::function("tilemap_initInfiniteLayer", ES_RENDER_BIND(tilemap_initInfiniteLayer));
    emscripten::function("tilemap_initInfiniteLayerInWorld", ES_RENDER_BIND(tilemap_initInfiniteLayerInWorld));
    emscripten::function("tilemap_setChunkTiles", ES_RENDER_BIND(tilemap_setChunkTiles));
    emscripten::function("tilemap_setChunkTilesInWorld", ES_RENDER_BIND(tilemap_setChunkTilesInWorld));
    emscripten::function("tilemap_removeChunk", ES_RENDER_BIND(tilemap_removeChunk));
    emscripten::function("tilemap_removeChunkInWorld", ES_RENDER_BIND(tilemap_removeChunkInWorld));
    emscripten::function("tilemap_setTileAnimation", ES_RENDER_BIND(tilemap_setTileAnimation));
    emscripten::function("tilemap_setTileAnimationInWorld", ES_RENDER_BIND(tilemap_setTileAnimationInWorld));
    emscripten::function("tilemap_clearTileAnimations", ES_RENDER_BIND(tilemap_clearTileAnimations));
    emscripten::function("tilemap_clearTileAnimationsInWorld", ES_RENDER_BIND(tilemap_clearTileAnimationsInWorld));
    emscripten::function("tilemap_advanceAnimations", ES_RENDER_BIND(tilemap_advanceAnimations));
    emscripten::function("tilemap_advanceAnimationsInWorld", ES_RENDER_BIND(tilemap_advanceAnimationsInWorld));
    emscripten::function("tilemap_setTileProperty", ES_RENDER_BIND(tilemap_setTileProperty));
    emscripten::function("tilemap_setTilePropertyInWorld", ES_RENDER_BIND(tilemap_setTilePropertyInWorld));
    emscripten::function("tilemap_getTileProperty", ES_RENDER_BIND(tilemap_getTileProperty));
    emscripten::function("tilemap_getTilePropertyInWorld", ES_RENDER_BIND(tilemap_getTilePropertyInWorld));
    emscripten::function("tilemap_flipTile", ES_RENDER_BIND(tilemap_flipTile));
    emscripten::function("tilemap_flipTileInWorld", ES_RENDER_BIND(tilemap_flipTileInWorld));
    emscripten::function("tilemap_rotateTile", ES_RENDER_BIND(tilemap_rotateTile));
    emscripten::function("tilemap_rotateTileInWorld", ES_RENDER_BIND(tilemap_rotateTileInWorld));
    emscripten::function("tilemap_setGridType", ES_RENDER_BIND(tilemap_setGridType));
    emscripten::function("tilemap_setGridTypeInWorld", ES_RENDER_BIND(tilemap_setGridTypeInWorld));
    emscripten::function("tilemap_setHexParams", ES_RENDER_BIND(tilemap_setHexParams));
    emscripten::function("tilemap_setHexParamsInWorld", ES_RENDER_BIND(tilemap_setHexParamsInWorld));
    emscripten::function("tilemap_tileToWorld", ES_RENDER_BIND(tilemap_tileToWorld));
    emscripten::function("tilemap_tileToWorldInWorld", ES_RENDER_BIND(tilemap_tileToWorldInWorld));
    emscripten::function("tilemap_worldToTile", ES_RENDER_BIND(tilemap_worldToTile));
    emscripten::function("tilemap_worldToTileInWorld", ES_RENDER_BIND(tilemap_worldToTileInWorld));
#endif

    emscripten::function("renderer_init", ES_RENDER_BIND(renderer_init));
    emscripten::function("renderer_resize", ES_RENDER_BIND(renderer_resize));
    emscripten::function("renderThread_enabled", &esengine::renderThread_enabled);
    emscripten::function("renderThread_fence", &esengine::renderThread_fence);
    emscripten::function("renderThread_complete", &esengine::renderThread_complete);
    emscripten::function("renderThread_flush", &esengine::renderThread_flush);
    emscripten::function("renderer_beginFrame", ES_RENDER_BIND(renderer_beginFrame));
    emscripten::function("renderer_setOrigin", ES_RENDER_BIND(renderer_setOrigin));
    emscripten::function("renderer_setParallaxAnchor", ES_RENDER_BIND(renderer_setParallaxAnchor));
    emscripten::function("renderer_begin", ES_RENDER_BIND(renderer_begin));
    emscripten::function("renderer_flush", ES_RENDER_BIND(renderer_flush));
    emscripten::function("renderer_end", ES_RENDER_BIND(renderer_end));
    emscripten::function("renderer_endFrame", ES_RENDER_BIND(renderer_endFrame));
    emscripten::function("renderer_beginScreenOverlay", ES_RENDER_BIND(renderer_beginScreenOverlay));
    emscripten::function("renderer_submitScreenOverlay", ES_RENDER_BIND(renderer_submitScreenOverlay));
    emscripten::function("renderer_keepScreenOverlay", ES_RENDER_BIND(renderer_keepScreenOverlay));
    emscripten::function("renderer_setRetainedTextCollected", ES_RENDER_BIND(renderer_setRetainedTextCollected));
    emscripten::function("renderer_setRetainedTextCollectedInWorld", ES_RENDER_BIND(renderer_setRetainedTextCollectedInWorld));
    emscripten::function("renderer_setScreenOverlayEffect", ES_RENDER_BIND(renderer_setScreenOverlayEffect));
    emscripten::function("renderer_endScreenOverlay", ES_RENDER_BIND(renderer_endScreenOverlay));
    emscripten::function("renderer_drawOverScreen", ES_RENDER_BIND(renderer_drawOverScreen));
#ifdef ES_ENABLE_BITMAP_TEXT
#endif

#ifdef ES_ENABLE_PARTICLES
#endif
    emscripten::function("renderer_updateTransforms", ES_RENDER_BIND(renderer_updateTransforms));
    // The address of the composition's staleness counter, so a producer on the
    // JS side stores into linear memory instead of calling across it. Measured:
    // the store is below noise, the call nearly doubles a Transform write.
    emscripten::function("transform_epochAddress", emscripten::optional_override([]() -> uintptr_t {
        return reinterpret_cast<uintptr_t>(&esengine::ecs::transformMutationEpoch());
    }));
    emscripten::function("transform_ensureComposed", emscripten::optional_override(
        [](esengine::ecs::Registry& registry) {
            if (auto* ts = esengine::ctx().tryGet<esengine::ecs::TransformSystem>()) {
                ts->ensureComposed(registry);
            }
        }), emscripten::allow_raw_pointers());
    // Whether composition also records WHICH entities' output moved. Off by
    // default: only a consumer maintaining an incremental structure needs it.
    emscripten::function("transform_setChangeTracking", emscripten::optional_override(
        [](bool on) {
            if (auto* ts = esengine::ctx().tryGet<esengine::ecs::TransformSystem>()) {
                ts->setChangeTracking(on);
            }
        }));
    // What every composition since the last acknowledgement changed: the entities
    // as an address into linear memory, because a JS array of a hundred thousand
    // handles would cost more than the walk that found them.
    emscripten::function("transform_compositionChanges", emscripten::optional_override(
        []() -> emscripten::val {
            static_assert(sizeof(esengine::Entity) == sizeof(esengine::u32),
                          "the changed set is read as a Uint32Array of raw ids");
            auto out = emscripten::val::object();
            auto* ts = esengine::ctx().tryGet<esengine::ecs::TransformSystem>();
            out.set("serial", ts ? ts->compositionSerial() : 0u);
            out.set("tracking", ts && ts->changeTracking());
            out.set("overflowed", ts && ts->changesOverflowed());
            out.set("count", ts ? static_cast<esengine::u32>(ts->pendingChanges().size()) : 0u);
            out.set("visited", ts ? ts->visited() : 0u);
            out.set("ptr", ts ? static_cast<esengine::u32>(
                reinterpret_cast<uintptr_t>(ts->pendingChanges().data())) : 0u);
            return out;
        }));
    // Applied: the set starts again. Separate from the read so a consumer that
    // throws half way through has not acknowledged, and gets it again.
    emscripten::function("transform_takeChanges", emscripten::optional_override([]() {
        if (auto* ts = esengine::ctx().tryGet<esengine::ecs::TransformSystem>()) ts->takeChanges();
    }));
    emscripten::function("renderer_setEntityDrawOrder", ES_RENDER_BIND(renderer_setEntityDrawOrder));
    emscripten::function("renderer_submitAll", ES_RENDER_BIND(renderer_submitAll));
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("particle_update", ES_RENDER_BIND(particle_update));
    emscripten::function("particle_collisionQueryCount", ES_RENDER_BIND(particle_collisionQueryCount));
    emscripten::function("particle_collisionQueries", ES_RENDER_BIND(particle_collisionQueries));
    emscripten::function("particle_collisionEventCount", ES_RENDER_BIND(particle_collisionEventCount));
    emscripten::function("particle_collisionEvents", ES_RENDER_BIND(particle_collisionEvents));
    emscripten::function("particle_collisionStatsCount", ES_RENDER_BIND(particle_collisionStatsCount));
    emscripten::function("particle_collisionStats", ES_RENDER_BIND(particle_collisionStats));
    emscripten::function("particle_collisionResolve", ES_RENDER_BIND(particle_collisionResolve));
    emscripten::function("particle_collisionSetBudget", ES_RENDER_BIND(particle_collisionSetBudget));
    emscripten::function("particle_play", ES_RENDER_BIND(particle_play));
    emscripten::function("particle_stop", ES_RENDER_BIND(particle_stop));
    emscripten::function("particle_reset", ES_RENDER_BIND(particle_reset));
    emscripten::function("particle_forgetEmitter", ES_RENDER_BIND(particle_forgetEmitter));
    emscripten::function("particle_emitAt", ES_RENDER_BIND(particle_emitAt));
    emscripten::function("particle_getAliveCount", ES_RENDER_BIND(particle_getAliveCount));
    emscripten::function("particle_set_color_lut", ES_RENDER_BIND(particle_set_color_lut));
    emscripten::function("particle_set_size_lut", ES_RENDER_BIND(particle_set_size_lut));
    emscripten::function("particle_set_speed_lut", ES_RENDER_BIND(particle_set_speed_lut));
    emscripten::function("particle_set_bursts", ES_RENDER_BIND(particle_set_bursts));
    emscripten::function("particle_collisionQueryCountInWorld", ES_RENDER_BIND(particle_collisionQueryCountInWorld));
    emscripten::function("particle_collisionQueriesInWorld", ES_RENDER_BIND(particle_collisionQueriesInWorld));
    emscripten::function("particle_collisionEventCountInWorld", ES_RENDER_BIND(particle_collisionEventCountInWorld));
    emscripten::function("particle_collisionEventsInWorld", ES_RENDER_BIND(particle_collisionEventsInWorld));
    emscripten::function("particle_collisionStatsCountInWorld", ES_RENDER_BIND(particle_collisionStatsCountInWorld));
    emscripten::function("particle_collisionStatsInWorld", ES_RENDER_BIND(particle_collisionStatsInWorld));
    emscripten::function("particle_collisionSetBudgetInWorld", ES_RENDER_BIND(particle_collisionSetBudgetInWorld));
    emscripten::function("particle_getAliveCountInWorld", ES_RENDER_BIND(particle_getAliveCountInWorld));
    emscripten::function("particle_setColorLutInWorld", ES_RENDER_BIND(particle_setColorLutInWorld));
    emscripten::function("particle_setSizeLutInWorld", ES_RENDER_BIND(particle_setSizeLutInWorld));
    emscripten::function("particle_setSpeedLutInWorld", ES_RENDER_BIND(particle_setSpeedLutInWorld));
    emscripten::function("particle_setBurstsInWorld", ES_RENDER_BIND(particle_setBurstsInWorld));
#endif
    emscripten::function("trail_update", ES_RENDER_BIND(trail_update));
    emscripten::function("trail_clear", ES_RENDER_BIND(trail_clear));
    emscripten::function("springbone_update", &esengine::springbone_update);
    emscripten::function("springbone_reset", &esengine::springbone_reset);
    emscripten::function("springbone_release", &esengine::springbone_release);
    emscripten::function("springbone_snapshot", &esengine::springbone_snapshot);
    emscripten::function("springbone_snapshotCount", &esengine::springbone_snapshotCount);
    emscripten::function("springbone_snapshotData", &esengine::springbone_snapshotData);
    emscripten::function("springbone_snapshotCountInWorld", &esengine::springbone_snapshotCountInWorld);
    emscripten::function("springbone_snapshotDataInWorld", &esengine::springbone_snapshotDataInWorld);
    emscripten::function("renderer_setStage", ES_RENDER_BIND(renderer_setStage));
    emscripten::function("renderer_createTarget", ES_RENDER_BIND(renderer_createTarget));
    emscripten::function("renderer_releaseTarget", ES_RENDER_BIND(renderer_releaseTarget));
    emscripten::function("renderer_getTargetTexture", ES_RENDER_BIND(renderer_getTargetTexture));
    emscripten::function("renderer_queueMaterialBake", ES_RENDER_BIND(renderer_queueMaterialBake));
    emscripten::function("renderer_projectMaterialBake", ES_RENDER_BIND(renderer_projectMaterialBake));
    emscripten::function("renderer_materialBakeState", ES_RENDER_BIND(renderer_materialBakeState));
    emscripten::function("renderer_getTargetDepthTexture", ES_RENDER_BIND(renderer_getTargetDepthTexture));
    emscripten::function("renderer_getDrawCalls", ES_RENDER_BIND(renderer_getDrawCalls));
    emscripten::function("renderer_getGpuDrawCalls", ES_RENDER_BIND(renderer_getGpuDrawCalls));
    emscripten::function("renderer_getDrawsWaitingForProgram", ES_RENDER_BIND(renderer_getDrawsWaitingForProgram));
    emscripten::function("renderer_setAsyncComputeEnabled", ES_RENDER_BIND(renderer_setAsyncComputeEnabled));
    emscripten::function("renderer_getAsyncComputeEnabled", ES_RENDER_BIND(renderer_getAsyncComputeEnabled));
    emscripten::function("renderer_supportsAsyncCompute", ES_RENDER_BIND(renderer_supportsAsyncCompute));
    emscripten::function("renderer_setSkinCache", ES_RENDER_BIND(renderer_setSkinCache));
    emscripten::function("renderer_getSkinCacheStat", ES_RENDER_BIND(renderer_getSkinCacheStat));
    emscripten::function("renderer_getPendingProgramLabels", ES_RENDER_BIND(renderer_getPendingProgramLabels));
    emscripten::function("renderer_getLiveObjects", ES_RENDER_BIND(renderer_getLiveObjects));
    emscripten::function("renderer_getTriangles", ES_RENDER_BIND(renderer_getTriangles));
    emscripten::function("renderer_getSprites", ES_RENDER_BIND(renderer_getSprites));
    emscripten::function("renderer_getSkeletal", ES_RENDER_BIND(renderer_getSkeletal));
    emscripten::function("renderer_getText", ES_RENDER_BIND(renderer_getText));
    emscripten::function("renderer_getMeshes", ES_RENDER_BIND(renderer_getMeshes));
    emscripten::function("renderer_getCulled", ES_RENDER_BIND(renderer_getCulled));
    emscripten::function("renderer_getGpuTimeMs", ES_RENDER_BIND(renderer_getGpuTimeMs));
    emscripten::function("engine_setCpuProfiling", ES_RENDER_BIND(engine_setCpuProfiling));
    emscripten::function("engine_setRandomSeed", ES_RENDER_BIND(engine_setRandomSeed));
    emscripten::function("engine_getCpuScopes", ES_RENDER_BIND(engine_getCpuScopes));
#ifdef ES_ENABLE_TEST_PROBES
    emscripten::function("engine_prewarmMeshVariants", ES_RENDER_BIND(engine_prewarmMeshVariants));
#endif
    emscripten::function("engine_getCounters", ES_RENDER_BIND(engine_getCounters));
    emscripten::function("engine_getGpuScopes", ES_RENDER_BIND(engine_getGpuScopes));
    emscripten::function("renderer_getTextureBytes", ES_RENDER_BIND(renderer_getTextureBytes));
    emscripten::function("renderer_getEstimatedGpuBytes", ES_RENDER_BIND(renderer_getEstimatedGpuBytes));
    emscripten::function("renderer_programEpoch", ES_RENDER_BIND(renderer_programEpoch));
    emscripten::function("renderer_deviceGeneration", ES_RENDER_BIND(renderer_deviceGeneration));
    emscripten::function("engine_prepareMeshPrograms", ES_RENDER_BIND(engine_prepareMeshPrograms));
    emscripten::function("renderer_setClearColor", ES_RENDER_BIND(renderer_setClearColor));
    emscripten::function("renderer_setViewport", ES_RENDER_BIND(renderer_setViewport));
    emscripten::function("renderer_setYSortLayers", ES_RENDER_BIND(renderer_setYSortLayers));
    emscripten::function("renderer_setTreeSortLayers", ES_RENDER_BIND(renderer_setTreeSortLayers));
    emscripten::function("renderer_setDepthLayers", ES_RENDER_BIND(renderer_setDepthLayers));
    emscripten::function("renderer_setQualityBudgets", ES_RENDER_BIND(renderer_setQualityBudgets));
    emscripten::function("renderer_setShadowDistance", ES_RENDER_BIND(renderer_setShadowDistance));
    emscripten::function("renderer_setShadowView", ES_RENDER_BIND(renderer_setShadowView));
    emscripten::function("renderer_setTemporalView", ES_RENDER_BIND(renderer_setTemporalView));
    emscripten::function("renderer_setCollectView", ES_RENDER_BIND(renderer_setCollectView));
    emscripten::function("renderer_beginReplay", ES_RENDER_BIND(renderer_beginReplay));
    emscripten::function("renderer_submitReplay", ES_RENDER_BIND(renderer_submitReplay));
    emscripten::function("renderer_setShadow2DSoftSamples", ES_RENDER_BIND(renderer_setShadow2DSoftSamples));
    emscripten::function("renderer_setQualityValue", ES_RENDER_BIND(renderer_setQualityValue));
    emscripten::function("renderer_setDepthPrepass", ES_RENDER_BIND(renderer_setDepthPrepass));
    emscripten::function("renderer_setProbesPerPixel", ES_RENDER_BIND(renderer_setProbesPerPixel));
    emscripten::function("renderer_getProbeAtlasBytes", ES_RENDER_BIND(renderer_getProbeAtlasBytes));
    emscripten::function("renderer_getProbeDraws", ES_RENDER_BIND(renderer_getProbeDraws));
    emscripten::function("renderer_setLodDistanceScale", ES_RENDER_BIND(renderer_setLodDistanceScale));
    emscripten::function("renderer_setOcclusionGridSize", ES_RENDER_BIND(renderer_setOcclusionGridSize));
    emscripten::function("renderer_setTargetPoolIdleBudget", ES_RENDER_BIND(renderer_setTargetPoolIdleBudget));
    emscripten::function("renderer_setLightingDirect", ES_RENDER_BIND(renderer_setLightingDirect));
    emscripten::function("renderer_setAsyncShaderCompile", ES_RENDER_BIND(renderer_setAsyncShaderCompile));
    emscripten::function("renderer_getPendingShaders", ES_RENDER_BIND(renderer_getPendingShaders));
    emscripten::function("renderer_setPlanarReflectionQuality", ES_RENDER_BIND(renderer_setPlanarReflectionQuality));
    emscripten::function("renderer_setParticleDepthGrid", ES_RENDER_BIND(renderer_setParticleDepthGrid));
    emscripten::function("renderer_setQualityConstants", ES_RENDER_BIND(renderer_setQualityConstants));
    emscripten::function("renderer_getPlanarReflectionStatus", ES_RENDER_BIND(renderer_getPlanarReflectionStatus));
    emscripten::function("renderer_setViewLighting", ES_RENDER_BIND(renderer_setViewLighting));
    emscripten::function("renderer_setCullingMask", ES_RENDER_BIND(renderer_setCullingMask));
    emscripten::function("renderer_setViewId", ES_RENDER_BIND(renderer_setViewId));
    emscripten::function("renderer_setScreenTarget", ES_RENDER_BIND(renderer_setScreenTarget));
    emscripten::function("renderer_lodInspect", ES_RENDER_BIND(renderer_lodInspect));
    emscripten::function("renderer_lodInspectInWorld", ES_RENDER_BIND(renderer_lodInspectInWorld));
    emscripten::function("renderer_clusterInspect", ES_RENDER_BIND(renderer_clusterInspect));
    emscripten::function("renderer_framePending", ES_RENDER_BIND(renderer_framePending));
    emscripten::function("renderer_setLodPreview", ES_RENDER_BIND(renderer_setLodPreview));
    emscripten::function("renderer_setLodPreviewInWorld", ES_RENDER_BIND(renderer_setLodPreviewInWorld));
    emscripten::function("renderer_setImpostorAtlas", ES_RENDER_BIND(renderer_setImpostorAtlas));
    emscripten::function("renderer_takeTextureWants", ES_RENDER_BIND(renderer_takeTextureWants));
    emscripten::function("renderer_setViewShading", ES_RENDER_BIND(renderer_setViewShading));
    emscripten::function("renderer_setViewSelection", ES_RENDER_BIND(renderer_setViewSelection));
    emscripten::function("renderer_setWorldUnitsPerMeter", ES_RENDER_BIND(renderer_setWorldUnitsPerMeter));
    emscripten::function("renderer_requestProbeCapture", ES_RENDER_BIND(renderer_requestProbeCapture));
    emscripten::function("renderer_pollProbeCapture", ES_RENDER_BIND(renderer_pollProbeCapture));
    emscripten::function("renderer_takeProbeCapture", ES_RENDER_BIND(renderer_takeProbeCapture));
    emscripten::function("renderer_setProbeVolumeOverride", ES_RENDER_BIND(renderer_setProbeVolumeOverride));
    emscripten::function("renderer_setProbeVolumeReflection", ES_RENDER_BIND(renderer_setProbeVolumeReflection));
    emscripten::function("renderer_setMeshEdgeBuffers", ES_RENDER_BIND(renderer_setMeshEdgeBuffers));
    emscripten::function("renderer_setViewSkinWeights", ES_RENDER_BIND(renderer_setViewSkinWeights));
    emscripten::function("renderer_lightStatus", ES_RENDER_BIND(renderer_lightStatus));
    emscripten::function("renderer_shadowStatus", ES_RENDER_BIND(renderer_shadowStatus));
    emscripten::function("renderer_setColorSpace", ES_RENDER_BIND(renderer_setColorSpace));


    emscripten::function("registry_getCanvasEntity", &esengine::registry_getCanvasEntity);
    emscripten::function("registry_getCanvasEntities", &esengine::registry_getCanvasEntities);
    emscripten::function("registry_getCameraEntities", &esengine::registry_getCameraEntities);
    emscripten::function("getChildEntities", &esengine::getChildEntities);
    emscripten::function("registry_getGeneration", &esengine::registry_getGeneration);
    emscripten::function("registry_batchSyncPhysicsTransforms", &esengine::registry_batchSyncPhysicsTransforms);
    emscripten::function("registry_readWorldPoses2D", &esengine::registry_readWorldPoses2D);
    emscripten::function("registry_watchEntityChanges", &esengine::registry_watchEntityChanges);
    emscripten::function("registry_unwatchEntityChanges", &esengine::registry_unwatchEntityChanges);
    emscripten::function("registry_entityChangeSequence", &esengine::registry_entityChangeSequence);
    emscripten::function("registry_entityChangeResetEpoch", &esengine::registry_entityChangeResetEpoch);
    emscripten::function("registry_entityChangeResetEpochAddress", emscripten::optional_override([](const esengine::ecs::Registry& registry) -> uintptr_t {
        return reinterpret_cast<uintptr_t>(registry.entityChangeResetEpochAddress());
    }));
    emscripten::function("registry_componentMutationRevision", &esengine::registry_componentMutationRevision);
    emscripten::function("registry_hierarchyRevision", &esengine::registry_hierarchyRevision);
    emscripten::function("registry_readHierarchyMembers", &esengine::registry_readHierarchyMembers);
    emscripten::function("registry_readEntityChanges", &esengine::registry_readEntityChanges);
    emscripten::function("registry_markComponentsChanged", &esengine::registry_markComponentsChanged);

    emscripten::function("gl_enableErrorCheck", ES_RENDER_BIND(gl_enableErrorCheck));
    emscripten::function("gl_checkErrors", ES_RENDER_BIND(gl_checkErrors));
    emscripten::function("renderer_diagnose", ES_RENDER_BIND(renderer_diagnose));

    emscripten::function("renderer_captureNextFrame", ES_RENDER_BIND(renderer_captureNextFrame));
    emscripten::function("renderer_captureFrame", ES_RENDER_BIND(renderer_captureFrame));
    emscripten::function("renderer_captureTarget", ES_RENDER_BIND(renderer_captureTarget));
    emscripten::function("renderer_rainCover", ES_RENDER_BIND(renderer_rainCover));
    emscripten::function("renderer_takeTargetCapture", ES_RENDER_BIND(renderer_takeTargetCapture));
    emscripten::function("renderer_pollFrameCapture", ES_RENDER_BIND(renderer_pollFrameCapture));
    emscripten::function("renderer_takeFrameCapture", ES_RENDER_BIND(renderer_takeFrameCapture));
    emscripten::function("renderer_getCapturedFrameSize", ES_RENDER_BIND(renderer_getCapturedFrameSize));
    emscripten::function("renderer_getCapturedFrameData", ES_RENDER_BIND(renderer_getCapturedFrameData));
    emscripten::function("renderer_getCapturedEntities", ES_RENDER_BIND(renderer_getCapturedEntities));
    emscripten::function("renderer_getCapturedEntityCount", ES_RENDER_BIND(renderer_getCapturedEntityCount));
    emscripten::function("renderer_getCapturedTextures", ES_RENDER_BIND(renderer_getCapturedTextures));
    emscripten::function("renderer_getCapturedTextureCount", ES_RENDER_BIND(renderer_getCapturedTextureCount));
    emscripten::function("renderer_getCapturedPassCount", ES_RENDER_BIND(renderer_getCapturedPassCount));
    emscripten::function("renderer_hasCapturedData", ES_RENDER_BIND(renderer_hasCapturedData));
    emscripten::function("renderer_replayToDrawCall", ES_RENDER_BIND(renderer_replayToDrawCall));
    emscripten::function("renderer_snapshotMatchesCapture", ES_RENDER_BIND(renderer_snapshotMatchesCapture));
    emscripten::function("renderer_pollSnapshotReadback", ES_RENDER_BIND(renderer_pollSnapshotReadback));
    emscripten::function("renderer_getSnapshotPtr", ES_RENDER_BIND(renderer_getSnapshotPtr));
    emscripten::function("renderer_getSnapshotSize", ES_RENDER_BIND(renderer_getSnapshotSize));
    emscripten::function("renderer_getSnapshotWidth", ES_RENDER_BIND(renderer_getSnapshotWidth));
    emscripten::function("renderer_getSnapshotHeight", ES_RENDER_BIND(renderer_getSnapshotHeight));
    emscripten::function("renderer_renderMaterialPreview", ES_RENDER_BIND(renderer_renderMaterialPreview));
    // Skeletal previews. Every one names its handle — there is no current preview
    // and no begin/end pair, so two of them cannot reach each other.
    emscripten::function("renderer_createSkeletalPreview", ES_RENDER_BIND(renderer_createSkeletalPreview));
    emscripten::function("renderer_submitSkeletalPreviewBatch", ES_RENDER_BIND(renderer_submitSkeletalPreviewBatch));
    emscripten::function("renderer_submitSkeletalPreviewBatchEx", ES_RENDER_BIND(renderer_submitSkeletalPreviewBatchEx));
    emscripten::function("renderer_renderSkeletalPreview", ES_RENDER_BIND(renderer_renderSkeletalPreview));
    emscripten::function("renderer_pollSkeletalPreview", ES_RENDER_BIND(renderer_pollSkeletalPreview));
    emscripten::function("renderer_getSkeletalPreviewPtr", ES_RENDER_BIND(renderer_getSkeletalPreviewPtr));
    emscripten::function("renderer_getSkeletalPreviewSize", ES_RENDER_BIND(renderer_getSkeletalPreviewSize));
    emscripten::function("renderer_getSkeletalPreviewWidth", ES_RENDER_BIND(renderer_getSkeletalPreviewWidth));
    emscripten::function("renderer_getSkeletalPreviewHeight", ES_RENDER_BIND(renderer_getSkeletalPreviewHeight));
    emscripten::function("renderer_destroySkeletalPreview", ES_RENDER_BIND(renderer_destroySkeletalPreview));
    emscripten::function("renderer_renderMeshPreview", ES_RENDER_BIND(renderer_renderMeshPreview));
    emscripten::function("renderer_renderMeshSetPreview", ES_RENDER_BIND(renderer_renderMeshSetPreview));
    emscripten::function("renderer_renderRegistryPreview", ES_RENDER_BIND(renderer_renderRegistryPreview));
    emscripten::function("renderer_setPreviewOrbit", ES_RENDER_BIND(renderer_setPreviewOrbit));
    emscripten::function("renderer_pollPreviewReadback", ES_RENDER_BIND(renderer_pollPreviewReadback));
    emscripten::function("renderer_getPreviewPtr", ES_RENDER_BIND(renderer_getPreviewPtr));
    emscripten::function("renderer_getPreviewSize", ES_RENDER_BIND(renderer_getPreviewSize));
    emscripten::function("renderer_getPreviewWidth", ES_RENDER_BIND(renderer_getPreviewWidth));
    emscripten::function("renderer_getPreviewHeight", ES_RENDER_BIND(renderer_getPreviewHeight));
    emscripten::function("renderer_setTextureParams", ES_RENDER_BIND(renderer_setTextureParams));
}

EMSCRIPTEN_BINDINGS(esengine_ui_systems) {
    emscripten::function("uiLayout_update", ES_RENDER_BIND(uiLayout_update));
    emscripten::function("uiHitTest_update", ES_RENDER_BIND(uiHitTest_update));
    emscripten::function("uiHitTest_updateDomains", ES_RENDER_BIND(uiHitTest_updateDomains));
    emscripten::function("uiHitTest_inputsChanged", ES_RENDER_BIND(uiHitTest_inputsChanged));
    emscripten::function("uiHitTest_getHitEntity", ES_RENDER_BIND(uiHitTest_getHitEntity));
    emscripten::function("uiHitTest_getHitEntityInWorld", ES_RENDER_BIND(uiHitTest_getHitEntityInWorld));
    emscripten::function("uiHitTest_pick", ES_RENDER_BIND(uiHitTest_pick));
    emscripten::function("uiHitTest_pickAll", ES_RENDER_BIND(uiHitTest_pickAll));
    emscripten::function("uiHitTest_pickResult", ES_RENDER_BIND(uiHitTest_pickResult));
    emscripten::function("uiHitTest_pickResultInWorld", ES_RENDER_BIND(uiHitTest_pickResultInWorld));
    emscripten::function("uiNode_computedWidth", &esengine::uiNode_computedWidth);
    emscripten::function("uiNode_computedHeight", &esengine::uiNode_computedHeight);
    emscripten::function("uiRenderOrder_update", ES_RENDER_BIND(uiRenderOrder_update));
    emscripten::function("ui_getRenderOrder", ES_RENDER_BIND(ui_getRenderOrder));
    emscripten::function("ui_getCullBit", ES_RENDER_BIND(ui_getCullBit));
    emscripten::function("ui_isScreenDomain", ES_RENDER_BIND(ui_isScreenDomain));
    emscripten::function("getUINodeHiddenInTree", &esengine::getUINodeHiddenInTree);
    emscripten::function("ui_setContentSize", &esengine::ui_setContentSize);
    emscripten::function("getUINodeAlphaInTree", &esengine::getUINodeAlphaInTree);
    emscripten::function("getUINodeComputedWidth", &esengine::getUINodeComputedWidth);
    emscripten::function("getUINodeComputedHeight", &esengine::getUINodeComputedHeight);
    emscripten::function("transform_update", &esengine::transform_update);
    emscripten::function("transform_copyFlatRenderMatrix", &esengine::transform_copyFlatRenderMatrix);

    // Tweens (AnimationBindings.hpp) — the same declarations the native
    // wrappers are generated from.
    emscripten::function("anim_createTween", &esengine::anim_createTween);
    emscripten::function("anim_cancelTween", &esengine::anim_cancelTween);
    emscripten::function("anim_cancelAllTweens", &esengine::anim_cancelAllTweens);
    emscripten::function("anim_pauseTween", &esengine::anim_pauseTween);
    emscripten::function("anim_resumeTween", &esengine::anim_resumeTween);
    emscripten::function("anim_setTweenBezier", &esengine::anim_setTweenBezier);
    emscripten::function("anim_setSequenceNext", &esengine::anim_setSequenceNext);
    emscripten::function("anim_updateTweens", &esengine::anim_updateTweens);
    emscripten::function("anim_getTweenState", &esengine::anim_getTweenState);
}


int main() {
    return 0;
}

