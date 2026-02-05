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

#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderPipeline.hpp"
#include "../renderer/Texture.hpp"
#include "../resource/ResourceManager.hpp"
#include "../resource/TextureMetadata.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Transform.hpp"
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#include "../spine/SpineRenderer.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static Unique<RenderContext> g_renderContext;
static Unique<RenderPipeline> g_renderPipeline;
static Unique<ecs::TransformSystem> g_transformSystem;
static Unique<resource::ResourceManager> g_resourceManager;
static Unique<spine::SpineResourceManager> g_spineResourceManager;
static Unique<spine::SpineSystem> g_spineSystem;
static Unique<spine::SpineRenderer> g_spineRenderer;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE g_webglContext = 0;
static bool g_initialized = false;

bool initRendererInternal(const char* canvasSelector) {
    if (g_initialized) return true;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = true;
    attrs.depth = true;
    attrs.stencil = false;
    attrs.antialias = true;
    attrs.premultipliedAlpha = true;
    attrs.preserveDrawingBuffer = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;
    attrs.failIfMajorPerformanceCaveat = false;

    g_webglContext = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (g_webglContext <= 0) {
        ES_LOG_ERROR("Failed to create WebGL2 context for '{}': {}", canvasSelector, g_webglContext);
        return false;
    }

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL2 context created for '{}'", canvasSelector);

    g_resourceManager = makeUnique<resource::ResourceManager>();
    g_resourceManager->init();

    g_renderContext = makeUnique<RenderContext>();
    g_renderContext->init();

    g_renderPipeline = makeUnique<RenderPipeline>(*g_renderContext, *g_resourceManager);
    g_transformSystem = makeUnique<ecs::TransformSystem>();

    g_spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    g_spineResourceManager->init();

    g_spineSystem = makeUnique<spine::SpineSystem>(*g_spineResourceManager);

    g_spineRenderer = makeUnique<spine::SpineRenderer>(*g_renderContext, *g_resourceManager, *g_spineSystem);
    g_spineRenderer->init();

    g_initialized = true;

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    return true;
}

void initRenderer() {
    initRendererInternal("#canvas");
}

bool initRendererWithCanvas(const std::string& canvasSelector) {
    return initRendererInternal(canvasSelector.c_str());
}

// Initialize renderer with an externally created WebGL context (for WeChat MiniGame)
bool initRendererWithContext(int contextHandle) {
    if (g_initialized) return true;
    if (contextHandle <= 0) {
        ES_LOG_ERROR("Invalid WebGL context handle: {}", contextHandle);
        return false;
    }

    g_webglContext = contextHandle;

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL context set from external handle: {}", contextHandle);

    g_resourceManager = makeUnique<resource::ResourceManager>();
    g_resourceManager->init();

    g_renderContext = makeUnique<RenderContext>();
    g_renderContext->init();

    g_renderPipeline = makeUnique<RenderPipeline>(*g_renderContext, *g_resourceManager);
    g_transformSystem = makeUnique<ecs::TransformSystem>();

    g_spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    g_spineResourceManager->init();

    g_spineSystem = makeUnique<spine::SpineSystem>(*g_spineResourceManager);

    g_spineRenderer = makeUnique<spine::SpineRenderer>(*g_renderContext, *g_resourceManager, *g_spineSystem);
    g_spineRenderer->init();

    g_initialized = true;

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    return true;
}

void shutdownRenderer() {
    if (!g_initialized) return;

    g_spineRenderer->shutdown();
    g_spineRenderer.reset();
    g_spineSystem.reset();
    g_spineResourceManager->shutdown();
    g_spineResourceManager.reset();

    g_transformSystem.reset();
    g_renderPipeline.reset();
    g_renderContext->shutdown();
    g_renderContext.reset();
    g_resourceManager->shutdown();
    g_resourceManager.reset();

    if (g_webglContext > 0) {
        emscripten_webgl_destroy_context(g_webglContext);
        g_webglContext = 0;
    }

    g_initialized = false;
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager.get();
}

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format) {
    const u8* pixels = reinterpret_cast<const u8*>(pixelsPtr);
    ConstSpan<u8> pixelSpan(pixels, pixelsLen);

    TextureFormat texFormat = TextureFormat::RGBA8;
    if (format == 0) texFormat = TextureFormat::RGB8;
    else if (format == 1) texFormat = TextureFormat::RGBA8;

    auto handle = rm.createTexture(width, height, pixelSpan, texFormat);
    return handle.id();
}

u32 rm_createShader(resource::ResourceManager& rm,
                     const std::string& vertSrc, const std::string& fragSrc) {
    auto handle = rm.createShader(vertSrc, fragSrc);
    return handle.id();
}

void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseTexture(resource::TextureHandle(handleId));
}

void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path) {
    rm.registerTextureWithPath(resource::TextureHandle(handleId), path);
}

void rm_releaseShader(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseShader(resource::ShaderHandle(handleId));
}

void rm_setTextureMetadata(resource::ResourceManager& rm, u32 handleId,
                            f32 left, f32 right, f32 top, f32 bottom) {
    resource::TextureMetadata metadata;
    metadata.sliceBorder.left = left;
    metadata.sliceBorder.right = right;
    metadata.sliceBorder.top = top;
    metadata.sliceBorder.bottom = bottom;
    rm.setTextureMetadata(resource::TextureHandle(handleId), metadata);
}

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderContext) return;

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }

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

    g_renderPipeline->begin(viewProjection);
    g_renderPipeline->submit(registry);
    g_renderPipeline->end();

    if (g_spineRenderer) {
        g_spineRenderer->begin(viewProjection);
        g_spineRenderer->submit(registry);
        g_spineRenderer->end();
    }
}

void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                           uintptr_t matrixPtr) {
    if (!g_initialized || !g_renderContext) return;

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }

    glViewport(0, 0, viewportWidth, viewportHeight);
    glClearColor(0.1f, 0.1f, 0.1f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderPipeline->begin(viewProjection);
    g_renderPipeline->submit(registry);
    g_renderPipeline->end();

    if (g_spineRenderer) {
        g_spineRenderer->begin(viewProjection);
        g_spineRenderer->submit(registry);
        g_spineRenderer->end();
    }
}

struct SpineBounds {
    f32 x = 0;
    f32 y = 0;
    f32 width = 0;
    f32 height = 0;
    bool valid = false;
};

SpineBounds getSpineBounds(ecs::Registry& registry, Entity entity) {
    SpineBounds bounds;
    if (!g_spineSystem) return bounds;

    if (g_spineSystem->getSkeletonBounds(entity, bounds.x, bounds.y,
                                          bounds.width, bounds.height)) {
        bounds.valid = true;
    }
    return bounds;
}

}  // namespace esengine

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
        .function("createShader", &esengine::rm_createShader)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath);

    emscripten::value_object<esengine::SpineBounds>("SpineBounds")
        .field("x", &esengine::SpineBounds::x)
        .field("y", &esengine::SpineBounds::y)
        .field("width", &esengine::SpineBounds::width)
        .field("height", &esengine::SpineBounds::height)
        .field("valid", &esengine::SpineBounds::valid);

    emscripten::function("getSpineBounds", &esengine::getSpineBounds);
}

int main() {
    return 0;
}

#endif  // ES_PLATFORM_WEB
