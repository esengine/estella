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
#endif

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight);
void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                            uintptr_t matrixPtr);

void renderer_init(u32 width, u32 height);
void renderer_resize(u32 width, u32 height);
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle);
void renderer_flush();
void renderer_end();
void renderer_submitSprites(ecs::Registry& registry);
void renderer_submitBitmapText(ecs::Registry& registry);
#ifdef ES_ENABLE_SPINE
void renderer_submitSpine(ecs::Registry& registry);
#endif
void renderer_submitTriangles(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    uintptr_t transformPtr);
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

i32 registry_getCanvasEntity(ecs::Registry& registry);
emscripten::val registry_getCameraEntities(ecs::Registry& registry);
emscripten::val getChildEntities(ecs::Registry& registry, u32 entity);

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
