#ifdef ES_PLATFORM_WEB

#include "RendererBindings.hpp"
#include "EngineContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderCommand.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderStage.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../core/Log.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif

#include <emscripten/val.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().state().initialized)
#define g_renderFrame (ctx().tryGet<RenderFrame>())
#define g_transformSystem (ctx().tryGet<ecs::TransformSystem>())
#define g_glErrorCheckEnabled (ctx().state().gl_error_check_enabled)
#define g_viewportWidth (ctx().state().viewport_width)
#define g_viewportHeight (ctx().state().viewport_height)
#ifdef ES_ENABLE_SPINE
#define g_spineSystem (ctx().tryGet<spine::SpineSystem>())
#endif
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif

static u32 checkGLErrors(const char* context) {
    if (!g_glErrorCheckEnabled) return 0;
    u32 errorCount = 0;
    GLenum err;
    while ((err = static_cast<GLenum>(RenderCommand::getDevice()->getError())) != GL_NO_ERROR) {
        const char* errStr = "UNKNOWN";
        switch (err) {
            case GL_INVALID_ENUM: errStr = "INVALID_ENUM"; break;
            case GL_INVALID_VALUE: errStr = "INVALID_VALUE"; break;
            case GL_INVALID_OPERATION: errStr = "INVALID_OPERATION"; break;
            case GL_INVALID_FRAMEBUFFER_OPERATION: errStr = "INVALID_FRAMEBUFFER_OPERATION"; break;
            case GL_OUT_OF_MEMORY: errStr = "OUT_OF_MEMORY"; break;
            case GL_CONTEXT_LOST: errStr = "CONTEXT_LOST"; break;
            case GL_CONTEXT_LOST_WEBGL: errStr = "CONTEXT_LOST_WEBGL"; break;
        }
        ES_LOG_ERROR("[GL Error] {} (0x{:04X}) at: {}", errStr, static_cast<u32>(err), context);
        errorCount++;
    }
    return errorCount;
}

#ifdef ES_ENABLE_SPINE
SpineBounds getSpineBounds(ecs::Registry& registry, Entity entity) {
    SpineBounds bounds;
    if (!g_spineSystem) return bounds;

    if (g_spineSystem->getSkeletonBounds(entity, bounds.x, bounds.y,
                                          bounds.width, bounds.height)) {
        bounds.valid = true;
    }
    return bounds;
}

void spine_update(ecs::Registry& registry, f32 dt) {
    if (!g_spineSystem) return;
    g_spineSystem->update(registry, dt);
}

bool spine_play(Entity entity, const std::string& animation, bool loop, i32 track) {
    if (!g_spineSystem) return false;
    return g_spineSystem->playAnimation(entity, animation, loop, track);
}

bool spine_addAnimation(Entity entity, const std::string& animation, bool loop, f32 delay, i32 track) {
    if (!g_spineSystem) return false;
    return g_spineSystem->addAnimation(entity, animation, loop, delay, track);
}

bool spine_setSkin(Entity entity, const std::string& skinName) {
    if (!g_spineSystem) return false;
    return g_spineSystem->setSkin(entity, skinName);
}

emscripten::val spine_getBonePosition(Entity entity, const std::string& boneName) {
    if (!g_spineSystem) return emscripten::val::null();
    f32 x = 0, y = 0;
    if (!g_spineSystem->getBonePosition(entity, boneName, x, y)) {
        return emscripten::val::null();
    }
    auto result = emscripten::val::object();
    result.set("x", x);
    result.set("y", y);
    return result;
}

bool spine_hasInstance(Entity entity) {
    if (!g_spineSystem) return false;
    return g_spineSystem->getInstance(entity) != nullptr;
}

void spine_reloadAssets(ecs::Registry& registry) {
    if (!g_spineSystem) return;
    g_spineSystem->reloadAssets(registry);
}

emscripten::val spine_getAnimations(Entity entity) {
    auto result = emscripten::val::array();
    if (!g_spineSystem) return result;
    auto names = g_spineSystem->getAnimationNames(entity);
    for (size_t i = 0; i < names.size(); ++i) {
        result.call<void>("push", names[i]);
    }
    return result;
}

emscripten::val spine_getSkins(Entity entity) {
    auto result = emscripten::val::array();
    if (!g_spineSystem) return result;
    auto names = g_spineSystem->getSkinNames(entity);
    for (size_t i = 0; i < names.size(); ++i) {
        result.call<void>("push", names[i]);
    }
    return result;
}

void renderer_submitSpineBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    uintptr_t transformPtr,
    Entity entity, i32 layer, f32 depth
) {
    if (!g_initialized || !g_renderFrame) return;
    auto* vertices = reinterpret_cast<const f32*>(verticesPtr);
    auto* indices = reinterpret_cast<const u16*>(indicesPtr);
    auto* transform = reinterpret_cast<const f32*>(transformPtr);
    g_renderFrame->submitSpineBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, blendMode, transform, entity, layer, depth);
}

void renderer_submitSpineBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    Entity entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth
) {
    if (!g_initialized || !g_renderFrame) return;
    if (!registry.has<ecs::Transform>(entity)) return;

    auto& t = registry.get<ecs::Transform>(entity);
    t.ensureDecomposed();

    glm::vec3 s = t.worldScale;
    s.x *= skelScale;
    s.y *= skelScale;
    if (flipX) s.x = -s.x;
    if (flipY) s.y = -s.y;

    glm::mat4 model = glm::translate(glm::mat4(1.0f), t.worldPosition)
                     * glm::mat4_cast(t.worldRotation)
                     * glm::scale(glm::mat4(1.0f), s);

    auto* vertices = reinterpret_cast<const f32*>(verticesPtr);
    auto* indices = reinterpret_cast<const u16*>(indicesPtr);
    g_renderFrame->submitSpineBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, blendMode, &model[0][0], entity, layer, depth);
}

void spine_setNeedsReload(ecs::Registry& registry, Entity entity, bool value) {
    if (!registry.has<ecs::SpineAnimation>(entity)) return;
    auto& comp = registry.get<ecs::SpineAnimation>(entity);
    comp.needsReload = value;
}

i32 spine_native_getEventCount() {
    if (!g_spineSystem) return 0;
    return g_spineSystem->getEventCount();
}

uintptr_t spine_native_getEventBuffer() {
    if (!g_spineSystem) return 0;
    return reinterpret_cast<uintptr_t>(g_spineSystem->getEventBuffer());
}

emscripten::val spine_native_getEventRecord(i32 index) {
    if (!g_spineSystem || index < 0 || index >= g_spineSystem->getEventCount()) {
        return emscripten::val::null();
    }
    auto& record = g_spineSystem->getEventRecord(index);
    auto result = emscripten::val::object();
    result.set("entity", static_cast<i32>(record.entity.id()));
    result.set("animationName", record.animationName);
    result.set("eventName", record.eventName);
    result.set("stringValue", record.stringValue);
    return result;
}

void spine_native_clearEvents() {
    if (!g_spineSystem) return;
    g_spineSystem->clearEvents();
}

emscripten::val spine_native_listConstraints(Entity entity) {
    auto result = emscripten::val::object();
    if (!g_spineSystem) return result;

    auto names = g_spineSystem->listConstraints(entity);

    auto ikArr = emscripten::val::array();
    for (size_t i = 0; i < names.ik.size(); ++i) ikArr.call<void>("push", names.ik[i]);
    auto tfArr = emscripten::val::array();
    for (size_t i = 0; i < names.transform.size(); ++i) tfArr.call<void>("push", names.transform[i]);
    auto pathArr = emscripten::val::array();
    for (size_t i = 0; i < names.path.size(); ++i) pathArr.call<void>("push", names.path[i]);

    result.set("ik", ikArr);
    result.set("transform", tfArr);
    result.set("path", pathArr);
    return result;
}

emscripten::val spine_native_getTransformConstraintMix(Entity entity, const std::string& name) {
    if (!g_spineSystem) return emscripten::val::null();
    f32 rotate = 0, x = 0, y = 0, scaleX = 0, scaleY = 0, shearY = 0;
    if (!g_spineSystem->getTransformConstraintMix(entity, name, rotate, x, y, scaleX, scaleY, shearY)) {
        return emscripten::val::null();
    }
    auto result = emscripten::val::object();
    result.set("mixRotate", rotate);
    result.set("mixX", x);
    result.set("mixY", y);
    result.set("mixScaleX", scaleX);
    result.set("mixScaleY", scaleY);
    result.set("mixShearY", shearY);
    return result;
}

bool spine_native_setTransformConstraintMix(Entity entity, const std::string& name,
    f32 rotate, f32 x, f32 y, f32 scaleX, f32 scaleY, f32 shearY) {
    if (!g_spineSystem) return false;
    return g_spineSystem->setTransformConstraintMix(entity, name, rotate, x, y, scaleX, scaleY, shearY);
}

emscripten::val spine_native_getPathConstraintMix(Entity entity, const std::string& name) {
    if (!g_spineSystem) return emscripten::val::null();
    f32 position = 0, spacing = 0, rotate = 0, x = 0, y = 0;
    if (!g_spineSystem->getPathConstraintMix(entity, name, position, spacing, rotate, x, y)) {
        return emscripten::val::null();
    }
    auto result = emscripten::val::object();
    result.set("position", position);
    result.set("spacing", spacing);
    result.set("mixRotate", rotate);
    result.set("mixX", x);
    result.set("mixY", y);
    return result;
}

bool spine_native_setPathConstraintMix(Entity entity, const std::string& name,
    f32 position, f32 spacing, f32 rotate, f32 x, f32 y) {
    if (!g_spineSystem) return false;
    return g_spineSystem->setPathConstraintMix(entity, name, position, spacing, rotate, x, y);
}
#endif

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->update();
    }

    if (g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
    }

#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_spineSystem->update(registry, ctx().state().delta_time);
    }
#endif

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    auto* dev = RenderCommand::getDevice();
    dev->setViewport(0, 0, static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));
    const auto& cc = ctx().state().clear_color;
    dev->setClearColor(cc.r, cc.g, cc.b, cc.a);
    dev->clear(true, true, false);

    glm::mat4 viewProjection = glm::mat4(1.0f);

    auto cameraView = registry.view<ecs::Camera, ecs::Transform>();

    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (!camera.isActive) continue;

        auto& transform = registry.get<ecs::Transform>(entity);
        glm::mat4 view = glm::inverse(glm::translate(glm::mat4(1.0f), transform.position));

        glm::mat4 projection;
        f32 aspect = static_cast<f32>(viewportWidth) / static_cast<f32>(viewportHeight);

        if (camera.projectionType == ecs::ProjectionType::Orthographic) {
            f32 halfHeight = camera.orthoSize;
            f32 halfWidth = halfHeight * aspect;
            projection = glm::ortho(-halfWidth, halfWidth, -halfHeight, halfHeight,
                                    camera.nearPlane, camera.farPlane);
        } else {
            projection = glm::perspective(
                glm::radians(camera.fov),
                static_cast<f32>(viewportWidth) / static_cast<f32>(viewportHeight),
                camera.nearPlane, camera.farPlane
            );
        }

        viewProjection = projection * view;
        break;
    }

    g_renderFrame->begin(viewProjection);
    g_renderFrame->collectAll(registry);
    g_renderFrame->end();
}

void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                           uintptr_t matrixPtr) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->update();
    }

    if (g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
    }

#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_spineSystem->update(registry, ctx().state().delta_time);
    }
#endif

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    auto* dev = RenderCommand::getDevice();
    dev->setViewport(0, 0, static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));
    const auto& cc = ctx().state().clear_color;
    dev->setClearColor(cc.r, cc.g, cc.b, cc.a);
    dev->clear(true, true, false);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection);
    g_renderFrame->collectAll(registry);
    g_renderFrame->end();
}

void renderer_init(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().state().viewport_width = width;
    ctx().state().viewport_height = height;
    g_renderFrame->resize(width, height);
}

void renderer_resize(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().state().viewport_width = width;
    ctx().state().viewport_height = height;
    g_renderFrame->resize(width, height);
}

void renderer_beginFrame() {
    ctx().state().transforms_updated = false;
}

void renderer_begin(uintptr_t matrixPtr, u32 targetHandle) {
    if (!g_renderFrame) return;

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection, targetHandle);
}

void renderer_flush() {
    if (!g_renderFrame) return;
    g_renderFrame->flush();
    checkGLErrors("renderer_flush");
}

void renderer_end() {
    if (!g_renderFrame) return;
    g_renderFrame->end();
    checkGLErrors("renderer_end");
}

static void ensureTransformsUpdated(ecs::Registry& registry) {
    if (!ctx().state().transforms_updated && g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
        ctx().state().transforms_updated = true;
    }
}

void renderer_submitSprites(ecs::Registry& registry) {
    (void)registry;
}

void renderer_submitUIElements(ecs::Registry& registry) {
    (void)registry;
}

#ifdef ES_ENABLE_BITMAP_TEXT
void renderer_submitBitmapText(ecs::Registry& registry) {
    (void)registry;
}
#endif

void renderer_submitShapes(ecs::Registry& registry) {
    (void)registry;
}

#ifdef ES_ENABLE_SPINE
void renderer_submitSpine(ecs::Registry& registry) {
    (void)registry;
}
#endif

#ifdef ES_ENABLE_PARTICLES
void renderer_submitParticles(ecs::Registry& registry) {
    (void)registry;
}
#endif

void renderer_updateTransforms(ecs::Registry& registry) {
    ensureTransformsUpdated(registry);
}

void renderer_submitAll(ecs::Registry& registry, u32 skipFlags, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    if (!g_renderFrame) return;
    ensureTransformsUpdated(registry);
    g_renderFrame->processMasks(registry, vpX, vpY, vpW, vpH);

    g_renderFrame->collectAll(registry, skipFlags);
}

#ifdef ES_ENABLE_PARTICLES
void particle_update(ecs::Registry& registry, f32 dt) {
    if (!g_particleSystem) return;
    g_particleSystem->update(registry, dt);
}

void particle_play(ecs::Registry& registry, Entity entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->play(entity);
}

void particle_stop(ecs::Registry& registry, Entity entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->stop(entity);
}

void particle_reset(ecs::Registry& registry, Entity entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->reset(entity);
}

u32 particle_getAliveCount(Entity entity) {
    if (!g_particleSystem) return 0;
    return g_particleSystem->aliveCount(entity);
}
#endif

void renderer_setStage(i32 stage) {
    if (!g_renderFrame) return;
    g_renderFrame->setStage(static_cast<RenderStage>(stage));
}

u32 renderer_createTarget(u32 width, u32 height, i32 flags) {
    if (!g_renderFrame) return 0;
    bool depth = (flags & 1) != 0;
    bool linear = (flags & 2) != 0;
    return g_renderFrame->targetManager().create(width, height, depth, linear);
}

u32 renderer_getTargetDepthTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? target->getDepthTexture() : 0;
}

void renderer_releaseTarget(u32 handle) {
    if (!g_renderFrame) return;
    g_renderFrame->targetManager().release(handle);
}

u32 renderer_getTargetTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? target->getColorTexture() : 0;
}

u32 renderer_getDrawCalls() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().draw_calls;
}

u32 renderer_getTriangles() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().triangles;
}

u32 renderer_getSprites() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().sprites;
}

#ifdef ES_ENABLE_SPINE
u32 renderer_getSpine() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().spine;
}
#endif

u32 renderer_getText() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().text;
}

u32 renderer_getMeshes() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().meshes;
}

u32 renderer_getCulled() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().culled;
}

void renderer_setDeltaTime(f32 dt) {
    ctx().state().delta_time = dt;
}

void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a) {
    ctx().state().clear_color = glm::vec4(r, g, b, a);
}

void renderer_setViewport(i32 x, i32 y, i32 w, i32 h) {
    RenderCommand::getDevice()->setViewport(x, y, static_cast<u32>(w), static_cast<u32>(h));
}

void renderer_setScissor(i32 x, i32 y, i32 w, i32 h, bool enable) {
    auto* dev = RenderCommand::getDevice();
    if (enable) {
        dev->setScissorTest(true);
        dev->setScissor(x, y, w, h);
    } else {
        dev->setScissorTest(false);
    }
}

void renderer_clearBuffers(i32 flags) {
    bool color = (flags & 1) != 0;
    bool depth = (flags & 2) != 0;
    if (color || depth) {
        RenderCommand::getDevice()->clear(color, depth, false);
    }
}

void renderer_diagnose() {
    if (!g_initialized) {
        ES_LOG_ERROR("[Diagnose] Renderer not initialized");
        return;
    }

    const char* version = reinterpret_cast<const char*>(glGetString(GL_VERSION));
    const char* rendererStr = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
    const char* vendor = reinterpret_cast<const char*>(glGetString(GL_VENDOR));
    const char* slVersion = reinterpret_cast<const char*>(glGetString(GL_SHADING_LANGUAGE_VERSION));
    ES_LOG_INFO("[Diagnose] GL Version: {}", version ? version : "null");
    ES_LOG_INFO("[Diagnose] GL Renderer: {}", rendererStr ? rendererStr : "null");
    ES_LOG_INFO("[Diagnose] GL Vendor: {}", vendor ? vendor : "null");
    ES_LOG_INFO("[Diagnose] GLSL Version: {}", slVersion ? slVersion : "null");

    GLint viewport[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    ES_LOG_INFO("[Diagnose] GL Viewport: {}x{} at ({},{})", viewport[2], viewport[3], viewport[0], viewport[1]);
    ES_LOG_INFO("[Diagnose] Stored viewport: {}x{}", g_viewportWidth, g_viewportHeight);

    GLint maxTextureUnits;
    glGetIntegerv(GL_MAX_TEXTURE_IMAGE_UNITS, &maxTextureUnits);
    ES_LOG_INFO("[Diagnose] Max texture units: {}", maxTextureUnits);

    GLint maxAttribs;
    glGetIntegerv(GL_MAX_VERTEX_ATTRIBS, &maxAttribs);
    ES_LOG_INFO("[Diagnose] Max vertex attribs: {}", maxAttribs);

    while (glGetError() != GL_NO_ERROR) {}
    ES_LOG_INFO("[Diagnose] No pending GL errors (cleared)");
}

void renderer_setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h) {
    if (g_renderFrame) {
        g_renderFrame->setEntityClipRect(entity, x, y, w, h);
    }
}

void renderer_clearEntityClipRect(u32 entity) {
    if (g_renderFrame) {
        g_renderFrame->clearEntityClipRect(entity);
    }
}

void renderer_clearAllClipRects() {
    if (g_renderFrame) {
        g_renderFrame->clearAllClipRects();
    }
}

void renderer_clearStencil() {
    glClearStencil(0);
    RenderCommand::getDevice()->clear(false, false, true);
}

void renderer_setEntityStencilMask(u32 entity, i32 refValue) {
    if (g_renderFrame) {
        g_renderFrame->setEntityStencilMask(entity, refValue);
    }
}

void renderer_setEntityStencilTest(u32 entity, i32 refValue) {
    if (g_renderFrame) {
        g_renderFrame->setEntityStencilTest(entity, refValue);
    }
}

void renderer_clearEntityStencilMask(u32 entity) {
    if (g_renderFrame) {
        g_renderFrame->clearEntityStencilMask(entity);
    }
}

void renderer_clearAllStencilMasks() {
    if (g_renderFrame) {
        g_renderFrame->clearAllStencilMasks();
    }
}

void gl_enableErrorCheck(bool enabled) {
    ctx().state().gl_error_check_enabled = enabled;
    if (enabled) {
        while (RenderCommand::getDevice()->getError() != 0) {}
        ES_LOG_INFO("[GL] Error checking enabled");
    }
}

u32 gl_checkErrors(const std::string& context) {
    bool prev = g_glErrorCheckEnabled;
    ctx().state().gl_error_check_enabled = true;
    u32 count = checkGLErrors(context.c_str());
    ctx().state().gl_error_check_enabled = prev;
    if (count == 0 && prev) {
        ES_LOG_INFO("[GL] No errors at: {}", context);
    }
    return count;
}

i32 registry_getCanvasEntity(ecs::Registry& registry) {
    auto view = registry.view<ecs::Canvas>();
    for (auto entity : view) {
        return static_cast<i32>(entity.id());
    }
    return -1;
}

emscripten::val registry_getCameraEntities(ecs::Registry& registry) {
    auto cameraView = registry.view<ecs::Camera, ecs::Transform>();
    auto result = emscripten::val::array();
    u32 idx = 0;
    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (camera.isActive) {
            result.set(idx++, entity.id());
        }
    }
    return result;
}

emscripten::val getChildEntities(ecs::Registry& registry, u32 entity) {
    auto result = emscripten::val::array();
    if (!registry.has<ecs::Children>(Entity::fromRaw(entity))) {
        return result;
    }
    const auto& children = registry.get<ecs::Children>(Entity::fromRaw(entity));
    u32 idx = 0;
    for (auto child : children.entities) {
        result.set(idx++, child.id());
    }
    return result;
}

u32 registry_getGeneration(ecs::Registry& registry, u32 entity) {
    return Entity::fromRaw(entity).generation();
}

u32 registry_getSchemaPoolVersion(ecs::Registry& registry, u32 poolId) {
    return registry.getSchemaPoolVersion(poolId);
}

void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu) {
    const float* buffer = reinterpret_cast<const float*>(bufferPtr);
    for (int i = 0; i < count; i++) {
        const int offset = i * 4;
        uint32_t entityId;
        std::memcpy(&entityId, buffer + offset, sizeof(uint32_t));
        auto entity = Entity::fromRaw(entityId);
        if (!registry.valid(entity)) continue;
        if (!registry.has<ecs::Transform>(entity)) continue;

        auto& transform = registry.get<ecs::Transform>(entity);
        float px = buffer[offset + 1] * ppu;
        float py = buffer[offset + 2] * ppu;
        float angle = buffer[offset + 3];
        float half = angle * 0.5f;
        glm::quat rot(std::cos(half), 0.0f, 0.0f, std::sin(half));

        transform.position.x = px;
        transform.position.y = py;
        transform.rotation = rot;

        transform.worldPosition.x = px;
        transform.worldPosition.y = py;
        transform.worldRotation = rot;
        transform.decomposed_ = true;
    }
}

void renderer_captureNextFrame() {
    if (g_renderFrame) {
        g_renderFrame->frameCapture().setCaptureNextFrame(true);
    }
}

u32 renderer_getCapturedFrameSize() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getRecordCount();
}

uintptr_t renderer_getCapturedFrameData() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->frameCapture().getRecords());
}

uintptr_t renderer_getCapturedEntities() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->frameCapture().getEntities());
}

u32 renderer_getCapturedEntityCount() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getEntityCount();
}

u32 renderer_getCapturedCameraCount() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getCameraCount();
}

bool renderer_hasCapturedData() {
    if (!g_renderFrame) return false;
    return g_renderFrame->frameCapture().hasCapturedData();
}

void renderer_replayToDrawCall(i32 drawCallIndex) {
    if (!g_renderFrame) return;
    g_renderFrame->replayToDrawCall(drawCallIndex);
}

uintptr_t renderer_getSnapshotPtr() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->getSnapshotPixels());
}

u32 renderer_getSnapshotSize() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotSize();
}

u32 renderer_getSnapshotWidth() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotWidth();
}

u32 renderer_getSnapshotHeight() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotHeight();
}

void renderer_setTextureParams(u32 textureId, i32 minFilter, i32 magFilter, i32 wrapS, i32 wrapT) {
    auto* device = RenderCommand::getDevice();
    if (!device) return;
    device->setTextureParams(
        textureId,
        static_cast<TextureFilter>(minFilter),
        static_cast<TextureFilter>(magFilter),
        static_cast<TextureWrap>(wrapS),
        static_cast<TextureWrap>(wrapT)
    );
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
