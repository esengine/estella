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
/// Geometry posed by a skeletal runtime (Spine, DragonBones): x,y,u,v,r,g,b,a per
/// vertex, drawn as @p entity's, with its material resolved as a Sprite's is.
void renderer_submitSkeletalBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth, u32 materialId
);
void renderer_submitTextBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth, i32 sdf, u32 cullBit
);
void meshRenderer_setGeometry(
    ecs::Registry& registry, u32 entity,
    uintptr_t posUvPtr, u32 vertexCount,
    uintptr_t colorsPtr,
    uintptr_t indicesPtr, u32 indexCount
);
/** @brief Geometry from an .esmesh channel table; returns its handle, 0 on failure. */
u32 mesh_createFromChannels(uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                            uintptr_t vertexPtr, u32 vertexBytes,
                            uintptr_t indexPtr, u32 indexCount,
                            f32 minX, f32 minY, f32 minZ,
                            f32 maxX, f32 maxY, f32 maxZ,
                            uintptr_t bindPtr, u32 bindFloats);
/** @brief Releases a mesh and the buffers it owns. */
void mesh_release(u32 meshHandle);

/** @brief Registers a baked environment (27 irradiance floats + a reflection atlas). */
u32 environment_create(uintptr_t shPtr, u32 specularHandle, f32 faceSize, u32 mipCount,
                       f32 maxRange);

/** @brief Releases an environment; its atlas is an ordinary texture and outlives it. */
void environment_release(u32 environmentHandle);
/** @brief Uploads geometry that stays on the GPU; returns its handle, 0 on failure. */
u32 mesh_create(uintptr_t posUvPtr, u32 vertexCount, uintptr_t colorsPtr,
                uintptr_t indicesPtr, u32 indexCount);
/** @brief Points a MeshRenderer at resident geometry; 0 returns it to its inline payload. */
void meshRenderer_setMesh(ecs::Registry& registry, u32 entity, u32 meshHandle);
/** @brief Freezes a MeshRenderer's inline geometry onto the GPU; returns its handle. */
u32 meshRenderer_makeResident(ecs::Registry& registry, u32 entity);
/** @brief Freezes every MeshRenderer in the world; returns how many were frozen. */
u32 meshRenderer_makeAllResident(ecs::Registry& registry);
/** @brief Points every MeshRenderer at one resident mesh; returns how many. */
u32 meshRenderer_setMeshAll(ecs::Registry& registry, u32 meshHandle);
/** @brief Points every MeshRenderer at one material; returns how many. */
u32 meshRenderer_setMaterialAll(ecs::Registry& registry, u32 materialId);
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
#ifdef __EMSCRIPTEN__
/// GPU objects the device has not destroyed, for the resource census. Null when
/// no device is initialized — absent counters, not zeroed ones.
emscripten::val renderer_getLiveObjects();
/// Local bounds of what a MeshRenderer draws (resident geometry, else the inline
/// payload). Null when it draws nothing — an editor boxes it by its icon then.
emscripten::val meshRenderer_localBounds(ecs::Registry& registry, u32 entity);
#endif
u32 renderer_getTriangles();
u32 renderer_getSprites();
u32 renderer_getSkeletal();
u32 renderer_getText();
u32 renderer_getMeshes();
u32 renderer_getCulled();
f32 renderer_getGpuTimeMs();
void engine_setCpuProfiling(bool on);
/** Reseed the engine's randomness (core/RandomSource.hpp) so a run reproduces.
 *  Unset, every run differs — which is what a player wants of particles. */
void engine_setRandomSeed(u32 seed);
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

/** Books the next completed frame for readback; poll + take it. */
u32 renderer_captureFrame(u32 w, u32 h);
i32 renderer_pollFrameCapture(u32 handle);
bool renderer_takeFrameCapture(u32 handle, uintptr_t dest, u32 destSize);
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
void renderer_renderMeshPreview(u32 meshId, i32 w, i32 h);
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

