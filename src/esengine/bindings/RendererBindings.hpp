// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once


#include "../core/Types.hpp"
#include <string>

// The value type embind returns for array/object results. Web-only: a native
// build compiles this same TU (see cmake/ESEngineSources.cmake) and simply does
// not carry the entry points that return one.
#ifdef __EMSCRIPTEN__
namespace emscripten {
    class val;
}
#endif

namespace esengine {

namespace ecs {
    class Registry;
}

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight);
void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                            uintptr_t matrixPtr);

void renderer_init(u32 width, u32 height);
void renderer_resize(u32 width, u32 height);
void renderer_beginFrame(f32 elapsedSec);
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle, i32 clearFlags,
                    f32 r, f32 g, f32 b, f32 a,
                    i32 clearX, i32 clearY, u32 clearW, u32 clearH);
void renderer_flush();
void renderer_end();
void renderer_submitSprites(ecs::Registry& registry);
void renderer_submitUIElements(ecs::Registry& registry);
#ifdef ES_ENABLE_BITMAP_TEXT
void renderer_submitBitmapText(ecs::Registry& registry);
#endif
void renderer_submitShapes(ecs::Registry& registry);
#ifdef ES_ENABLE_SPINE
void renderer_submitSpine(ecs::Registry& registry);
void renderer_submitSpineBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth
);
void renderer_submitSkeletalBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth
);
#endif
void renderer_submitTextBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth, i32 sdf, u32 cullBit
);
void mesh2d_setGeometry(
    ecs::Registry& registry, u32 entity,
    uintptr_t posUvPtr, u32 vertexCount,
    uintptr_t colorsPtr,
    uintptr_t indicesPtr, u32 indexCount
);
#ifdef ES_ENABLE_PARTICLES
void renderer_submitParticles(ecs::Registry& registry);
#endif
void renderer_updateTransforms(ecs::Registry& registry);
void renderer_setEntityDrawOrder(ecs::Registry& registry, uintptr_t entitiesPtr, u32 count);
void renderer_submitAll(ecs::Registry& registry, u32 skipFlags, i32 vpX, i32 vpY, i32 vpW, i32 vpH);
#ifdef ES_ENABLE_PARTICLES
void particle_update(ecs::Registry& registry, f32 dt);
void particle_play(ecs::Registry& registry, u32 entity);
void particle_stop(ecs::Registry& registry, u32 entity);
void particle_reset(ecs::Registry& registry, u32 entity);
u32 particle_getAliveCount(u32 entity);
void particle_set_color_lut(u32 entity, uintptr_t ptr, i32 count);
void particle_set_size_lut(u32 entity, uintptr_t ptr, i32 count);
#endif
void trail_update(ecs::Registry& registry, f32 dt);
void trail_clear(ecs::Registry& registry, u32 entity);
void renderer_setStage(i32 stage);
u32 renderer_createTarget(u32 width, u32 height, i32 flags);
u32 renderer_getTargetDepthTexture(u32 handle);
void renderer_releaseTarget(u32 handle);
u32 renderer_getTargetTexture(u32 handle);
u32 renderer_getDrawCalls();
u32 renderer_getTriangles();
u32 renderer_getSprites();
#ifdef ES_ENABLE_SPINE
u32 renderer_getSpine();
#endif
u32 renderer_getText();
u32 renderer_getMeshes();
u32 renderer_getCulled();
f32 renderer_getGpuTimeMs();
void engine_setCpuProfiling(bool on);
std::string engine_getCpuScopes();
std::string engine_getCounters();
std::string engine_getGpuScopes();
f64 renderer_getTextureBytes();
void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a);
void renderer_setViewport(i32 x, i32 y, i32 w, i32 h);
void renderer_setYSortLayers(u32 mask);
/** 2.5D opt-in: bit i ⇒ layer i resolves by real depth. Same shape as y-sort. */
void renderer_setDepthLayers(u32 mask);
/** Sorting layers the next collect draws (bit i = layer i). Set per camera. */
void renderer_setCullingMask(u32 mask);
/** Project colorSpace: 1 = linear-light rendering (set before shaders compile). */
void renderer_setColorSpace(u32 linear);
void renderer_diagnose();
void renderer_setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h);
void renderer_clearEntityClipRect(u32 entity);
void renderer_clearAllClipRects();

void renderer_setEntityStencilMask(u32 entity, i32 refValue);
void renderer_setEntityStencilTest(u32 entity, i32 refValue);
void renderer_clearEntityStencilMask(u32 entity);
void renderer_clearAllStencilMasks();

void gl_enableErrorCheck(bool enabled);
u32 gl_checkErrors(const std::string& context);

void renderer_captureNextFrame();
u32 renderer_getCapturedFrameSize();
uintptr_t renderer_getCapturedFrameData();
uintptr_t renderer_getCapturedEntities();
u32 renderer_getCapturedEntityCount();
u32 renderer_getCapturedCameraCount();
bool renderer_hasCapturedData();

void renderer_replayToDrawCall(i32 drawCallIndex);
i32 renderer_pollSnapshotReadback();
uintptr_t renderer_getSnapshotPtr();
u32 renderer_getSnapshotSize();
u32 renderer_getSnapshotWidth();
u32 renderer_getSnapshotHeight();

void renderer_renderMaterialPreview(u32 materialId, i32 w, i32 h);
i32 renderer_pollPreviewReadback();
uintptr_t renderer_getPreviewPtr();
u32 renderer_getPreviewSize();
u32 renderer_getPreviewWidth();
u32 renderer_getPreviewHeight();

void renderer_setTextureParams(u32 textureId, i32 minFilter, i32 magFilter, i32 wrapS, i32 wrapT);

i32 registry_getCanvasEntity(ecs::Registry& registry);
#ifdef __EMSCRIPTEN__
emscripten::val registry_getCanvasEntities(ecs::Registry& registry);
emscripten::val registry_getCameraEntities(ecs::Registry& registry);
emscripten::val getChildEntities(ecs::Registry& registry, u32 entity);
#endif
u32 registry_getGeneration(ecs::Registry& registry, u32 entity);
void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu);

}  // namespace esengine

