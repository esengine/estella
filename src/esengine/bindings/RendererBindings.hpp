#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"
#include <string>

namespace emscripten {
    class val;
}

namespace esengine {

namespace ecs {
    class Registry;
}

#ifdef ES_ENABLE_SPINE
struct SpineBounds {
    f32 x = 0;
    f32 y = 0;
    f32 width = 0;
    f32 height = 0;
    bool valid = false;
};

SpineBounds getSpineBounds(ecs::Registry& registry, Entity entity);

void spine_update(ecs::Registry& registry, f32 dt);
bool spine_play(Entity entity, const std::string& animation, bool loop, i32 track);
bool spine_addAnimation(Entity entity, const std::string& animation, bool loop, f32 delay, i32 track);
bool spine_setSkin(Entity entity, const std::string& skinName);
emscripten::val spine_getBonePosition(Entity entity, const std::string& boneName);
bool spine_hasInstance(Entity entity);
void spine_reloadAssets(ecs::Registry& registry);
emscripten::val spine_getAnimations(Entity entity);
emscripten::val spine_getSkins(Entity entity);
#endif

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight);
void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                            uintptr_t matrixPtr);

void renderer_init(u32 width, u32 height);
void renderer_resize(u32 width, u32 height);
void renderer_beginFrame();
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle);
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
    Entity entity, i32 layer, f32 depth
);
void spine_setNeedsReload(ecs::Registry& registry, Entity entity, bool value);
#endif
#ifdef ES_ENABLE_PARTICLES
void renderer_submitParticles(ecs::Registry& registry);
#endif
void renderer_updateTransforms(ecs::Registry& registry);
void renderer_submitAll(ecs::Registry& registry, u32 skipFlags, i32 vpX, i32 vpY, i32 vpW, i32 vpH);
#ifdef ES_ENABLE_PARTICLES
void particle_update(ecs::Registry& registry, f32 dt);
void particle_play(ecs::Registry& registry, Entity entity);
void particle_stop(ecs::Registry& registry, Entity entity);
void particle_reset(ecs::Registry& registry, Entity entity);
u32 particle_getAliveCount(Entity entity);
#endif
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
void renderer_setDeltaTime(f32 dt);
void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a);
void renderer_setViewport(i32 x, i32 y, i32 w, i32 h);
void renderer_setScissor(i32 x, i32 y, i32 w, i32 h, bool enable);
void renderer_clearBuffers(i32 flags);
void renderer_diagnose();
void renderer_setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h);
void renderer_clearEntityClipRect(u32 entity);
void renderer_clearAllClipRects();

void renderer_clearStencil();
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
uintptr_t renderer_getSnapshotPtr();
u32 renderer_getSnapshotSize();
u32 renderer_getSnapshotWidth();
u32 renderer_getSnapshotHeight();

i32 registry_getCanvasEntity(ecs::Registry& registry);
emscripten::val registry_getCameraEntities(ecs::Registry& registry);
emscripten::val getChildEntities(ecs::Registry& registry, u32 entity);
u32 registry_getGeneration(ecs::Registry& registry, u32 entity);
u32 registry_getSchemaPoolVersion(ecs::Registry& registry, u32 poolId);
void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu);

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
