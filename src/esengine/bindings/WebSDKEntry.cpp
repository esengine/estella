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

#include "EngineContext.hpp"
#include "ResourceManagerBindings.hpp"
#include "RendererBindings.hpp"
#include "ImmediateDrawBindings.hpp"
#include "GeometryBindings.hpp"
#include "PostProcessBindings.hpp"

#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/Log.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <glm/glm.hpp>
#include <cstring>

static_assert(sizeof(void*) == 4, "EM_JS pointer passing assumes wasm32 (4-byte pointers)");

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().isInitialized())
#define g_webglContext (ctx().webglContext())
#define g_resourceManager (ctx().resourceManager())
#ifdef ES_ENABLE_SPINE
#define g_spineResourceManager (ctx().spineResourceManager())
#endif
#define g_renderContext (ctx().renderContext())

EM_JS(void, callMaterialProvider, (int materialId, int outShaderIdPtr, int outBlendModePtr, int outUniformBufPtr, int outUniformCountPtr), {
    var fn = Module['materialDataProvider'];
    if (fn) {
        fn(materialId, outShaderIdPtr, outBlendModePtr, outUniformBufPtr, outUniformCountPtr);
    } else {
        HEAPU32[outShaderIdPtr >> 2] = 0;
        HEAPU32[outBlendModePtr >> 2] = 0;
        HEAPU32[outUniformBufPtr >> 2] = 0;
        HEAPU32[outUniformCountPtr >> 2] = 0;
    }
});

bool getMaterialData(u32 materialId, u32& shaderId, u32& blendMode) {
    if (materialId == 0) {
        return false;
    }
    u32 uniformBufferPtr = 0;
    u32 uniformCount = 0;
    auto toPtr = [](auto* p) { return static_cast<int>(reinterpret_cast<uintptr_t>(p)); };
    callMaterialProvider(materialId,
        toPtr(&shaderId),
        toPtr(&blendMode),
        toPtr(&uniformBufferPtr),
        toPtr(&uniformCount));
    return shaderId != 0;
}

struct UniformData {
    char name[32];
    u32 type;
    f32 values[4];
};

bool getMaterialDataWithUniforms(u32 materialId, u32& shaderId, u32& blendMode,
                                  std::vector<UniformData>& uniforms) {
    if (materialId == 0) {
        return false;
    }

    u32 uniformBufferPtr = 0;
    u32 uniformCount = 0;
    auto toPtr = [](auto* p) { return static_cast<int>(reinterpret_cast<uintptr_t>(p)); };
    callMaterialProvider(materialId,
        toPtr(&shaderId),
        toPtr(&blendMode),
        toPtr(&uniformBufferPtr),
        toPtr(&uniformCount));

    if (shaderId == 0) return false;

    constexpr u32 MAX_UNIFORMS = 64;
    if (uniformCount > MAX_UNIFORMS) {
        ES_LOG_ERROR("Material {} has {} uniforms (max {}), clamping",
                     materialId, uniformCount, MAX_UNIFORMS);
        uniformCount = MAX_UNIFORMS;
    }

    if (uniformCount > 0 && uniformBufferPtr != 0) {
        const u8* ptr = reinterpret_cast<const u8*>(uniformBufferPtr);
        constexpr usize MAX_BUFFER_SIZE = MAX_UNIFORMS * (4 + 256 + 4 + 16);
        const u8* bufferEnd = ptr + MAX_BUFFER_SIZE;

        for (u32 i = 0; i < uniformCount; ++i) {
            if (ptr + 4 > bufferEnd) break;
            u32 nameLen = *reinterpret_cast<const u32*>(ptr);
            ptr += 4;

            usize alignedNameLen = ((nameLen + 3) / 4) * 4;
            if (ptr + alignedNameLen > bufferEnd) break;

            UniformData ud;
            usize copyLen = std::min<usize>(nameLen, 31);
            std::memcpy(ud.name, reinterpret_cast<const char*>(ptr), copyLen);
            ud.name[copyLen] = '\0';
            ptr += alignedNameLen;

            if (ptr + 4 > bufferEnd) break;
            ud.type = *reinterpret_cast<const u32*>(ptr);
            ptr += 4;

            if (ptr + 16 > bufferEnd) break;
            std::memcpy(ud.values, ptr, 16);
            ptr += 16;

            uniforms.push_back(ud);
        }
    }

    return true;
}

bool initRendererInternal(const char* canvasSelector) {
    if (g_initialized) return true;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = true;
    attrs.depth = true;
    attrs.stencil = true;
    attrs.antialias = true;
    attrs.premultipliedAlpha = true;
    attrs.preserveDrawingBuffer = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;
    attrs.failIfMajorPerformanceCaveat = false;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglCtx = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (webglCtx <= 0) {
        ES_LOG_ERROR("Failed to create WebGL2 context for '{}': {}", canvasSelector, webglCtx);
        return false;
    }
    ctx().setWebglContext(webglCtx);

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL2 context created for '{}'", canvasSelector);

    auto resourceManager = makeUnique<resource::ResourceManager>();
    resourceManager->init();
    ctx().setResourceManager(std::move(resourceManager));

    auto renderContext = makeUnique<RenderContext>();
    renderContext->init();
    ctx().setRenderContext(std::move(renderContext));

    ctx().setTransformSystem(makeUnique<ecs::TransformSystem>());

#ifdef ES_ENABLE_SPINE
    auto spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    spineResourceManager->init();
    ctx().setSpineResourceManager(std::move(spineResourceManager));
    ctx().setSpineSystem(makeUnique<spine::SpineSystem>(*g_spineResourceManager));
#endif

    auto immediateDraw = makeUnique<ImmediateDraw>(*g_renderContext, *g_resourceManager);
    immediateDraw->init();
    ctx().setImmediateDraw(std::move(immediateDraw));

    ctx().setGeometryManager(makeUnique<GeometryManager>());

    auto renderFrame = makeUnique<RenderFrame>(*g_renderContext, *g_resourceManager);
    renderFrame->init(1280, 720);
    ctx().setRenderFrame(std::move(renderFrame));

    ctx().setInitialized(true);

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

bool initRendererWithContext(int contextHandle) {
    if (g_initialized) return true;
    if (contextHandle <= 0) {
        ES_LOG_ERROR("Invalid WebGL context handle: {}", contextHandle);
        return false;
    }

    ctx().setWebglContext(contextHandle);

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL context set from external handle: {}", contextHandle);

    auto resourceManager = makeUnique<resource::ResourceManager>();
    resourceManager->init();
    ctx().setResourceManager(std::move(resourceManager));

    auto renderContext = makeUnique<RenderContext>();
    renderContext->init();
    ctx().setRenderContext(std::move(renderContext));

    ctx().setTransformSystem(makeUnique<ecs::TransformSystem>());

#ifdef ES_ENABLE_SPINE
    auto spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    spineResourceManager->init();
    ctx().setSpineResourceManager(std::move(spineResourceManager));
    ctx().setSpineSystem(makeUnique<spine::SpineSystem>(*g_spineResourceManager));
#endif

    auto immediateDraw = makeUnique<ImmediateDraw>(*g_renderContext, *g_resourceManager);
    immediateDraw->init();
    ctx().setImmediateDraw(std::move(immediateDraw));

    ctx().setGeometryManager(makeUnique<GeometryManager>());

    auto renderFrame = makeUnique<RenderFrame>(*g_renderContext, *g_resourceManager);
    renderFrame->init(1280, 720);
    ctx().setRenderFrame(std::move(renderFrame));

    ctx().setInitialized(true);

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    return true;
}

void shutdownRenderer() {
    ctx().shutdown();
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager;
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
        .function("registerExternalTexture", &esengine::rm_registerExternalTexture)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("getTextureRefCount", &esengine::rm_getTextureRefCount)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("getShaderRefCount", &esengine::rm_getShaderRefCount)
        .function("getTextureGLId", &esengine::rm_getTextureGLId)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath)
        .function("loadBitmapFont", &esengine::rm_loadBitmapFont)
        .function("createLabelAtlasFont", &esengine::rm_createLabelAtlasFont)
        .function("releaseBitmapFont", &esengine::rm_releaseBitmapFont)
        .function("getBitmapFontRefCount", &esengine::rm_getBitmapFontRefCount)
        .function("measureBitmapText", &esengine::rm_measureBitmapText);

#ifdef ES_ENABLE_SPINE
    emscripten::value_object<esengine::SpineBounds>("SpineBounds")
        .field("x", &esengine::SpineBounds::x)
        .field("y", &esengine::SpineBounds::y)
        .field("width", &esengine::SpineBounds::width)
        .field("height", &esengine::SpineBounds::height)
        .field("valid", &esengine::SpineBounds::valid);

    emscripten::function("getSpineBounds", &esengine::getSpineBounds);
#endif

    emscripten::function("draw_begin", &esengine::draw_begin);
    emscripten::function("draw_end", &esengine::draw_end);
    emscripten::function("draw_line", &esengine::draw_line);
    emscripten::function("draw_rect", &esengine::draw_rect);
    emscripten::function("draw_rectOutline", &esengine::draw_rectOutline);
    emscripten::function("draw_circle", &esengine::draw_circle);
    emscripten::function("draw_circleOutline", &esengine::draw_circleOutline);
    emscripten::function("draw_texture", &esengine::draw_texture);
    emscripten::function("draw_textureRotated", &esengine::draw_textureRotated);
    emscripten::function("draw_setLayer", &esengine::draw_setLayer);
    emscripten::function("draw_setDepth", &esengine::draw_setDepth);
    emscripten::function("draw_getDrawCallCount", &esengine::draw_getDrawCallCount);
    emscripten::function("draw_getPrimitiveCount", &esengine::draw_getPrimitiveCount);
    emscripten::function("draw_setBlendMode", &esengine::draw_setBlendMode);
    emscripten::function("draw_setDepthTest", &esengine::draw_setDepthTest);
    emscripten::function("draw_mesh", &esengine::draw_mesh);
    emscripten::function("draw_meshWithUniforms", &esengine::draw_meshWithUniforms);

    emscripten::function("geometry_create", &esengine::geometry_create);
    emscripten::function("geometry_init", &esengine::geometry_init);
    emscripten::function("geometry_setIndices16", &esengine::geometry_setIndices16);
    emscripten::function("geometry_setIndices32", &esengine::geometry_setIndices32);
    emscripten::function("geometry_updateVertices", &esengine::geometry_updateVertices);
    emscripten::function("geometry_release", &esengine::geometry_release);
    emscripten::function("geometry_isValid", &esengine::geometry_isValid);

    emscripten::function("postprocess_init", &esengine::postprocess_init);
    emscripten::function("postprocess_shutdown", &esengine::postprocess_shutdown);
    emscripten::function("postprocess_resize", &esengine::postprocess_resize);
    emscripten::function("postprocess_addPass", &esengine::postprocess_addPass);
    emscripten::function("postprocess_removePass", &esengine::postprocess_removePass);
    emscripten::function("postprocess_setPassEnabled", &esengine::postprocess_setPassEnabled);
    emscripten::function("postprocess_isPassEnabled", &esengine::postprocess_isPassEnabled);
    emscripten::function("postprocess_setUniformFloat", &esengine::postprocess_setUniformFloat);
    emscripten::function("postprocess_setUniformVec4", &esengine::postprocess_setUniformVec4);
    emscripten::function("postprocess_begin", &esengine::postprocess_begin);
    emscripten::function("postprocess_end", &esengine::postprocess_end);
    emscripten::function("postprocess_getPassCount", &esengine::postprocess_getPassCount);
    emscripten::function("postprocess_isInitialized", &esengine::postprocess_isInitialized);
    emscripten::function("postprocess_setBypass", &esengine::postprocess_setBypass);
    emscripten::function("postprocess_isBypassed", &esengine::postprocess_isBypassed);

    emscripten::function("renderer_init", &esengine::renderer_init);
    emscripten::function("renderer_resize", &esengine::renderer_resize);
    emscripten::function("renderer_begin", &esengine::renderer_begin);
    emscripten::function("renderer_flush", &esengine::renderer_flush);
    emscripten::function("renderer_end", &esengine::renderer_end);
    emscripten::function("renderer_submitSprites", &esengine::renderer_submitSprites);
    emscripten::function("renderer_submitBitmapText", &esengine::renderer_submitBitmapText);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_submitSpine", &esengine::renderer_submitSpine);
#endif
    emscripten::function("renderer_submitTriangles", &esengine::renderer_submitTriangles);
    emscripten::function("renderer_setStage", &esengine::renderer_setStage);
    emscripten::function("renderer_createTarget", &esengine::renderer_createTarget);
    emscripten::function("renderer_releaseTarget", &esengine::renderer_releaseTarget);
    emscripten::function("renderer_getTargetTexture", &esengine::renderer_getTargetTexture);
    emscripten::function("renderer_getTargetDepthTexture", &esengine::renderer_getTargetDepthTexture);
    emscripten::function("renderer_getDrawCalls", &esengine::renderer_getDrawCalls);
    emscripten::function("renderer_getTriangles", &esengine::renderer_getTriangles);
    emscripten::function("renderer_getSprites", &esengine::renderer_getSprites);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_getSpine", &esengine::renderer_getSpine);
#endif
    emscripten::function("renderer_getText", &esengine::renderer_getText);
    emscripten::function("renderer_getMeshes", &esengine::renderer_getMeshes);
    emscripten::function("renderer_getCulled", &esengine::renderer_getCulled);
    emscripten::function("renderer_setClearColor", &esengine::renderer_setClearColor);
    emscripten::function("renderer_setViewport", &esengine::renderer_setViewport);
    emscripten::function("renderer_setScissor", &esengine::renderer_setScissor);
    emscripten::function("renderer_clearBuffers", &esengine::renderer_clearBuffers);
    emscripten::function("renderer_setEntityClipRect", &esengine::renderer_setEntityClipRect);
    emscripten::function("renderer_clearEntityClipRect", &esengine::renderer_clearEntityClipRect);
    emscripten::function("renderer_clearAllClipRects", &esengine::renderer_clearAllClipRects);

    emscripten::function("renderer_clearStencil", &esengine::renderer_clearStencil);
    emscripten::function("renderer_setEntityStencilMask", &esengine::renderer_setEntityStencilMask);
    emscripten::function("renderer_setEntityStencilTest", &esengine::renderer_setEntityStencilTest);
    emscripten::function("renderer_clearEntityStencilMask", &esengine::renderer_clearEntityStencilMask);
    emscripten::function("renderer_clearAllStencilMasks", &esengine::renderer_clearAllStencilMasks);

    emscripten::function("registry_getCanvasEntity", &esengine::registry_getCanvasEntity);
    emscripten::function("registry_getCameraEntities", &esengine::registry_getCameraEntities);
    emscripten::function("getChildEntities", &esengine::getChildEntities);

    emscripten::function("gl_enableErrorCheck", &esengine::gl_enableErrorCheck);
    emscripten::function("gl_checkErrors", &esengine::gl_checkErrors);
    emscripten::function("renderer_diagnose", &esengine::renderer_diagnose);
}

int main() {
    return 0;
}

#endif  // ES_PLATFORM_WEB
