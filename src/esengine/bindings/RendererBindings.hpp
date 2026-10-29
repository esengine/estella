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


void renderer_init(u32 width, u32 height);
void renderer_resize(u32 width, u32 height);
void renderer_setQualityBudgets(u32 atlasSize, u32 cellSize, u32 cascades, u32 particleLimit);
void renderer_setShadowDistance(f32 distance);
void renderer_setShadow2DSoftSamples(u32 samples);
void renderer_setDepthPrepass(bool on);
/**
 * Draws whose shader the browser is still compiling are left out, not waited for: a frame never stops for a compile, and what needs the shader
 * appears when it is done (several at once compile side by side, which the waiting form never gives them). Off (the default) is a frame that waits.
 */
void renderer_setAsyncShaderCompile(bool on);
/** How many shaders are still compiling in the background; a loading screen waits for it to reach 0. */
u32 renderer_getPendingShaders();
void renderer_setPlanarReflectionQuality(f32 scale, u32 maxSize, f32 updatesPerSecond);
std::string renderer_getPlanarReflectionStatus(u32 view, u32 entity);
/**
 * The editor view's lighting. mode 0 = the scene's own lights (the default, and the
 * only one a packaged build ever has); 1 = studio: a neutral sky, a key and a fill, in
 * their place. View state — nothing here is saved with a scene.
 */
void renderer_setViewLighting(u32 mode, f32 rotationDegrees, f32 keyIntensity, f32 fillIntensity,
                              f32 skyIntensity, bool showSky);
void renderer_beginFrame(f32 elapsedSec);
void renderer_setOrigin(f64 x, f64 y, f64 z);
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle, i32 clearFlags,
                    f32 r, f32 g, f32 b, f32 a,
                    i32 clearX, i32 clearY, u32 clearW, u32 clearH);
void renderer_flush();
void renderer_end();
/// Closes the frame — the pair of beginFrame, and where a borrowed swapchain
/// image goes back. Per FRAME, not per camera (see RenderFrame::endFrame).
void renderer_endFrame();

/// The frame's screen-space overlay, drawn once after every camera and after
/// post: begin with the projection the layout domain reaches pixels through,
/// collect, let the host add its own screen geometry, then declare and run it.
void renderer_beginScreenOverlay(uintptr_t projectionPtr, i32 vpX, i32 vpY, u32 vpW, u32 vpH);
void renderer_submitScreenOverlay(ecs::Registry& registry);
void renderer_endScreenOverlay(u32 targetHandle);
#ifdef ES_ENABLE_BITMAP_TEXT
#endif
/// Geometry posed by a skeletal runtime (Spine, DragonBones): x,y,u,v,r,g,b,a per
/// vertex, drawn as @p entity's, with its material resolved as a Sprite's is.
// Whether the camera being rendered right now would draw this entity's geometry
// at the local extent it promises to stay inside. A fact, not a permission.
void renderer_entityVisibleToCamera(
    ecs::Registry& registry, u32 entity, i32 layer,
    f32 minX, f32 minY, f32 maxX, f32 maxY, uintptr_t outVisiblePtr);

void renderer_submitSkeletalBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth, u32 materialId
);
void renderer_submitSkeletalBatchByEntityEx(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth, u32 materialId, bool premultipliedColor
);
void renderer_submitTextBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth, i32 glyphMode, u32 cullBit
);
/**
 * @name Retained text
 * @brief Glyph quads handed over once and submitted by the engine each frame (see RetainedText.hpp).
 * @{
 */
/// Starts (or replaces) an entity's retained text: the layout's domain, box and order, with its batches to follow. @p autoKind says the glyph
/// pipeline (@p sdf) was picked from the entity's world scale, which the engine then watches in place of the script.
void renderer_retainedTextBegin(
    u32 entity, i32 sdf, i32 screen, i32 hasBox, i32 layer, f32 boxWidth, f32 boxHeight, i32 autoKind
);
/// One batch of glyph quads of the entity begun last: TEXT_VERTEX_FLOATS floats a vertex, whole quads, drawn from atlas page @p pageId and
/// read as @p glyphMode says (TextGlyphMode; 0 is a plain RGBA page, 1 a distance field).
void renderer_retainedTextBatch(
    u32 entity, uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount, u32 pageId, i32 glyphMode
);
/// Forgets an entity's retained text.
void renderer_retainedTextClear(u32 entity);
/**
 * @brief The entities whose retained text no longer matches the world, written to @p outPtr as u32s.
 * @details Stale means the entity's domain or box is not the one it was laid out for, or its world scale now picks the other glyph pipeline. An entity that is gone is dropped here and not reported.
 * @return How many were written, at most @p capacity.
 */
i32 renderer_retainedTextStale(ecs::Registry& registry, uintptr_t outPtr, i32 capacity);
/// Submits every retained label of one domain into the open list: its matrix, order, opacity and cull bit read off the entity, its quads clipped
/// against @p projectionPtr (16 floats; 0 for no clipping).
void renderer_retainedTextSubmit(ecs::Registry& registry, i32 screen, uintptr_t projectionPtr);
/** @} */
void meshRenderer_setGeometry(
    ecs::Registry& registry, u32 entity,
    uintptr_t posUvPtr, u32 vertexCount,
    uintptr_t colorsPtr,
    uintptr_t indicesPtr, u32 indexCount
);
/** @brief The placements of a MeshInstances: sixteen f32 an instance (see the component). Empty clears the set. */
void meshInstances_set(ecs::Registry& registry, u32 entity, uintptr_t dataPtr, u32 count);
/** @brief Geometry from an .esmesh channel table; returns its handle, 0 on failure. */
u32 mesh_createFromChannels(uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                            uintptr_t vertexPtr, u32 vertexBytes,
                            uintptr_t indexPtr, u32 indexCount,
                            f32 minX, f32 minY, f32 minZ,
                            f32 maxX, f32 maxY, f32 maxZ,
                            uintptr_t bindPtr, u32 bindFloats,
                            uintptr_t morphPtr, u32 morphFloats,
                            u32 morphTargets, u32 morphNormals);
/** @brief Releases a mesh and the buffers it owns. */
/** @brief Puts replayed geometry behind an EXISTING mesh handle after a device
 *         loss. Returns @p targetHandle on success, 0 on failure — never a new
 *         handle, which is the whole reason this is not mesh_createFromChannels. */
u32 mesh_rematerializeFromChannels(u32 targetHandle,
                                   uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                                   uintptr_t vertexPtr, u32 vertexBytes,
                                   uintptr_t indexPtr, u32 indexCount,
                                   f32 minX, f32 minY, f32 minZ,
                                   f32 maxX, f32 maxY, f32 maxZ,
                                   uintptr_t bindPtr, u32 bindFloats,
                                   uintptr_t morphPtr, u32 morphFloats,
                                   u32 morphTargets, u32 morphNormals);

void mesh_release(u32 meshHandle);

/** @brief Registers a baked environment (27 irradiance floats + a reflection atlas,
 *         which holds `columns` pyramids side by side). */
u32 environment_create(uintptr_t shPtr, u32 specularHandle, f32 faceSize, u32 mipCount,
                       f32 maxRange, u32 columns);
void environment_setSky(u32 environmentHandle, u32 skyHandle);
/** @brief Gives an environment its separated sun: the sky's irradiance without it
 *         (27 floats), the direction toward it and its irradiance over pi. */
void environment_setSun(u32 environmentHandle, uintptr_t skyShPtr, f32 dx, f32 dy, f32 dz,
                        f32 r, f32 g, f32 b);

/** @brief Releases an environment; its atlas is an ordinary texture and outlives it. */
void environment_release(u32 environmentHandle);

/** @brief Registers a grid of baked irradiance: `x*y*z*27` floats, x fastest. */
u32 probe_volume_create(i32 resX, i32 resY, i32 resZ, uintptr_t shPtr);

/** @brief Releases a probe volume. */
void probe_volume_release(u32 volumeHandle);
/** @brief Freezes every MeshRenderer in the world; returns how many were frozen. */
u32 meshRenderer_makeAllResident(ecs::Registry& registry);
/** @brief Points every MeshRenderer at one resident mesh; returns how many. */
u32 meshRenderer_setMeshAll(ecs::Registry& registry, u32 meshHandle);
/** @brief Points every MeshRenderer at one material; returns how many. */
u32 meshRenderer_setMaterialAll(ecs::Registry& registry, u32 materialId);
#ifdef ES_ENABLE_PARTICLES
#endif
void renderer_updateTransforms(ecs::Registry& registry);
void renderer_setEntityDrawOrder(ecs::Registry& registry, uintptr_t entitiesPtr, u32 count);
void renderer_submitAll(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH);
#ifdef ES_ENABLE_PARTICLES
void particle_update(ecs::Registry& registry, f32 dt);
u32 particle_collisionQueryCount();
// @heapreturn esengine::particle_collisionQueryCount() * 40
uintptr_t particle_collisionQueries();
u32 particle_collisionEventCount();
// @heapreturn esengine::particle_collisionEventCount() * 56
uintptr_t particle_collisionEvents();
u32 particle_collisionStatsCount();
// @heapreturn esengine::particle_collisionStatsCount() * 40
uintptr_t particle_collisionStats();
void particle_collisionResolve(ecs::Registry& registry, uintptr_t ptr, u32 count);
void particle_collisionSetBudget(u32 queries, u32 events, bool debug);
void particle_play(ecs::Registry& registry, u32 entity);
void particle_stop(ecs::Registry& registry, u32 entity);
void particle_reset(ecs::Registry& registry, u32 entity);
u32 particle_getAliveCount(u32 entity);
void particle_set_color_lut(u32 entity, uintptr_t ptr, i32 count);
void particle_set_size_lut(u32 entity, uintptr_t ptr, i32 count);
/** Speed-over-life multiplier LUT: scales the step, never the forces. */
void particle_set_speed_lut(u32 entity, uintptr_t ptr, i32 count);
#endif
void trail_update(ecs::Registry& registry, f32 dt);
void trail_clear(ecs::Registry& registry, u32 entity);
/** Advances every SpringBone chain: call after the animation has posed the skeleton, before the frame is drawn. */
void springbone_update(ecs::Registry& registry, f32 dt);
/** Puts a chain back at its animated pose on its next frame (a teleport, a respawn). */
void springbone_reset(ecs::Registry& registry, u32 entity);
/** Copies a chain's particles for the editor to draw and returns how many (seven floats each; see SpringBoneSystem::snapshot); read them at springbone_snapshotData(). */
/** Gives a chain's bones back as the animation had them and forgets its state: what ends a preview. */
void springbone_release(ecs::Registry& registry, u32 entity);
u32 springbone_snapshot(ecs::Registry& registry, u32 entity);
u32 springbone_snapshotCount();
// @heapreturn esengine::springbone_snapshotCount() * 28
uintptr_t springbone_snapshotData();
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
f64 renderer_getEstimatedGpuBytes();

/** @brief The renderer's current program-readiness epoch. A readiness record
 *         stamped with an older one names programs that may be gone. */
f64 renderer_programEpoch();

/** @brief Which generation of the GPU device is current. Not part of a readiness
 *         claim — the guard that says the claim was taken on one device. */
f64 renderer_deviceGeneration();

/**
 * @brief Readies the mesh programs a prepared cell requires, and reports what a
 *        readiness claim must record (layout in the .cpp).
 * @details A generation or epoch that moves underneath voids the claim: one
 *          assembled from two reads of different worlds is worse than none.
 */
void engine_prepareMeshPrograms(u32 rowsPtr, u32 count, u32 outPtr);
void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a);
void renderer_setViewport(i32 x, i32 y, i32 w, i32 h);
void renderer_setYSortLayers(u32 mask);
/** 2.5D opt-in: bit i ⇒ layer i resolves by real depth. Same shape as y-sort. */
void renderer_setDepthLayers(u32 mask);
/** Sorting layers the next collect draws (bit i = layer i). Set per camera. */
void renderer_setCullingMask(u32 mask);
/** Names the view the next collect looks from, which its LOD levels are remembered
 *  under. Set per camera, before renderer_submitAll; 0 = the shared default view. */
void renderer_setViewId(u32 view);

/**
 * @brief What @p view decided about @p entity's LOD, into four floats at
 *        @p outPtr: level, the level the bare thresholds ask for, how many
 *        stand-ins are reachable, and the screen size measured.
 *
 * @details A level of -1 is culled. Returns 0 when this view has not measured the
 *          entity, which is not level 0 and must not be shown as one.
 */
i32 renderer_lodInspect(u32 view, u32 entity, uintptr_t outPtr);

/**
 * @brief Draw @p level for @p entity in @p view instead of the chosen one; a
 *        negative @p level goes back to the view's own choice.
 */
void renderer_setLodPreview(u32 view, u32 entity, i32 level);

/**
 * @brief Shade a view's meshes as authored (0), as neutral clay (1) or as flat albedo (2).
 * @details View state, like the LOD preview beside it: the same scene drawn through
 *          another view keeps its own look. Out-of-range modes mean authored.
 */
void renderer_setViewShading(u32 view, i32 mode);

/**
 * @brief Give meshes realized from now on an edge buffer, for a wireframe view.
 * @details A second index buffer per mesh, so off unless an editor asks, and asked BEFORE
 *          the assets load: a mesh realized earlier has none and is drawn filled instead.
 */
void renderer_setMeshEdgeBuffers(bool enabled);

/**
 * @brief Colour one skinned entity in a view by how much a joint moves each vertex.
 * @details @p joint indexes the mesh's own bind matrices, the order its Joints channel uses; a
 *          negative joint goes back to no entity. A view that is not the editor's never asks.
 */
void renderer_setViewSkinWeights(u32 view, u32 entity, i32 joint);

/**
 * @brief What the light cap did to @p entity last frame, into nine floats at
 *        @p outPtr: accepted, refusal, limit, requested, refusedCount, then whether
 *        a light cast the environment's sun and the aim it took.
 *
 * @details Returns 0 before any frame has collected lights, which is not a frame
 *          that refused none.
 */
i32 renderer_lightStatus(u32 entity, uintptr_t outPtr);

/**
 * @brief What the shadow atlas gave @p entity last frame, into five floats at
 *        @p outPtr: requested, granted, refusal, deniedCasters, reducedCasters.
 *
 * @details `granted` below `requested` and above zero is a REDUCTION — a sun that
 *          kept two cascades of four still casts. Zero is a denial. Returns 0
 *          when this entity asked the atlas for nothing.
 */
i32 renderer_shadowStatus(u32 entity, uintptr_t outPtr);
/** Project colorSpace: 1 = linear-light rendering (set before shaders compile). */
void renderer_setColorSpace(u32 linear);
void renderer_diagnose();


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
uintptr_t renderer_getCapturedTextures();
u32 renderer_getCapturedTextureCount();
u32 renderer_getCapturedPassCount();
bool renderer_hasCapturedData();

void renderer_replayToDrawCall(i32 drawCallIndex);
bool renderer_snapshotMatchesCapture();
i32 renderer_pollSnapshotReadback();
uintptr_t renderer_getSnapshotPtr();
u32 renderer_getSnapshotSize();
u32 renderer_getSnapshotWidth();
u32 renderer_getSnapshotHeight();

/** The captured frame and the replay snapshot copied into the caller's buffer,
 *  for a host whose script cannot read engine memory (native). False when there
 *  is nothing to copy or @p destSize is too small for it. */
bool renderer_copyCapturedRecords(uintptr_t dest, u32 destSize);
bool renderer_copyCapturedEntities(uintptr_t dest, u32 destSize);
bool renderer_copyCapturedTextures(uintptr_t dest, u32 destSize);
bool renderer_copySnapshot(uintptr_t dest, u32 destSize);

// A skeletal preview is owned by whoever created it: every call names the
// handle, so two of them cannot reach each other and there is no "current" one.
u32 renderer_createSkeletalPreview(i32 w, i32 h);
i32 renderer_submitSkeletalPreviewBatch(
    u32 preview,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode, uintptr_t transformPtr,
    i32 layer, f32 depth, u32 materialId);
i32 renderer_submitSkeletalPreviewBatchEx(
    u32 preview,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode, uintptr_t transformPtr,
    i32 layer, f32 depth, u32 materialId, bool premultipliedColor);
i32 renderer_renderSkeletalPreview(u32 preview, uintptr_t viewProjectionPtr);
i32 renderer_pollSkeletalPreview(u32 preview);
uintptr_t renderer_getSkeletalPreviewPtr(u32 preview);
u32 renderer_getSkeletalPreviewSize(u32 preview);
u32 renderer_getSkeletalPreviewWidth(u32 preview);
u32 renderer_getSkeletalPreviewHeight(u32 preview);
void renderer_destroySkeletalPreview(u32 preview);

void renderer_renderMaterialPreview(u32 materialId, i32 w, i32 h, u32 meshId, u32 textureId);
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
u32 registry_watchEntityChanges(ecs::Registry& registry);
void registry_unwatchEntityChanges(ecs::Registry& registry, u32 reader);
double registry_entityChangeSequence(ecs::Registry& registry);
double registry_entityChangeResetEpoch(ecs::Registry& registry);
double registry_componentMutationRevision(ecs::Registry& registry, u32 component, bool topology);
// Output contains entity/flags/component-type rows. Returns -1 when the cursor or capacity
// cannot cover the retained history; the caller must perform a full refresh.
int registry_readEntityChanges(ecs::Registry& registry, double after, uintptr_t outputPtr, int capacity);
// Read composed world poses for valid, active entities with a Transform.
// Output has room for count EntityPose2D rows; returns the number written.
int registry_readWorldPoses2D(ecs::Registry& registry, uintptr_t entitiesPtr, int count, uintptr_t outputPtr);
void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu);

}  // namespace esengine

