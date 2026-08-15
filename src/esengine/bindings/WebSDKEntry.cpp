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
#include "ResourceManagerBindings.hpp"
#include "RendererBindings.hpp"
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
#include "../text/SdfGenerator.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Velocity.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/RigidBody.hpp"
#include "../ecs/components/Collider.hpp"
#include "../ecs/components/ShapeRenderer.hpp"
#include "../animation/TweenSystem.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#include "../core/Log.hpp"

#include <glm/glm.hpp>
#include <cstdlib>
#include <cstring>
#include <cstddef>
#include <malloc.h>
#include <sstream>

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
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif

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
    // The switch/feature NAMES, so a cook can enumerate the permutations it has
    // to emit a twin for — WGSL resolves them at assembly time (preprocessWGSL),
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
    return g_activeContext->init(static_cast<int>(webglCtx));
}

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

    WGPUDevice raw = emscripten_webgpu_get_device();
    if (!raw) {
        ES_LOG_ERROR("initRendererWebGPU: no Module.preinitializedWebGPUDevice — the host "
                     "must acquire a GPUDevice before instantiating the module");
        return false;
    }
    auto device = makeUnique<WebGPUDevice>(raw);
    // Before the surface is configured, because the usage is fixed there: a host
    // that will ask what was drawn (the editor's viewport capture, a pixel gate)
    // has to say so now.
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

    g_activeContext = &legacyCtx().context();
    return g_activeContext->init(std::move(device));
#else
    (void)canvasSelector; (void)width; (void)height; (void)readback; (void)preferBGRA;
    ES_LOG_ERROR("initRendererWebGPU: this build carries no WebGPU backend (ES_ENABLE_WEBGPU off)");
    return false;
#endif
}

void initRenderer() {
    initRendererInternal("#canvas");
}

bool initRendererWithCanvas(const std::string& canvasSelector) {
    return initRendererInternal(canvasSelector.c_str());
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
    if (g_activeContext) {
        g_activeContext->shutdown();
        g_activeContext = nullptr;
    }
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager;
}

// =============================================================================
// Device Loss
// =============================================================================

namespace {
GfxDevice* activeGfxDevice() {
    return g_activeContext ? g_activeContext->tryGet<GfxDevice>() : nullptr;
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
 * @brief Rebuilds the renderer after a loss; see EstellaContext::recoverDevice.
 * @details Leaves the device Recovering — drawable, but its textures are
 *          placeholders until the asset layer re-uploads and calls
 *          markDeviceRestored.
 */
bool recoverDevice() {
    return g_activeContext ? g_activeContext->recoverDevice() : false;
}

/**
 * @brief Ends recovery, and answers whether it actually ended.
 * @details Routed through the context rather than straight to the device: the
 *          device cannot see the textures still parked on the placeholder, and
 *          the context is the one layer that knows both. Reaching for the
 *          device here is the shorter path that skips the only criterion.
 * @return Textures still awaiting re-upload; 0 means the device is Live.
 */
u32 markDeviceRestored() {
    return g_activeContext ? g_activeContext->finishDeviceRecovery() : 0;
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

// Runtime glyph atlas: convert a Canvas2D-rasterized alpha
// bitmap to a signed distance field. Both buffers are caller-allocated in WASM
// linear memory (TS passes HEAPU8 pointers); `alpha` and `out` are width*height.
void web_sdfFromAlpha(uintptr_t alphaPtr, uintptr_t outPtr, u32 width, u32 height, f32 spread) {
    const u64 pixels = static_cast<u64>(width) * height;
    const u8* alpha = boundarySpan<u8>(alphaPtr, pixels, "sdfFromAlpha.alpha");
    u8* out = boundarySpanMut<u8>(outPtr, pixels, "sdfFromAlpha.out");
    if (!alpha || !out) return;
    text::sdfFromAlpha(alpha, out, width, height, spread);
}

// =============================================================================
// Pointer-based Component Access
// =============================================================================

// NOTE: Per-field component layout offsets are asserted for ALL components in
// WebBindings.generated.cpp (generated by EHT's PtrLayoutGenerator), which is
// the single source of truth for the pointer ABI. Do not hand-maintain
// static_assert(offsetof(...)) here — they drifted and only covered 8 of N
// components.

int getTransformPtr(ecs::Registry& r, u32 e) {
    auto* t = r.tryGet<ecs::Transform>(Entity::fromRaw(e));
    if (!t) return 0;
    t->ensureDecomposed();
    return static_cast<int>(reinterpret_cast<uintptr_t>(t));
}

int getSpritePtr(ecs::Registry& r, u32 e) {
    auto* s = r.tryGet<ecs::Sprite>(Entity::fromRaw(e));
    if (!s) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(s));
}

int getVelocityPtr(ecs::Registry& r, u32 e) {
    auto* v = r.tryGet<ecs::Velocity>(Entity::fromRaw(e));
    if (!v) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(v));
}

int getCameraPtr(ecs::Registry& r, u32 e) {
    auto* c = r.tryGet<ecs::Camera>(Entity::fromRaw(e));
    if (!c) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(c));
}

int getRigidBodyPtr(ecs::Registry& r, u32 e) {
    auto* rb = r.tryGet<ecs::RigidBody>(Entity::fromRaw(e));
    if (!rb) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(rb));
}

int getBoxColliderPtr(ecs::Registry& r, u32 e) {
    auto* bc = r.tryGet<ecs::BoxCollider>(Entity::fromRaw(e));
    if (!bc) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(bc));
}

int getCircleColliderPtr(ecs::Registry& r, u32 e) {
    auto* cc = r.tryGet<ecs::CircleCollider>(Entity::fromRaw(e));
    if (!cc) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(cc));
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_ptr_access) {
    emscripten::function("getTransformPtr", &esengine::getTransformPtr);
    emscripten::function("getSpritePtr", &esengine::getSpritePtr);
    emscripten::function("getVelocityPtr", &esengine::getVelocityPtr);
    emscripten::function("getCameraPtr", &esengine::getCameraPtr);
    emscripten::function("getRigidBodyPtr", &esengine::getRigidBodyPtr);
    emscripten::function("getBoxColliderPtr", &esengine::getBoxColliderPtr);
    emscripten::function("getCircleColliderPtr", &esengine::getCircleColliderPtr);
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
        +[](esengine::EstellaContext* c) { esengine::g_activeContext = c; },
        emscripten::allow_raw_pointers());
}

EMSCRIPTEN_BINDINGS(esengine_renderer) {
    emscripten::function("initRenderer", &esengine::initRenderer);
    emscripten::function("initRendererWithCanvas", &esengine::initRendererWithCanvas);
    emscripten::function("initRendererWithContext", &esengine::initRendererWithContext);
    // Registered in every build variant; without ES_ENABLE_WEBGPU it reports
    // and returns false, so the JS surface never drifts across variants.
    emscripten::function("initRendererWebGPU", &esengine::initRendererWebGPU);
    emscripten::function("shutdownRenderer", &esengine::shutdownRenderer);
    emscripten::function("renderFrame", &esengine::renderFrame);
    emscripten::function("renderFrameWithMatrix", &esengine::renderFrameWithMatrix);
    emscripten::function("getResourceManager", &esengine::getResourceManager, emscripten::allow_raw_pointers());
    emscripten::function("sdfFromAlpha", &esengine::web_sdfFromAlpha);
    emscripten::function("deviceStatus", &esengine::deviceStatus);
    emscripten::function("deviceLostReport", &esengine::deviceLostReport);
    emscripten::function("deviceIdentity", &esengine::deviceIdentity);
    emscripten::function("notifyDeviceLost", &esengine::notifyDeviceLost);
    emscripten::function("recoverDevice", &esengine::recoverDevice);
    emscripten::function("markDeviceRestored", &esengine::markDeviceRestored);

    emscripten::class_<esengine::resource::ResourceManager>("ResourceManager")
        .function("createTexture", &esengine::rm_createTexture)
        .function("createTextureEx", &esengine::rm_createTextureEx)
        .function("createShader", &esengine::rm_createShader)
        .function("supportsCompressedFormat", &esengine::rm_supportsCompressedFormat)
        .function("createCompressedTexture", &esengine::rm_createCompressedTexture)
        .function("registerExternalTexture", &esengine::rm_registerExternalTexture)
        .function("registerExternalTextureSized", &esengine::rm_registerExternalTextureSized)
        .function("retargetExternalTexture", &esengine::rm_retargetExternalTexture)
        .function("texturesAwaitingReupload", &esengine::rm_texturesAwaitingReupload)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("getTextureRefCount", &esengine::rm_getTextureRefCount)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("getShaderRefCount", &esengine::rm_getShaderRefCount)
        .function("getTextureGLId", &esengine::rm_getTextureGLId)
        .function("getTextureDimensions", &esengine::rm_getTextureDimensions)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("updateTextureSubregion", &esengine::rm_updateTextureSubregion)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath)
        .function("setTextureBudget", &esengine::rm_setTextureBudget)
        .function("acquireTextureByPath", &esengine::rm_acquireTextureByPath)
        .function("invalidateTexturePath", &esengine::rm_invalidateTexturePath)
        .function("trimTextureCache", &esengine::rm_trimTextureCache)
        .function("getResourceStats", &esengine::rm_getResourceStats)
#ifdef ES_ENABLE_BITMAP_TEXT
        .function("loadBitmapFont", &esengine::rm_loadBitmapFont)
        .function("createLabelAtlasFont", &esengine::rm_createLabelAtlasFont)
        .function("releaseBitmapFont", &esengine::rm_releaseBitmapFont)
        .function("getBitmapFontRefCount", &esengine::rm_getBitmapFontRefCount)
        .function("measureBitmapText", &esengine::rm_measureBitmapText)
#endif
        ;

#ifdef ES_ENABLE_SPINE
    // Spine renders via the side modules — only the mesh-submit bindings the
    // SDK SpineManager calls remain. Native spine_* / spine_native_* are gone.
    emscripten::function("renderer_submitSpineBatch", &esengine::renderer_submitSpineBatch);
    emscripten::function("renderer_submitSkeletalBatchByEntity", &esengine::renderer_submitSkeletalBatchByEntity);
#endif
    emscripten::function("renderer_submitTextBatch", &esengine::renderer_submitTextBatch);
    emscripten::function("mesh2d_setGeometry", &esengine::mesh2d_setGeometry);

    emscripten::function("material_compileEsshader", &esengine::material_compileEsshader);
    emscripten::function("esshader_cookInfo", &esengine::esshader_cookInfo);
    emscripten::function("es_getMallocBytes", &esengine::es_getMallocBytes);
    emscripten::function("material_define", &esengine::material_define);
    emscripten::function("material_setUniform", &esengine::material_setUniform);
    emscripten::function("material_setTexture", &esengine::material_setTexture);
    emscripten::function("material_undefine", &esengine::material_undefine);

    emscripten::function("draw_begin", &esengine::draw_begin);
    emscripten::function("draw_end", &esengine::draw_end);
    emscripten::function("draw_line", &esengine::draw_line);
    emscripten::function("draw_rect", &esengine::draw_rect);
    emscripten::function("draw_rectOutline", &esengine::draw_rectOutline);
    emscripten::function("draw_circle", &esengine::draw_circle);
    emscripten::function("draw_circleOutline", &esengine::draw_circleOutline);
    emscripten::function("draw_texture", &esengine::draw_texture);
    emscripten::function("draw_textureRotated", &esengine::draw_textureRotated);
    emscripten::function("draw_setLayer", &esengine::draw_setLayer);
    emscripten::function("draw_setDepth", &esengine::draw_setDepth);
    emscripten::function("draw_getDrawCallCount", &esengine::draw_getDrawCallCount);
    emscripten::function("draw_getPrimitiveCount", &esengine::draw_getPrimitiveCount);
    emscripten::function("draw_setBlendMode", &esengine::draw_setBlendMode);
    emscripten::function("draw_setDepthTest", &esengine::draw_setDepthTest);
    emscripten::function("draw_mesh", &esengine::draw_mesh);
    emscripten::function("draw_meshWithUniforms", &esengine::draw_meshWithUniforms);
    emscripten::function("draw_meshWithMaterial", &esengine::draw_meshWithMaterial);

    emscripten::function("geometry_create", &esengine::geometry_create);
    emscripten::function("geometry_init", &esengine::geometry_init);
    emscripten::function("geometry_setIndices16", &esengine::geometry_setIndices16);
    emscripten::function("geometry_setIndices32", &esengine::geometry_setIndices32);
    emscripten::function("geometry_updateVertices", &esengine::geometry_updateVertices);
    emscripten::function("geometry_release", &esengine::geometry_release);
    emscripten::function("geometry_isValid", &esengine::geometry_isValid);

#ifdef ES_ENABLE_POSTPROCESS
    emscripten::function("postprocess_init", &esengine::postprocess_init);
    emscripten::function("postprocess_shutdown", &esengine::postprocess_shutdown);
    emscripten::function("postprocess_resize", &esengine::postprocess_resize);
    emscripten::function("postprocess_addPass", &esengine::postprocess_addPass);
    emscripten::function("postprocess_removePass", &esengine::postprocess_removePass);
    emscripten::function("postprocess_setPassEnabled", &esengine::postprocess_setPassEnabled);
    emscripten::function("postprocess_isPassEnabled", &esengine::postprocess_isPassEnabled);
    emscripten::function("postprocess_setUniformFloat", &esengine::postprocess_setUniformFloat);
    emscripten::function("postprocess_setUniformVec4", &esengine::postprocess_setUniformVec4);
    emscripten::function("postprocess_setPassTexture", &esengine::postprocess_setPassTexture);
    emscripten::function("postprocess_begin", &esengine::postprocess_begin);
    emscripten::function("postprocess_end", &esengine::postprocess_end);
    emscripten::function("postprocess_getPassCount", &esengine::postprocess_getPassCount);
    emscripten::function("postprocess_isInitialized", &esengine::postprocess_isInitialized);
    emscripten::function("postprocess_setBypass", &esengine::postprocess_setBypass);
    emscripten::function("postprocess_isBypassed", &esengine::postprocess_isBypassed);
    emscripten::function("postprocess_clearPasses", &esengine::postprocess_clearPasses);
    emscripten::function("postprocess_setOutputTarget", &esengine::postprocess_setOutputTarget);
    emscripten::function("postprocess_setOutputViewport", &esengine::postprocess_setOutputViewport);
    emscripten::function("postprocess_beginScreenCapture", &esengine::postprocess_beginScreenCapture);
    emscripten::function("postprocess_endScreenCapture", &esengine::postprocess_endScreenCapture);
    emscripten::function("postprocess_executeScreenPasses", &esengine::postprocess_executeScreenPasses);
    emscripten::function("postprocess_addScreenPass", &esengine::postprocess_addScreenPass);
    emscripten::function("postprocess_clearScreenPasses", &esengine::postprocess_clearScreenPasses);
    emscripten::function("postprocess_setScreenUniformFloat", &esengine::postprocess_setScreenUniformFloat);
    emscripten::function("postprocess_setScreenUniformVec4", &esengine::postprocess_setScreenUniformVec4);
#endif

#ifdef ES_ENABLE_TILEMAP
    // Tilemaps registered here with every other binding, from the same
    // TilemapBindings.hpp declarations the native wrappers are generated from.
    emscripten::function("tilemap_initLayer", &esengine::tilemap_initLayer);
    emscripten::function("tilemap_initInfinite", &esengine::tilemap_initInfinite);
    emscripten::function("tilemap_destroyLayer", &esengine::tilemap_destroyLayer);
    emscripten::function("tilemap_setTile", &esengine::tilemap_setTile);
    emscripten::function("tilemap_getTile", &esengine::tilemap_getTile);
    emscripten::function("tilemap_fillRect", &esengine::tilemap_fillRect);
    emscripten::function("tilemap_setTiles", &esengine::tilemap_setTiles);
    emscripten::function("tilemap_setTilesets", &esengine::tilemap_setTilesets);
    emscripten::function("tilemap_hasLayer", &esengine::tilemap_hasLayer);
    emscripten::function("tilemap_setRenderProps", &esengine::tilemap_setRenderProps);
    emscripten::function("tilemap_setTint", &esengine::tilemap_setTint);
    emscripten::function("tilemap_setVisible", &esengine::tilemap_setVisible);
    emscripten::function("tilemap_setOriginEntity", &esengine::tilemap_setOriginEntity);
    emscripten::function("tilemap_exportChunks", &esengine::tilemap_exportChunks);
    emscripten::function("tilemap_importChunks", &esengine::tilemap_importChunks);
    emscripten::function("tilemap_initInfiniteLayer", &esengine::tilemap_initInfiniteLayer);
    emscripten::function("tilemap_setChunkTiles", &esengine::tilemap_setChunkTiles);
    emscripten::function("tilemap_setTileAnimation", &esengine::tilemap_setTileAnimation);
    emscripten::function("tilemap_clearTileAnimations", &esengine::tilemap_clearTileAnimations);
    emscripten::function("tilemap_advanceAnimations", &esengine::tilemap_advanceAnimations);
    emscripten::function("tilemap_setTileProperty", &esengine::tilemap_setTileProperty);
    emscripten::function("tilemap_getTileProperty", &esengine::tilemap_getTileProperty);
    emscripten::function("tilemap_flipTile", &esengine::tilemap_flipTile);
    emscripten::function("tilemap_rotateTile", &esengine::tilemap_rotateTile);
    emscripten::function("tilemap_setGridType", &esengine::tilemap_setGridType);
    emscripten::function("tilemap_setHexParams", &esengine::tilemap_setHexParams);
    emscripten::function("tilemap_tileToWorld", &esengine::tilemap_tileToWorld);
    emscripten::function("tilemap_worldToTile", &esengine::tilemap_worldToTile);
#endif

    emscripten::function("renderer_init", &esengine::renderer_init);
    emscripten::function("renderer_resize", &esengine::renderer_resize);
    emscripten::function("renderer_beginFrame", &esengine::renderer_beginFrame);
    emscripten::function("renderer_begin", &esengine::renderer_begin);
    emscripten::function("renderer_flush", &esengine::renderer_flush);
    emscripten::function("renderer_end", &esengine::renderer_end);
    emscripten::function("renderer_submitSprites", &esengine::renderer_submitSprites);
    emscripten::function("renderer_submitUIElements", &esengine::renderer_submitUIElements);
#ifdef ES_ENABLE_BITMAP_TEXT
    emscripten::function("renderer_submitBitmapText", &esengine::renderer_submitBitmapText);
#endif
    emscripten::function("renderer_submitShapes", &esengine::renderer_submitShapes);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_submitSpine", &esengine::renderer_submitSpine);
#endif
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("renderer_submitParticles", &esengine::renderer_submitParticles);
#endif
    emscripten::function("renderer_updateTransforms", &esengine::renderer_updateTransforms);
    emscripten::function("renderer_setEntityDrawOrder", &esengine::renderer_setEntityDrawOrder);
    emscripten::function("renderer_submitAll", &esengine::renderer_submitAll);
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("particle_update", &esengine::particle_update);
    emscripten::function("particle_play", &esengine::particle_play);
    emscripten::function("particle_stop", &esengine::particle_stop);
    emscripten::function("particle_reset", &esengine::particle_reset);
    emscripten::function("particle_getAliveCount", &esengine::particle_getAliveCount);
    emscripten::function("particle_set_color_lut", &esengine::particle_set_color_lut);
    emscripten::function("particle_set_size_lut", &esengine::particle_set_size_lut);
#endif
    emscripten::function("trail_update", &esengine::trail_update);
    emscripten::function("trail_clear", &esengine::trail_clear);
    emscripten::function("renderer_setStage", &esengine::renderer_setStage);
    emscripten::function("renderer_createTarget", &esengine::renderer_createTarget);
    emscripten::function("renderer_releaseTarget", &esengine::renderer_releaseTarget);
    emscripten::function("renderer_getTargetTexture", &esengine::renderer_getTargetTexture);
    emscripten::function("renderer_getTargetDepthTexture", &esengine::renderer_getTargetDepthTexture);
    emscripten::function("renderer_getDrawCalls", &esengine::renderer_getDrawCalls);
    emscripten::function("renderer_getLiveObjects", &esengine::renderer_getLiveObjects);
    emscripten::function("renderer_getTriangles", &esengine::renderer_getTriangles);
    emscripten::function("renderer_getSprites", &esengine::renderer_getSprites);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_getSpine", &esengine::renderer_getSpine);
#endif
    emscripten::function("renderer_getText", &esengine::renderer_getText);
    emscripten::function("renderer_getMeshes", &esengine::renderer_getMeshes);
    emscripten::function("renderer_getCulled", &esengine::renderer_getCulled);
    emscripten::function("renderer_getGpuTimeMs", &esengine::renderer_getGpuTimeMs);
    emscripten::function("engine_setCpuProfiling", &esengine::engine_setCpuProfiling);
    emscripten::function("engine_setRandomSeed", &esengine::engine_setRandomSeed);
    emscripten::function("engine_getCpuScopes", &esengine::engine_getCpuScopes);
    emscripten::function("engine_getCounters", &esengine::engine_getCounters);
    emscripten::function("engine_getGpuScopes", &esengine::engine_getGpuScopes);
    emscripten::function("renderer_getTextureBytes", &esengine::renderer_getTextureBytes);
    emscripten::function("renderer_setClearColor", &esengine::renderer_setClearColor);
    emscripten::function("renderer_setViewport", &esengine::renderer_setViewport);
    emscripten::function("renderer_setYSortLayers", &esengine::renderer_setYSortLayers);
    emscripten::function("renderer_setDepthLayers", &esengine::renderer_setDepthLayers);
    emscripten::function("renderer_setCullingMask", &esengine::renderer_setCullingMask);
    emscripten::function("renderer_setColorSpace", &esengine::renderer_setColorSpace);
    emscripten::function("renderer_setEntityClipRect", &esengine::renderer_setEntityClipRect);
    emscripten::function("renderer_clearEntityClipRect", &esengine::renderer_clearEntityClipRect);
    emscripten::function("renderer_clearAllClipRects", &esengine::renderer_clearAllClipRects);

    emscripten::function("renderer_setEntityStencilMask", &esengine::renderer_setEntityStencilMask);
    emscripten::function("renderer_setEntityStencilTest", &esengine::renderer_setEntityStencilTest);
    emscripten::function("renderer_clearEntityStencilMask", &esengine::renderer_clearEntityStencilMask);
    emscripten::function("renderer_clearAllStencilMasks", &esengine::renderer_clearAllStencilMasks);

    emscripten::function("registry_getCanvasEntity", &esengine::registry_getCanvasEntity);
    emscripten::function("registry_getCanvasEntities", &esengine::registry_getCanvasEntities);
    emscripten::function("registry_getCameraEntities", &esengine::registry_getCameraEntities);
    emscripten::function("getChildEntities", &esengine::getChildEntities);
    emscripten::function("registry_getGeneration", &esengine::registry_getGeneration);
    emscripten::function("registry_batchSyncPhysicsTransforms", &esengine::registry_batchSyncPhysicsTransforms);

    emscripten::function("gl_enableErrorCheck", &esengine::gl_enableErrorCheck);
    emscripten::function("gl_checkErrors", &esengine::gl_checkErrors);
    emscripten::function("renderer_diagnose", &esengine::renderer_diagnose);

    emscripten::function("renderer_captureNextFrame", &esengine::renderer_captureNextFrame);
    emscripten::function("renderer_captureFrame", &esengine::renderer_captureFrame);
    emscripten::function("renderer_pollFrameCapture", &esengine::renderer_pollFrameCapture);
    emscripten::function("renderer_takeFrameCapture", &esengine::renderer_takeFrameCapture);
    emscripten::function("renderer_getCapturedFrameSize", &esengine::renderer_getCapturedFrameSize);
    emscripten::function("renderer_getCapturedFrameData", &esengine::renderer_getCapturedFrameData);
    emscripten::function("renderer_getCapturedEntities", &esengine::renderer_getCapturedEntities);
    emscripten::function("renderer_getCapturedEntityCount", &esengine::renderer_getCapturedEntityCount);
    emscripten::function("renderer_getCapturedCameraCount", &esengine::renderer_getCapturedCameraCount);
    emscripten::function("renderer_hasCapturedData", &esengine::renderer_hasCapturedData);
    emscripten::function("renderer_replayToDrawCall", &esengine::renderer_replayToDrawCall);
    emscripten::function("renderer_pollSnapshotReadback", &esengine::renderer_pollSnapshotReadback);
    emscripten::function("renderer_getSnapshotPtr", &esengine::renderer_getSnapshotPtr);
    emscripten::function("renderer_getSnapshotSize", &esengine::renderer_getSnapshotSize);
    emscripten::function("renderer_getSnapshotWidth", &esengine::renderer_getSnapshotWidth);
    emscripten::function("renderer_getSnapshotHeight", &esengine::renderer_getSnapshotHeight);
    emscripten::function("renderer_renderMaterialPreview", &esengine::renderer_renderMaterialPreview);
    emscripten::function("renderer_pollPreviewReadback", &esengine::renderer_pollPreviewReadback);
    emscripten::function("renderer_getPreviewPtr", &esengine::renderer_getPreviewPtr);
    emscripten::function("renderer_getPreviewSize", &esengine::renderer_getPreviewSize);
    emscripten::function("renderer_getPreviewWidth", &esengine::renderer_getPreviewWidth);
    emscripten::function("renderer_getPreviewHeight", &esengine::renderer_getPreviewHeight);
    emscripten::function("renderer_setTextureParams", &esengine::renderer_setTextureParams);
}

EMSCRIPTEN_BINDINGS(esengine_ui_systems) {
    emscripten::function("uiLayout_update", &esengine::uiLayout_update);
    emscripten::function("uiHitTest_update", &esengine::uiHitTest_update);
    emscripten::function("uiHitTest_getHitEntity", &esengine::uiHitTest_getHitEntity);
    emscripten::function("uiHitTest_getHitEntityPrev", &esengine::uiHitTest_getHitEntityPrev);
    emscripten::function("uiHitTest_pick", &esengine::uiHitTest_pick);
    emscripten::function("uiHitTest_pickAll", &esengine::uiHitTest_pickAll);
    emscripten::function("uiHitTest_pickResult", &esengine::uiHitTest_pickResult);
    emscripten::function("uiNode_computedWidth", &esengine::uiNode_computedWidth);
    emscripten::function("uiNode_computedHeight", &esengine::uiNode_computedHeight);
    emscripten::function("uiRenderOrder_update", &esengine::uiRenderOrder_update);
    emscripten::function("ui_getRenderOrder", &esengine::ui_getRenderOrder);
    emscripten::function("ui_getCullBit", &esengine::ui_getCullBit);
    emscripten::function("getUINodeHiddenInTree", &esengine::getUINodeHiddenInTree);
    emscripten::function("getUINodeAlphaInTree", &esengine::getUINodeAlphaInTree);
    emscripten::function("getUINodePointerBlockedInTree", &esengine::getUINodePointerBlockedInTree);
    emscripten::function("getUINodeComputedWidth", &esengine::getUINodeComputedWidth);
    emscripten::function("getUINodeComputedHeight", &esengine::getUINodeComputedHeight);
    emscripten::function("transform_update", &esengine::transform_update);
    emscripten::function("transform_patchPosition", &esengine::transform_patchPosition);

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

