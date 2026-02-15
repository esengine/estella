#ifdef ES_PLATFORM_WEB

#include "RendererBindings.hpp"
#include "EngineContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderStage.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../core/Log.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <emscripten/val.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().isInitialized())
#define g_renderFrame (ctx().renderFrame())
#define g_transformSystem (ctx().transformSystem())
#define g_glErrorCheckEnabled (ctx().glErrorCheckEnabled())
#define g_viewportWidth (ctx().viewportWidth())
#define g_viewportHeight (ctx().viewportHeight())
#ifdef ES_ENABLE_SPINE
#define g_spineSystem (ctx().spineSystem())
#endif

static u32 checkGLErrors(const char* context) {
    if (!g_glErrorCheckEnabled) return 0;
    u32 errorCount = 0;
    GLenum err;
    while ((err = glGetError()) != GL_NO_ERROR) {
        const char* errStr = "UNKNOWN";
        switch (err) {
            case GL_INVALID_ENUM: errStr = "INVALID_ENUM"; break;
            case GL_INVALID_VALUE: errStr = "INVALID_VALUE"; break;
            case GL_INVALID_OPERATION: errStr = "INVALID_OPERATION"; break;
            case GL_INVALID_FRAMEBUFFER_OPERATION: errStr = "INVALID_FRAMEBUFFER_OPERATION"; break;
            case GL_OUT_OF_MEMORY: errStr = "OUT_OF_MEMORY"; break;
        }
        ES_LOG_ERROR("[GL Error] {} at: {}", errStr, context);
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
#endif

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderFrame) return;

    if (auto* rm = ctx().resourceManager()) {
        rm->update();
    }

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }
#endif

    ctx().setViewport(static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    glViewport(0, 0, viewportWidth, viewportHeight);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glm::mat4 viewProjection = glm::mat4(1.0f);

    auto cameraView = registry.view<ecs::Camera, ecs::LocalTransform>();

    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (!camera.isActive) continue;

        auto& transform = registry.get<ecs::LocalTransform>(entity);
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
    g_renderFrame->submitSprites(registry);
    g_renderFrame->submitBitmapText(registry);
#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_renderFrame->submitSpine(registry, *g_spineSystem);
    }
#endif
    g_renderFrame->end();
}

void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                           uintptr_t matrixPtr) {
    if (!g_initialized || !g_renderFrame) return;

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }
#endif

    ctx().setViewport(static_cast<u32>(viewportWidth), static_cast<u32>(viewportHeight));
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    glViewport(0, 0, viewportWidth, viewportHeight);
    glClearColor(0.1f, 0.1f, 0.1f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection);
    g_renderFrame->submitSprites(registry);
    g_renderFrame->submitBitmapText(registry);
#ifdef ES_ENABLE_SPINE
    if (g_spineSystem) {
        g_renderFrame->submitSpine(registry, *g_spineSystem);
    }
#endif
    g_renderFrame->end();
}

void renderer_init(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().setViewport(width, height);
    g_renderFrame->resize(width, height);
}

void renderer_resize(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().setViewport(width, height);
    g_renderFrame->resize(width, height);
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

void renderer_submitSprites(ecs::Registry& registry) {
    if (!g_renderFrame || !g_transformSystem) return;
    g_transformSystem->update(registry, 0.0f);
    g_renderFrame->submitSprites(registry);
}

void renderer_submitBitmapText(ecs::Registry& registry) {
    if (!g_renderFrame || !g_transformSystem) return;
    g_transformSystem->update(registry, 0.0f);
    g_renderFrame->submitBitmapText(registry);
}

#ifdef ES_ENABLE_SPINE
void renderer_submitSpine(ecs::Registry& registry) {
    if (!g_renderFrame || !g_spineSystem) return;
    g_spineSystem->update(registry, 0.016f);
    g_renderFrame->submitSpine(registry, *g_spineSystem);
    checkGLErrors("renderer_submitSpine");
}
#endif

void renderer_submitTriangles(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    uintptr_t transformPtr) {
    if (!g_renderFrame) return;

    const f32* vertices = reinterpret_cast<const f32*>(verticesPtr);
    const u16* indices = reinterpret_cast<const u16*>(indicesPtr);
    const f32* transform = transformPtr ? reinterpret_cast<const f32*>(transformPtr) : nullptr;

    g_renderFrame->submitExternalTriangles(
        vertices, vertexCount,
        indices, indexCount,
        textureId, blendMode,
        transform);
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

void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a) {
    ctx().setClearColor(glm::vec4(r, g, b, a));
}

void renderer_setViewport(i32 x, i32 y, i32 w, i32 h) {
    glViewport(x, y, w, h);
}

void renderer_setScissor(i32 x, i32 y, i32 w, i32 h, bool enable) {
    if (enable) {
        glEnable(GL_SCISSOR_TEST);
        glScissor(x, y, w, h);
    } else {
        glDisable(GL_SCISSOR_TEST);
    }
}

void renderer_clearBuffers(i32 flags) {
    GLbitfield mask = 0;
    if (flags & 1) mask |= GL_COLOR_BUFFER_BIT;
    if (flags & 2) mask |= GL_DEPTH_BUFFER_BIT;
    if (mask) glClear(mask);
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

void gl_enableErrorCheck(bool enabled) {
    ctx().setGlErrorCheckEnabled(enabled);
    if (enabled) {
        while (glGetError() != GL_NO_ERROR) {}
        ES_LOG_INFO("[GL] Error checking enabled");
    }
}

u32 gl_checkErrors(const std::string& context) {
    bool prev = g_glErrorCheckEnabled;
    ctx().setGlErrorCheckEnabled(true);
    u32 count = checkGLErrors(context.c_str());
    ctx().setGlErrorCheckEnabled(prev);
    if (count == 0 && prev) {
        ES_LOG_INFO("[GL] No errors at: {}", context);
    }
    return count;
}

i32 registry_getCanvasEntity(ecs::Registry& registry) {
    auto view = registry.view<ecs::Canvas>();
    for (auto entity : view) {
        return static_cast<i32>(entity);
    }
    return -1;
}

emscripten::val registry_getCameraEntities(ecs::Registry& registry) {
    auto cameraView = registry.view<ecs::Camera, ecs::LocalTransform>();
    auto result = emscripten::val::array();
    u32 idx = 0;
    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (camera.isActive) {
            result.set(idx++, static_cast<u32>(entity));
        }
    }
    return result;
}

emscripten::val getChildEntities(ecs::Registry& registry, u32 entity) {
    auto result = emscripten::val::array();
    if (!registry.has<ecs::Children>(static_cast<Entity>(entity))) {
        return result;
    }
    const auto& children = registry.get<ecs::Children>(static_cast<Entity>(entity));
    u32 idx = 0;
    for (auto child : children.entities) {
        result.set(idx++, static_cast<u32>(child));
    }
    return result;
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
