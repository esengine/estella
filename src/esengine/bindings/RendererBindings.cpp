// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "RendererBindings.hpp"
#include "ActiveContext.hpp"
#include "../renderer/GfxDevice.hpp"
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
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif

#include <emscripten/val.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_renderFrame (ctx().tryGet<RenderFrame>())
#define g_transformSystem (ctx().tryGet<ecs::TransformSystem>())
#define g_glErrorCheckEnabled (ctx().state().gl_error_check_enabled)
#define g_viewportWidth (ctx().state().viewport_width)
#define g_viewportHeight (ctx().state().viewport_height)
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif

static u32 checkGLErrors(const char* context) {
    if (!g_glErrorCheckEnabled) return 0;
    u32 errorCount = 0;
    u32 err;
    while ((err = g_device->getError()) != 0) {
        ES_LOG_ERROR("[GL Error] 0x{:04X} at: {}", err, context);
        errorCount++;
    }
    return errorCount;
}

// Spine renders fully through the side modules now: the SDK SpineManager
// computes meshes in spine{NN}.wasm and submits each batch here. The old native
// spine_* accessors (driven by a core spine-cpp runtime) are gone.
#ifdef ES_ENABLE_SPINE
void renderer_submitSpineBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth
) {
    if (!g_initialized || !g_renderFrame) return;
    auto* vertices = reinterpret_cast<const f32*>(verticesPtr);
    auto* indices = reinterpret_cast<const u16*>(indicesPtr);
    auto* transform = reinterpret_cast<const f32*>(transformPtr);
    g_renderFrame->submitSpineBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, blendMode, transform, Entity::fromRaw(entity), layer, depth);
}

void renderer_submitSpineBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth
) {
    if (!g_initialized || !g_renderFrame) return;
    const Entity ent = Entity::fromRaw(entity);
    if (!registry.has<ecs::Transform>(ent)) return;

    auto& t = registry.get<ecs::Transform>(ent);
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
        textureId, blendMode, &model[0][0], ent, layer, depth);
}

#endif

// TS lays out glyph quads against the dynamic SDF atlas and
// submits them here (ungated — text is core, unlike spine).
void renderer_submitTextBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth
) {
    if (!g_initialized || !g_renderFrame) return;
    auto* vertices = reinterpret_cast<const f32*>(verticesPtr);
    auto* indices = reinterpret_cast<const u16*>(indicesPtr);
    auto* transform = reinterpret_cast<const f32*>(transformPtr);
    g_renderFrame->submitTextBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, transform, Entity::fromRaw(entity), layer, depth);
}

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->update();
    }

    if (g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
    }

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    auto* dev = g_device;
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

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    auto* dev = g_device;
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
    g_device->setViewport(x, y, static_cast<u32>(w), static_cast<u32>(h));
}

void renderer_setScissor(i32 x, i32 y, i32 w, i32 h, bool enable) {
    auto* dev = g_device;
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
        g_device->clear(color, depth, false);
    }
}

void renderer_diagnose() {
    if (!g_initialized) {
        ES_LOG_ERROR("[Diagnose] Renderer not initialized");
        return;
    }

    ES_LOG_INFO("[Diagnose] GL Version: {}", g_device->getString(GfxStringName::Version));
    ES_LOG_INFO("[Diagnose] GL Renderer: {}", g_device->getString(GfxStringName::Renderer));
    ES_LOG_INFO("[Diagnose] GL Vendor: {}", g_device->getString(GfxStringName::Vendor));
    ES_LOG_INFO("[Diagnose] GLSL Version: {}", g_device->getString(GfxStringName::ShadingLanguageVersion));
    ES_LOG_INFO("[Diagnose] Stored viewport: {}x{}", g_viewportWidth, g_viewportHeight);
    ES_LOG_INFO("[Diagnose] Max texture units: {}", g_device->getInt(GfxIntParam::MaxTextureImageUnits));
    ES_LOG_INFO("[Diagnose] Max vertex attribs: {}", g_device->getInt(GfxIntParam::MaxVertexAttribs));

    while (g_device->getError() != 0) {}
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
    g_device->setClearStencil(0);
    g_device->clear(false, false, true);
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
        while (g_device->getError() != 0) {}
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
    auto* device = g_device;
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

