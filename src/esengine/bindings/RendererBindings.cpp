// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "RendererBindings.hpp"
#include "../resource/ShaderParser.hpp"
#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/frame/RenderContext.hpp"
#include "../core/FrameProfiler.hpp"
#include "../renderer/frame/RenderStage.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Mesh2D.hpp"
#include "../ecs/components/Light2D.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../core/Log.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#include "../trail/TrailSystem.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/val.h>
#endif
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
#define g_trailSystem (ctx().tryGet<trail::TrailSystem>())

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
    if (vertexCount < 0 || indexCount < 0) return;
    // Spine vertex format is x,y,u,v,r,g,b,a (8 floats per vertex).
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * 8, "renderer_submitSpineBatch.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_submitSpineBatch.indices");
    auto* transform = boundarySpan<f32>(transformPtr, 16, "renderer_submitSpineBatch.transform");
    if (!vertices || !indices || !transform) return;
    g_renderFrame->submitSpineBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, blendMode, transform, Entity::fromRaw(entity), layer, depth);
}

void renderer_submitSkeletalBatchByEntity(
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

    if (vertexCount < 0 || indexCount < 0) return;
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * 8, "renderer_submitSkeletalBatchByEntity.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_submitSkeletalBatchByEntity.indices");
    if (!vertices || !indices) return;
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
    u32 entity, i32 layer, f32 depth, i32 sdf, u32 cullBit
) {
    if (!g_initialized || !g_renderFrame) return;
    if (vertexCount < 0 || indexCount < 0) return;
    // Text vertex format is x,y,u,v,r,g,b,a (8 floats per vertex).
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * 8, "renderer_submitTextBatch.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_submitTextBatch.indices");
    auto* transform = boundarySpan<f32>(transformPtr, 16, "renderer_submitTextBatch.transform");
    if (!vertices || !indices || !transform) return;
    g_renderFrame->submitTextBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, transform, Entity::fromRaw(entity), layer, depth, sdf != 0, cullBit);
}

// Mesh2D geometry upload: interleaved f32 [x,y,u,v] per vertex, optional RGBA8
// colors (null = all white), u32 triangle-list indices. Validated here — the single
// upload entry — so the render path can trust the payload: out-of-range indices or a
// non-triangle count reject the whole upload instead of feeding the GPU garbage.
void mesh2d_setGeometry(ecs::Registry& registry, u32 entity,
                        uintptr_t posUvPtr, u32 vertexCount,
                        uintptr_t colorsPtr,
                        uintptr_t indicesPtr, u32 indexCount) {
    const Entity ent = Entity::fromRaw(entity);
    auto* mesh = registry.tryGet<ecs::Mesh2D>(ent);
    if (!mesh) {
        ES_LOG_WARN("mesh2d_setGeometry: entity {} has no Mesh2D component", entity);
        return;
    }

    // Empty upload = clear the geometry (a valid state: the mesh renders nothing).
    if (posUvPtr == 0 || indicesPtr == 0 || vertexCount == 0 || indexCount == 0) {
        mesh->vertices.clear();
        mesh->indices.clear();
        mesh->localMin = mesh->localMax = glm::vec2(0.0f);
        return;
    }
    if (indexCount % 3 != 0) {
        ES_LOG_WARN("mesh2d_setGeometry: indexCount {} is not a triangle list; rejected", indexCount);
        return;
    }

    const f32* posUv = boundarySpan<f32>(posUvPtr, static_cast<u64>(vertexCount) * 4, "mesh2d_setGeometry.posUv");
    const u32* colors = colorsPtr ? boundarySpan<u32>(colorsPtr, vertexCount, "mesh2d_setGeometry.colors") : nullptr;
    const u32* indices = boundarySpan<u32>(indicesPtr, indexCount, "mesh2d_setGeometry.indices");
    if (!posUv || !indices || (colorsPtr && !colors)) return;

    for (u32 i = 0; i < indexCount; ++i) {
        if (indices[i] >= vertexCount) {
            ES_LOG_WARN("mesh2d_setGeometry: index {} out of range (vertexCount {}); rejected",
                        indices[i], vertexCount);
            return;
        }
    }

    mesh->vertices.resize(vertexCount);
    glm::vec2 mn(posUv[0], posUv[1]);
    glm::vec2 mx = mn;
    for (u32 v = 0; v < vertexCount; ++v) {
        auto& out = mesh->vertices[v];
        out.position = { posUv[v * 4 + 0], posUv[v * 4 + 1] };
        out.uv = { posUv[v * 4 + 2], posUv[v * 4 + 3] };
        out.color = colors ? colors[v] : 0xFFFFFFFFu;
        mn = glm::min(mn, out.position);
        mx = glm::max(mx, out.position);
    }
    mesh->indices.assign(indices, indices + indexCount);
    mesh->localMin = mn;
    mesh->localMax = mx;
}

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->update();
        const auto st = rm->getStats();
        ES_PROFILE_COUNTER("res.textures", st.textureCount);
        ES_PROFILE_COUNTER("res.cacheHits", st.cacheHits);
        ES_PROFILE_COUNTER("res.cacheMisses", st.cacheMisses);
    }

    if (g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
    }

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    g_device->setViewport(0, 0, static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));

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

    const auto& cc = ctx().state().clear_color;
    g_renderFrame->begin(viewProjection, 0, RenderFrame::PassClear{true, true, cc});
    g_renderFrame->collectAll(registry);
    g_renderFrame->end();
}

void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                           uintptr_t matrixPtr) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->update();
        const auto st = rm->getStats();
        ES_PROFILE_COUNTER("res.textures", st.textureCount);
        ES_PROFILE_COUNTER("res.cacheHits", st.cacheHits);
        ES_PROFILE_COUNTER("res.cacheMisses", st.cacheMisses);
    }

    if (g_transformSystem) {
        esengine::World w{registry, ctx().services(), 0.0f};
        g_transformSystem->update(w);
    }

    ctx().state().viewport_width = static_cast<u32>(viewportWidth);
    ctx().state().viewport_height = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    g_device->setViewport(0, 0, static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));

    const f32* matrixData = boundarySpan<f32>(matrixPtr, 16, "renderFrameWithMatrix.matrix");
    if (!matrixData) return;
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    const auto& cc = ctx().state().clear_color;
    g_renderFrame->begin(viewProjection, 0, RenderFrame::PassClear{true, true, cc});
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

void renderer_beginFrame(f32 elapsedSec) {
    ctx().state().transforms_updated = false;
    if (auto* rc = ctx().tryGet<RenderContext>()) {
        rc->setFrameTime(elapsedSec, g_viewportWidth, g_viewportHeight);
    }
}

// The pass's load-op rides begin: clearFlags bit0 = color, bit1 = depth; the color
// value and an optional region (w == 0 = full target) come with it, so no sticky
// clear state exists anywhere between TS and the device.
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle, i32 clearFlags,
                    f32 r, f32 g, f32 b, f32 a,
                    i32 clearX, i32 clearY, u32 clearW, u32 clearH) {
    if (!g_renderFrame) return;

    const f32* matrixData = boundarySpan<f32>(matrixPtr, 16, "renderer_begin.matrix");
    if (!matrixData) return;
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection, targetHandle,
                         RenderFrame::PassClear{(clearFlags & 1) != 0, (clearFlags & 2) != 0,
                                                glm::vec4(r, g, b, a),
                                                clearX, clearY, clearW, clearH});
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

// Painter order within a sorting layer is the order the render plugins iterate
// the ECS pools, which is storage order — so a scene draws in its authored entity
// order only because loading it spawns in that order. This is the entry point that
// re-establishes the order on an ALREADY populated registry (the editor moving a
// row in the outliner, a game bringing a card to the front): the same picture a
// reload would produce, without respawning anything.
void renderer_setEntityDrawOrder(ecs::Registry& registry, uintptr_t entitiesPtr, u32 count) {
    if (entitiesPtr == 0 || count == 0) return;
    const u32* raw = boundarySpan<u32>(entitiesPtr, count, "renderer_setEntityDrawOrder.entities");
    if (!raw) return;
    std::vector<Entity> order;
    order.reserve(count);
    for (u32 i = 0; i < count; ++i) order.push_back(Entity::fromRaw(raw[i]));
    ecs::applySceneEntityOrder(registry, order.data(), order.size());
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

// The entity crosses the wasm boundary as a raw u32 (Embind has no registered
// binding for esengine::Entity — calling with it throws "unbound types"). Rebuild
// the Entity C++-side, matching particle_set_color_lut/set_size_lut below.
void particle_play(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->play(Entity::fromRaw(entity));
}

void particle_stop(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->stop(Entity::fromRaw(entity));
}

void particle_reset(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->reset(Entity::fromRaw(entity));
}

u32 particle_getAliveCount(u32 entity) {
    if (!g_particleSystem) return 0;
    return g_particleSystem->aliveCount(Entity::fromRaw(entity));
}

void particle_set_color_lut(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setColorLut(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}

void particle_set_size_lut(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setSizeLut(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}
#endif

void trail_update(ecs::Registry& registry, f32 dt) {
    if (!g_trailSystem) return;
    g_trailSystem->update(registry, dt);
}

// The entity crosses the wasm boundary as a raw u32 (Embind has no Entity binding);
// rebuild it C++-side, matching particle_play/stop above.
void trail_clear(ecs::Registry& registry, u32 entity) {
    if (!g_trailSystem) return;
    (void)registry;
    g_trailSystem->clear(Entity::fromRaw(entity));
}

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
    return target ? static_cast<u32>(target->getDepthTexture()) : 0;
}

void renderer_releaseTarget(u32 handle) {
    if (!g_renderFrame) return;
    g_renderFrame->targetManager().release(handle);
}

u32 renderer_getTargetTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? static_cast<u32>(target->getColorTexture()) : 0;
}

u32 renderer_getDrawCalls() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().draw_calls;
}

#ifdef __EMSCRIPTEN__
emscripten::val renderer_getLiveObjects() {
    auto* device = g_device;
    // Null rather than zeros: with no device there is nothing to report, and a
    // census that recorded 0 live textures would read as "everything was freed".
    if (!device) return emscripten::val::null();
    const GfxLiveObjects live = device->liveObjects();
    auto out = emscripten::val::object();
    out.set("buffers", static_cast<f64>(live.buffers));
    out.set("textures", static_cast<f64>(live.textures));
    out.set("programs", static_cast<f64>(live.programs));
    out.set("layouts", static_cast<f64>(live.layouts));
    out.set("pipelines", static_cast<f64>(live.pipelines));
    out.set("renderTargets", static_cast<f64>(live.renderTargets));
    out.set("readbacks", static_cast<f64>(live.readbacks));
    return out;
}
#endif  // __EMSCRIPTEN__

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

f32 renderer_getGpuTimeMs() {
    if (!g_renderFrame) return -1.0f;
    return g_renderFrame->stats().gpu_time_ms;
}

void engine_setCpuProfiling(bool on) {
    FrameProfiler::get().setEnabled(on);
}

std::string engine_getCpuScopes() {
    return FrameProfiler::get().lastJson();
}

std::string engine_getCounters() {
    return FrameProfiler::get().lastCountersJson();
}

std::string engine_getGpuScopes() {
    return FrameProfiler::get().lastGpuJson();
}

f64 renderer_getTextureBytes() {
    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        return static_cast<f64>(rm->getStats().textureBytes);
    }
    return 0.0;
}

void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a) {
    ctx().state().clear_color = glm::vec4(r, g, b, a);
}

void renderer_setViewport(i32 x, i32 y, i32 w, i32 h) {
    g_device->setViewport(x, y, static_cast<u32>(w), static_cast<u32>(h));
}

void renderer_setYSortLayers(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setYSortLayers(mask);
}

// The 2.5D opt-in, per sorting layer. Same shape as setYSortLayers because it is
// the same kind of declaration: how a layer resolves the draws inside it.
void renderer_setDepthLayers(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setDepthLayers(mask);
}

// Which layers the NEXT collect draws. Set per camera, before renderer_submitAll.
void renderer_setCullingMask(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setCullingMask(mask);
}

void renderer_setColorSpace(u32 linear) {
    // Valid pre-init: the global reaches every later shader compile, and
    // RenderFrame::init adopts it. A live frame applies immediately (editor
    // realms reset it per session, mirroring renderer_setYSortLayers).
    resource::ShaderParser::setLinearColorSpace(linear != 0);
    if (auto* frame = g_renderFrame) frame->setColorSpace(linear != 0);
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

#ifdef __EMSCRIPTEN__
// Every Canvas, so the caller can pick one that belongs to a RUNNING scene. Scene
// membership (SceneOwner) is an SDK component the engine cannot see, which is why
// this reports rather than decides — the camera query has the same shape.
emscripten::val registry_getCanvasEntities(ecs::Registry& registry) {
    auto view = registry.view<ecs::Canvas>();
    auto result = emscripten::val::array();
    u32 idx = 0;
    for (auto entity : view) {
        result.set(idx++, entity.id());
    }
    return result;
}
#endif

#ifdef __EMSCRIPTEN__
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
#endif

u32 registry_getGeneration(ecs::Registry& registry, u32 entity) {
    return Entity::fromRaw(entity).generation();
}

void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu) {
    if (count < 0) return;
    const float* buffer = boundarySpan<f32>(bufferPtr, static_cast<u64>(count) * 4, "registry_batchSyncPhysicsTransforms");
    if (!buffer) return;
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

// Lands the snapshot's async readback: 0 = pending (poll again after yielding
// to the event loop), 1 = getSnapshot* serve the pixels, 2 = none/failed.
i32 renderer_pollSnapshotReadback() {
    return g_renderFrame ? g_renderFrame->pollSnapshotReadback() : 2;
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

void renderer_renderMaterialPreview(u32 materialId, i32 w, i32 h) {
    if (!g_renderFrame || w <= 0 || h <= 0) return;

    // A throwaway one-sprite scene: a 2×2 quad filling the ortho [-1,1] with the material, lit by
    // one white directional light so Lit2D materials preview lit (Unlit2D ignores it).
    ecs::Registry reg;
    auto quad = reg.create();
    reg.emplace<ecs::Transform>(quad);
    auto& sprite = reg.emplace<ecs::Sprite>(quad);
    sprite.material = materialId;
    sprite.size = glm::vec2(2.0f, 2.0f);

    auto light = reg.create();
    reg.emplace<ecs::Transform>(light);
    reg.emplace<ecs::Light2D>(light).type = static_cast<i32>(ecs::Light2DType::Directional);

    if (g_transformSystem) {
        esengine::World world{reg, ctx().services(), 0.0f};
        g_transformSystem->update(world);
    }

    const glm::mat4 vp = glm::ortho(-1.0f, 1.0f, -1.0f, 1.0f, -1.0f, 1.0f);
    g_renderFrame->renderToTarget(reg, vp, static_cast<u32>(w), static_cast<u32>(h));
}

// Same 0/1/2 contract as renderer_pollSnapshotReadback, for the material preview.
i32 renderer_pollPreviewReadback() {
    return g_renderFrame ? g_renderFrame->pollPreviewReadback() : 2;
}

uintptr_t renderer_getPreviewPtr() {
    return g_renderFrame ? reinterpret_cast<uintptr_t>(g_renderFrame->getPreviewPixels()) : 0;
}

u32 renderer_getPreviewSize() {
    return g_renderFrame ? g_renderFrame->getPreviewSize() : 0;
}

u32 renderer_getPreviewWidth() {
    return g_renderFrame ? g_renderFrame->getPreviewWidth() : 0;
}

u32 renderer_getPreviewHeight() {
    return g_renderFrame ? g_renderFrame->getPreviewHeight() : 0;
}

void renderer_setTextureParams(u32 textureId, i32 minFilter, i32 magFilter, i32 wrapS, i32 wrapT) {
    auto* device = g_device;
    if (!device) return;
    device->setTextureParams(
        TextureHandle{textureId},
        static_cast<TextureFilter>(minFilter),
        static_cast<TextureFilter>(magFilter),
        static_cast<TextureWrap>(wrapS),
        static_cast<TextureWrap>(wrapT)
    );
}

}  // namespace esengine

