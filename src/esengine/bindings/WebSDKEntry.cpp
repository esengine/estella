/**
 * @file    WebSDKEntry.cpp
 * @brief   ESEngine Web SDK entry point with rendering support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#ifdef ES_PLATFORM_WEB

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>

#include "EngineContext.hpp"
#include "ActiveContext.hpp"
#include "ResourceManagerBindings.hpp"
#include "RendererBindings.hpp"
#include "ImmediateDrawBindings.hpp"
#include "GeometryBindings.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessBindings.hpp"
#endif

#include "../ecs/UILayoutSystem.hpp"
#include "../ecs/UIHitTestSystem.hpp"
#include "../ecs/UIRenderOrderSystem.hpp"
#include "../ecs/UIFlexLayoutSystem.hpp"

#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/GfxDevice.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Velocity.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/RigidBody.hpp"
#include "../ecs/components/Collider.hpp"
#include "../ecs/components/ShapeRenderer.hpp"
#include "../animation/TweenSystem.hpp"
#ifdef ES_ENABLE_TIMELINE
#include "../animation/TimelineSystem.hpp"
#endif
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#include "../core/Log.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <glm/glm.hpp>
#include <cstring>
#include <cstddef>

static_assert(sizeof(void*) == 4, "EM_JS pointer passing assumes wasm32 (4-byte pointers)");

namespace esengine {

static EngineContext& legacyCtx() { return EngineContext::instance(); }
static EstellaContext& ctx() { return activeCtx(); }

#define g_initialized (ctx().state().initialized)
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#ifdef ES_ENABLE_SPINE
#define g_spineResourceManager (ctx().tryGet<spine::SpineResourceManager>())
#endif
#define g_renderContext (ctx().tryGet<RenderContext>())
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif

EM_JS(void, callMaterialProvider, (int materialId, int outShaderIdPtr, int outBlendModePtr, int outUniformBufPtr, int outUniformCountPtr), {
    var fn = Module['materialDataProvider'];
    if (fn) {
        fn(materialId, outShaderIdPtr, outBlendModePtr, outUniformBufPtr, outUniformCountPtr);
    } else {
        HEAPU32[outShaderIdPtr >> 2] = 0;
        HEAPU32[outBlendModePtr >> 2] = 0;
        HEAPU32[outUniformBufPtr >> 2] = 0;
        HEAPU32[outUniformCountPtr >> 2] = 0;
    }
});

void clearMaterialCache() { ctx().state().material_cache.clear(); }

void invalidateMaterialCache(u32 materialId) {
    ctx().state().material_cache.invalidate(materialId);
}

bool getMaterialData(u32 materialId, u32& shaderId, u32& blendMode) {
    if (materialId == 0) {
        return false;
    }
    u32 uniformBufferPtr = 0;
    u32 uniformCount = 0;
    auto toPtr = [](auto* p) { return static_cast<int>(reinterpret_cast<uintptr_t>(p)); };
    callMaterialProvider(materialId,
        toPtr(&shaderId),
        toPtr(&blendMode),
        toPtr(&uniformBufferPtr),
        toPtr(&uniformCount));
    return shaderId != 0;
}

bool getMaterialDataWithUniforms(u32 materialId, u32& shaderId, u32& blendMode,
                                  std::vector<MaterialUniformData>& uniforms) {
    if (materialId == 0) {
        return false;
    }

    auto& cache = ctx().state().material_cache;
    const auto* cached = cache.find(materialId);
    if (cached) {
        shaderId = cached->shaderId;
        blendMode = cached->blendMode;
        uniforms = cached->uniforms;
        return shaderId != 0;
    }

    u32 uniformBufferPtr = 0;
    u32 uniformCount = 0;
    auto toPtr = [](auto* p) { return static_cast<int>(reinterpret_cast<uintptr_t>(p)); };
    callMaterialProvider(materialId,
        toPtr(&shaderId),
        toPtr(&blendMode),
        toPtr(&uniformBufferPtr),
        toPtr(&uniformCount));

    if (shaderId == 0) {
        cache.store(materialId, {});
        return false;
    }

    constexpr u32 MAX_UNIFORMS = 64;
    if (uniformCount > MAX_UNIFORMS) {
        ES_LOG_ERROR("Material {} has {} uniforms (max {}), clamping",
                     materialId, uniformCount, MAX_UNIFORMS);
        uniformCount = MAX_UNIFORMS;
    }

    if (uniformCount > 0 && uniformBufferPtr != 0) {
        const u8* ptr = reinterpret_cast<const u8*>(uniformBufferPtr);
        constexpr usize MAX_BUFFER_SIZE = MAX_UNIFORMS * (4 + 256 + 4 + 16);
        const u8* bufferEnd = ptr + MAX_BUFFER_SIZE;

        for (u32 i = 0; i < uniformCount; ++i) {
            if (ptr + 4 > bufferEnd) break;
            u32 nameLen = *reinterpret_cast<const u32*>(ptr);
            ptr += 4;

            if (nameLen > 256) break;
            usize alignedNameLen = ((nameLen + 3) / 4) * 4;
            if (ptr + alignedNameLen > bufferEnd) break;

            MaterialUniformData ud;
            usize copyLen = std::min<usize>(nameLen, 31);
            std::memcpy(ud.name, reinterpret_cast<const char*>(ptr), copyLen);
            ud.name[copyLen] = '\0';
            ptr += alignedNameLen;

            if (ptr + 4 > bufferEnd) break;
            ud.type = *reinterpret_cast<const u32*>(ptr);
            ptr += 4;

            if (ptr + 16 > bufferEnd) break;
            std::memcpy(ud.values, ptr, 16);
            ptr += 16;

            uniforms.push_back(ud);
        }
    }

    cache.store(materialId, { shaderId, blendMode, uniforms });
    return true;
}

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
    g_activeContext = &legacyCtx().context();
    return g_activeContext->init(static_cast<int>(webglCtx));
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
// Pointer-based Component Access
// =============================================================================

static_assert(offsetof(ecs::Transform, position) == 0);
static_assert(offsetof(ecs::Transform, rotation) == 12);
static_assert(offsetof(ecs::Transform, scale) == 28);
static_assert(offsetof(ecs::Transform, worldPosition) == 40);
static_assert(offsetof(ecs::Transform, worldRotation) == 52);
static_assert(offsetof(ecs::Transform, worldScale) == 68);

static_assert(offsetof(ecs::Sprite, texture) == 0);
static_assert(offsetof(ecs::Sprite, color) == 4);
static_assert(offsetof(ecs::Sprite, size) == 20);
static_assert(offsetof(ecs::Sprite, pivot) == 28);
static_assert(offsetof(ecs::Sprite, uvOffset) == 36);
static_assert(offsetof(ecs::Sprite, uvScale) == 44);
static_assert(offsetof(ecs::Sprite, layer) == 52);
static_assert(offsetof(ecs::Sprite, flipX) == 56);
static_assert(offsetof(ecs::Sprite, flipY) == 57);
static_assert(offsetof(ecs::Sprite, tileSize) == 60);
static_assert(offsetof(ecs::Sprite, tileSpacing) == 68);
static_assert(offsetof(ecs::Sprite, material) == 76);
static_assert(offsetof(ecs::Sprite, enabled) == 80);

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

// Velocity: 2x vec3 = 24 bytes pure float
static_assert(offsetof(ecs::Velocity, linear) == 0);
static_assert(offsetof(ecs::Velocity, angular) == 12);

int getVelocityPtr(ecs::Registry& r, u32 e) {
    auto* v = r.tryGet<ecs::Velocity>(Entity::fromRaw(e));
    if (!v) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(v));
}

// Camera: enum u8 + padding + floats + bool + i32
static_assert(offsetof(ecs::Camera, projectionType) == 0);
static_assert(offsetof(ecs::Camera, fov) == 4);
static_assert(offsetof(ecs::Camera, orthoSize) == 8);
static_assert(offsetof(ecs::Camera, nearPlane) == 12);
static_assert(offsetof(ecs::Camera, farPlane) == 16);
static_assert(offsetof(ecs::Camera, aspectRatio) == 20);
static_assert(offsetof(ecs::Camera, isActive) == 24);
static_assert(offsetof(ecs::Camera, priority) == 28);
static_assert(offsetof(ecs::Camera, viewportX) == 32);
static_assert(offsetof(ecs::Camera, viewportY) == 36);
static_assert(offsetof(ecs::Camera, viewportW) == 40);
static_assert(offsetof(ecs::Camera, viewportH) == 44);
static_assert(offsetof(ecs::Camera, clearFlags) == 48);

int getCameraPtr(ecs::Registry& r, u32 e) {
    auto* c = r.tryGet<ecs::Camera>(Entity::fromRaw(e));
    if (!c) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(c));
}

// UIRect: 6x vec2 (48 bytes) + computed fields
static_assert(offsetof(ecs::UIRect, anchorMin) == 0);
static_assert(offsetof(ecs::UIRect, anchorMax) == 8);
static_assert(offsetof(ecs::UIRect, offsetMin) == 16);
static_assert(offsetof(ecs::UIRect, offsetMax) == 24);
static_assert(offsetof(ecs::UIRect, size) == 32);
static_assert(offsetof(ecs::UIRect, pivot) == 40);
static_assert(offsetof(ecs::UIRect, computed_size_) == 48);

int getUIRectPtr(ecs::Registry& r, u32 e) {
    auto* rect = r.tryGet<ecs::UIRect>(Entity::fromRaw(e));
    if (!rect) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(rect));
}

// RigidBody: enum u8 + padding + floats + bools
static_assert(offsetof(ecs::RigidBody, bodyType) == 0);
static_assert(offsetof(ecs::RigidBody, gravityScale) == 4);
static_assert(offsetof(ecs::RigidBody, linearDamping) == 8);
static_assert(offsetof(ecs::RigidBody, angularDamping) == 12);
static_assert(offsetof(ecs::RigidBody, fixedRotation) == 16);
static_assert(offsetof(ecs::RigidBody, bullet) == 17);
static_assert(offsetof(ecs::RigidBody, enabled) == 18);

int getRigidBodyPtr(ecs::Registry& r, u32 e) {
    auto* rb = r.tryGet<ecs::RigidBody>(Entity::fromRaw(e));
    if (!rb) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(rb));
}

// BoxCollider: vec2 + vec2 + floats + bools + u32s
static_assert(offsetof(ecs::BoxCollider, halfExtents) == 0);
static_assert(offsetof(ecs::BoxCollider, offset) == 8);
static_assert(offsetof(ecs::BoxCollider, density) == 16);
static_assert(offsetof(ecs::BoxCollider, friction) == 20);
static_assert(offsetof(ecs::BoxCollider, restitution) == 24);
static_assert(offsetof(ecs::BoxCollider, isSensor) == 28);
static_assert(offsetof(ecs::BoxCollider, enabled) == 29);
static_assert(offsetof(ecs::BoxCollider, categoryBits) == 32);
static_assert(offsetof(ecs::BoxCollider, maskBits) == 36);

int getBoxColliderPtr(ecs::Registry& r, u32 e) {
    auto* bc = r.tryGet<ecs::BoxCollider>(Entity::fromRaw(e));
    if (!bc) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(bc));
}

// CircleCollider: f32 + vec2 + floats + bools + u32s
static_assert(offsetof(ecs::CircleCollider, radius) == 0);
static_assert(offsetof(ecs::CircleCollider, offset) == 4);
static_assert(offsetof(ecs::CircleCollider, density) == 12);
static_assert(offsetof(ecs::CircleCollider, friction) == 16);
static_assert(offsetof(ecs::CircleCollider, restitution) == 20);
static_assert(offsetof(ecs::CircleCollider, isSensor) == 24);
static_assert(offsetof(ecs::CircleCollider, enabled) == 25);
static_assert(offsetof(ecs::CircleCollider, categoryBits) == 28);
static_assert(offsetof(ecs::CircleCollider, maskBits) == 32);

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
    emscripten::function("getUIRectPtr", &esengine::getUIRectPtr);
    emscripten::function("getRigidBodyPtr", &esengine::getRigidBodyPtr);
    emscripten::function("getBoxColliderPtr", &esengine::getBoxColliderPtr);
    emscripten::function("getCircleColliderPtr", &esengine::getCircleColliderPtr);
}

EMSCRIPTEN_BINDINGS(esengine_renderer) {
    emscripten::function("initRenderer", &esengine::initRenderer);
    emscripten::function("initRendererWithCanvas", &esengine::initRendererWithCanvas);
    emscripten::function("initRendererWithContext", &esengine::initRendererWithContext);
    emscripten::function("shutdownRenderer", &esengine::shutdownRenderer);
    emscripten::function("renderFrame", &esengine::renderFrame);
    emscripten::function("renderFrameWithMatrix", &esengine::renderFrameWithMatrix);
    emscripten::function("getResourceManager", &esengine::getResourceManager, emscripten::allow_raw_pointers());

    emscripten::class_<esengine::resource::ResourceManager>("ResourceManager")
        .function("createTexture", &esengine::rm_createTexture)
        .function("createTextureEx", &esengine::rm_createTextureEx)
        .function("createShader", &esengine::rm_createShader)
        .function("registerExternalTexture", &esengine::rm_registerExternalTexture)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("getTextureRefCount", &esengine::rm_getTextureRefCount)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("getShaderRefCount", &esengine::rm_getShaderRefCount)
        .function("getTextureGLId", &esengine::rm_getTextureGLId)
        .function("getTextureDimensions", &esengine::rm_getTextureDimensions)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath)
#ifdef ES_ENABLE_BITMAP_TEXT
        .function("loadBitmapFont", &esengine::rm_loadBitmapFont)
        .function("createLabelAtlasFont", &esengine::rm_createLabelAtlasFont)
        .function("releaseBitmapFont", &esengine::rm_releaseBitmapFont)
        .function("getBitmapFontRefCount", &esengine::rm_getBitmapFontRefCount)
        .function("measureBitmapText", &esengine::rm_measureBitmapText)
#endif
        ;

#ifdef ES_ENABLE_SPINE
    emscripten::value_object<esengine::SpineBounds>("SpineBounds")
        .field("x", &esengine::SpineBounds::x)
        .field("y", &esengine::SpineBounds::y)
        .field("width", &esengine::SpineBounds::width)
        .field("height", &esengine::SpineBounds::height)
        .field("valid", &esengine::SpineBounds::valid);

    emscripten::function("getSpineBounds", &esengine::getSpineBounds);

    emscripten::function("spine_update", &esengine::spine_update);
    emscripten::function("spine_play", &esengine::spine_play);
    emscripten::function("spine_addAnimation", &esengine::spine_addAnimation);
    emscripten::function("spine_setSkin", &esengine::spine_setSkin);
    emscripten::function("spine_getBonePosition", &esengine::spine_getBonePosition);
    emscripten::function("spine_hasInstance", &esengine::spine_hasInstance);
    emscripten::function("spine_reloadAssets", &esengine::spine_reloadAssets);
    emscripten::function("spine_getAnimations", &esengine::spine_getAnimations);
    emscripten::function("spine_getSkins", &esengine::spine_getSkins);
    emscripten::function("renderer_submitSpineBatch", &esengine::renderer_submitSpineBatch);
    emscripten::function("renderer_submitSpineBatchByEntity", &esengine::renderer_submitSpineBatchByEntity);
    emscripten::function("spine_setNeedsReload", &esengine::spine_setNeedsReload);
    emscripten::function("spine_native_getEventCount", &esengine::spine_native_getEventCount);
    emscripten::function("spine_native_getEventBuffer", &esengine::spine_native_getEventBuffer);
    emscripten::function("spine_native_getEventRecord", &esengine::spine_native_getEventRecord);
    emscripten::function("spine_native_clearEvents", &esengine::spine_native_clearEvents);
    emscripten::function("spine_native_listConstraints", &esengine::spine_native_listConstraints);
    emscripten::function("spine_native_getTransformConstraintMix", &esengine::spine_native_getTransformConstraintMix);
    emscripten::function("spine_native_setTransformConstraintMix", &esengine::spine_native_setTransformConstraintMix);
    emscripten::function("spine_native_getPathConstraintMix", &esengine::spine_native_getPathConstraintMix);
    emscripten::function("spine_native_setPathConstraintMix", &esengine::spine_native_setPathConstraintMix);
#endif

    emscripten::function("invalidateMaterialCache", &esengine::invalidateMaterialCache);
    emscripten::function("clearMaterialCache", &esengine::clearMaterialCache);

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
    emscripten::function("renderer_submitAll", &esengine::renderer_submitAll);
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("particle_update", &esengine::particle_update);
    emscripten::function("particle_play", &esengine::particle_play);
    emscripten::function("particle_stop", &esengine::particle_stop);
    emscripten::function("particle_reset", &esengine::particle_reset);
    emscripten::function("particle_getAliveCount", &esengine::particle_getAliveCount);
#endif
    emscripten::function("renderer_setStage", &esengine::renderer_setStage);
    emscripten::function("renderer_createTarget", &esengine::renderer_createTarget);
    emscripten::function("renderer_releaseTarget", &esengine::renderer_releaseTarget);
    emscripten::function("renderer_getTargetTexture", &esengine::renderer_getTargetTexture);
    emscripten::function("renderer_getTargetDepthTexture", &esengine::renderer_getTargetDepthTexture);
    emscripten::function("renderer_getDrawCalls", &esengine::renderer_getDrawCalls);
    emscripten::function("renderer_getTriangles", &esengine::renderer_getTriangles);
    emscripten::function("renderer_getSprites", &esengine::renderer_getSprites);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_getSpine", &esengine::renderer_getSpine);
#endif
    emscripten::function("renderer_getText", &esengine::renderer_getText);
    emscripten::function("renderer_getMeshes", &esengine::renderer_getMeshes);
    emscripten::function("renderer_getCulled", &esengine::renderer_getCulled);
    emscripten::function("renderer_setDeltaTime", &esengine::renderer_setDeltaTime);
    emscripten::function("renderer_setClearColor", &esengine::renderer_setClearColor);
    emscripten::function("renderer_setViewport", &esengine::renderer_setViewport);
    emscripten::function("renderer_setScissor", &esengine::renderer_setScissor);
    emscripten::function("renderer_clearBuffers", &esengine::renderer_clearBuffers);
    emscripten::function("renderer_setEntityClipRect", &esengine::renderer_setEntityClipRect);
    emscripten::function("renderer_clearEntityClipRect", &esengine::renderer_clearEntityClipRect);
    emscripten::function("renderer_clearAllClipRects", &esengine::renderer_clearAllClipRects);

    emscripten::function("renderer_clearStencil", &esengine::renderer_clearStencil);
    emscripten::function("renderer_setEntityStencilMask", &esengine::renderer_setEntityStencilMask);
    emscripten::function("renderer_setEntityStencilTest", &esengine::renderer_setEntityStencilTest);
    emscripten::function("renderer_clearEntityStencilMask", &esengine::renderer_clearEntityStencilMask);
    emscripten::function("renderer_clearAllStencilMasks", &esengine::renderer_clearAllStencilMasks);

    emscripten::function("registry_getCanvasEntity", &esengine::registry_getCanvasEntity);
    emscripten::function("registry_getCameraEntities", &esengine::registry_getCameraEntities);
    emscripten::function("getChildEntities", &esengine::getChildEntities);
    emscripten::function("registry_getGeneration", &esengine::registry_getGeneration);
    emscripten::function("registry_getSchemaPoolVersion", &esengine::registry_getSchemaPoolVersion);
    emscripten::function("registry_batchSyncPhysicsTransforms", &esengine::registry_batchSyncPhysicsTransforms);

    emscripten::function("gl_enableErrorCheck", &esengine::gl_enableErrorCheck);
    emscripten::function("gl_checkErrors", &esengine::gl_checkErrors);
    emscripten::function("renderer_diagnose", &esengine::renderer_diagnose);

    emscripten::function("renderer_captureNextFrame", &esengine::renderer_captureNextFrame);
    emscripten::function("renderer_getCapturedFrameSize", &esengine::renderer_getCapturedFrameSize);
    emscripten::function("renderer_getCapturedFrameData", &esengine::renderer_getCapturedFrameData);
    emscripten::function("renderer_getCapturedEntities", &esengine::renderer_getCapturedEntities);
    emscripten::function("renderer_getCapturedEntityCount", &esengine::renderer_getCapturedEntityCount);
    emscripten::function("renderer_getCapturedCameraCount", &esengine::renderer_getCapturedCameraCount);
    emscripten::function("renderer_hasCapturedData", &esengine::renderer_hasCapturedData);
    emscripten::function("renderer_replayToDrawCall", &esengine::renderer_replayToDrawCall);
    emscripten::function("renderer_getSnapshotPtr", &esengine::renderer_getSnapshotPtr);
    emscripten::function("renderer_getSnapshotSize", &esengine::renderer_getSnapshotSize);
    emscripten::function("renderer_getSnapshotWidth", &esengine::renderer_getSnapshotWidth);
    emscripten::function("renderer_getSnapshotHeight", &esengine::renderer_getSnapshotHeight);
    emscripten::function("renderer_setTextureParams", &esengine::renderer_setTextureParams);
}

// =============================================================================
// UI Systems
// =============================================================================

namespace esengine {

void uiLayout_update(ecs::Registry& registry, f32 camLeft, f32 camBottom, f32 camRight, f32 camTop) {
    ecs::uiLayoutUpdate(registry, camLeft, camBottom, camRight, camTop);
}

void uiHitTest_update(ecs::Registry& registry, f32 mouseWorldX, f32 mouseWorldY,
                       bool mouseDown, bool mousePressed, bool mouseReleased) {
    ecs::uiHitTestUpdate(registry, mouseWorldX, mouseWorldY, mouseDown, mousePressed, mouseReleased);
}

u32 uiHitTest_getHitEntity() {
    return ecs::uiHitTestGetHitEntity();
}

u32 uiHitTest_getHitEntityPrev() {
    return ecs::uiHitTestGetHitEntityPrev();
}

void uiRenderOrder_update(ecs::Registry& registry) {
    ecs::uiRenderOrderUpdate(registry);
}

void uiFlexLayout_update(ecs::Registry& registry) {
    // Flex layout is now integrated into uiLayout_update via unified layout pass.
    // Kept as no-op for backward compatibility with TS plugin.
    (void)registry;
}

void uiTree_markStructureDirty() {
    ecs::uiTreeMarkStructureDirty();
}

void uiTree_markDirty(u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    ecs::uiTreeMarkDirty(e);
}

void uiTree_markAllDirty() {
    ecs::getUITree().markAllDirty();
}

f32 getUIRectComputedWidth(ecs::Registry& registry, u32 entity) {
    auto* rect = registry.tryGet<ecs::UIRect>(Entity::fromRaw(entity));
    if (!rect) return 0.0f;
    return rect->computed_size_.x;
}

f32 getUIRectComputedHeight(ecs::Registry& registry, u32 entity) {
    auto* rect = registry.tryGet<ecs::UIRect>(Entity::fromRaw(entity));
    if (!rect) return 0.0f;
    return rect->computed_size_.y;
}

void setUIRectSize(ecs::Registry& registry, u32 entity, f32 w, f32 h) {
    auto* rect = registry.tryGet<ecs::UIRect>(Entity::fromRaw(entity));
    if (!rect) return;
    rect->size.x = w;
    rect->size.y = h;
    ecs::uiTreeMarkDirty(Entity::fromRaw(entity));
}

void transform_update(ecs::Registry& registry) {
    esengine::World world{registry, ctx().services(), 0.0f};
    if (auto* ts = ctx().tryGet<ecs::TransformSystem>()) {
        ts->update(world);
    } else {
        ecs::TransformSystem fallback;
        fallback.update(world);
    }
}

void uiRect_clearAnimOverrides(ecs::Registry& registry) {
    for (auto entity : registry.view<ecs::UIRect>()) {
        registry.get<ecs::UIRect>(entity).anim_override_ = 0;
    }
}

void uiRect_setAnimOverride(ecs::Registry& registry, u32 entity, u8 flags) {
    auto* rect = registry.tryGet<ecs::UIRect>(Entity::fromRaw(entity));
    if (rect) {
        rect->anim_override_ |= flags;
    }
}

void uiRect_patchOffset(ecs::Registry& registry, u32 entity,
                        f32 minX, f32 minY, f32 maxX, f32 maxY) {
    auto* rect = registry.tryGet<ecs::UIRect>(Entity::fromRaw(entity));
    if (!rect) return;
    rect->offsetMin = {minX, minY};
    rect->offsetMax = {maxX, maxY};
}

void transform_patchPosition(ecs::Registry& registry, u32 entity,
                             f32 x, f32 y, f32 z) {
    auto* transform = registry.tryGet<ecs::Transform>(Entity::fromRaw(entity));
    if (!transform) return;
    transform->position = {x, y, z};
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_ui_systems) {
    emscripten::function("uiLayout_update", &esengine::uiLayout_update);
    emscripten::function("uiHitTest_update", &esengine::uiHitTest_update);
    emscripten::function("uiHitTest_getHitEntity", &esengine::uiHitTest_getHitEntity);
    emscripten::function("uiHitTest_getHitEntityPrev", &esengine::uiHitTest_getHitEntityPrev);
    emscripten::function("uiRenderOrder_update", &esengine::uiRenderOrder_update);
    emscripten::function("uiFlexLayout_update", &esengine::uiFlexLayout_update);
    emscripten::function("getUIRectComputedWidth", &esengine::getUIRectComputedWidth);
    emscripten::function("getUIRectComputedHeight", &esengine::getUIRectComputedHeight);
    emscripten::function("uiTree_markStructureDirty", &esengine::uiTree_markStructureDirty);
    emscripten::function("uiTree_markDirty", &esengine::uiTree_markDirty);
    emscripten::function("uiTree_markAllDirty", &esengine::uiTree_markAllDirty);
    emscripten::function("setUIRectSize", &esengine::setUIRectSize);
    emscripten::function("transform_update", &esengine::transform_update);
    emscripten::function("uiRect_clearAnimOverrides", &esengine::uiRect_clearAnimOverrides);
    emscripten::function("uiRect_setAnimOverride", &esengine::uiRect_setAnimOverride);
    emscripten::function("uiRect_patchOffset", &esengine::uiRect_patchOffset);
    emscripten::function("transform_patchPosition", &esengine::transform_patchPosition);
}

// =============================================================================
// Animation Bindings
// =============================================================================

namespace esengine {

u32 anim_createTween(ecs::Registry& registry, u32 entity, u32 targetProp,
                     f32 from, f32 to, f32 duration,
                     u32 easing, f32 delay,
                     u32 loopMode, i32 loopCount) {
    auto* sys = ctx().tryGet<animation::TweenSystem>();
    if (!sys) {
        return INVALID_ENTITY.id();
    }
    auto tweenEntity = sys->createTween(
        registry, Entity::fromRaw(entity),
        static_cast<animation::TweenTarget>(targetProp),
        from, to, duration,
        static_cast<animation::EasingType>(easing));

    auto& tween = registry.get<animation::TweenData>(tweenEntity);
    tween.delay = delay;
    tween.loop_mode = static_cast<animation::LoopMode>(loopMode);
    tween.loop_count = loopCount;
    tween.loops_remaining = loopCount;
    return tweenEntity.id();
}

void anim_cancelTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_cancelAllTweens(ecs::Registry& registry, u32 targetEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelAllTweens(registry, Entity::fromRaw(targetEntity));
    }
}

void anim_pauseTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->pauseTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_resumeTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->resumeTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_setTweenBezier(ecs::Registry& registry, u32 tweenEntity,
                          f32 p1x, f32 p1y, f32 p2x, f32 p2y) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->easing = animation::EasingType::CubicBezier;
        tween->bezier_p1x = p1x;
        tween->bezier_p1y = p1y;
        tween->bezier_p2x = p2x;
        tween->bezier_p2y = p2y;
    }
}

void anim_setSequenceNext(ecs::Registry& registry, u32 tweenEntity, u32 nextEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->sequence_next = Entity::fromRaw(nextEntity);
    }
}

void anim_updateTweens(ecs::Registry& registry, f32 deltaTime) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->update(registry, deltaTime);
    }
}

i32 anim_getTweenState(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        return static_cast<i32>(tween->state);
    }
    return static_cast<i32>(animation::TweenState::Completed);
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_animation) {
    emscripten::function("_anim_createTween", &esengine::anim_createTween);
    emscripten::function("_anim_cancelTween", &esengine::anim_cancelTween);
    emscripten::function("_anim_cancelAllTweens", &esengine::anim_cancelAllTweens);
    emscripten::function("_anim_pauseTween", &esengine::anim_pauseTween);
    emscripten::function("_anim_resumeTween", &esengine::anim_resumeTween);
    emscripten::function("_anim_setTweenBezier", &esengine::anim_setTweenBezier);
    emscripten::function("_anim_setSequenceNext", &esengine::anim_setSequenceNext);
    emscripten::function("_anim_updateTweens", &esengine::anim_updateTweens);
    emscripten::function("_anim_getTweenState", &esengine::anim_getTweenState);
}

int main() {
    return 0;
}

#endif  // ES_PLATFORM_WEB
