/**
 * @file    EngineContext.hpp
 * @brief   Centralized engine context replacing global state
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#ifdef ES_PLATFORM_WEB

#include <emscripten/html5.h>
#include <glm/glm.hpp>
#include "../core/Types.hpp"

namespace esengine {

class RenderContext;
class RenderFrame;
class ImmediateDraw;
class GeometryManager;
class PostProcessPipeline;

namespace resource {
class ResourceManager;
}

namespace ecs {
class TransformSystem;
}

#ifdef ES_ENABLE_SPINE
namespace spine {
class SpineResourceManager;
class SpineSystem;
}
#endif

/**
 * @brief Centralized context for engine subsystems and state
 *
 * @details Replaces global variables in WebSDKEntry.cpp with a singleton
 *          context object. Provides controlled access to subsystems and state.
 */
class EngineContext {
public:
    static EngineContext& instance();

    EngineContext(const EngineContext&) = delete;
    EngineContext& operator=(const EngineContext&) = delete;

    bool isInitialized() const { return initialized_; }

    void shutdown();

    RenderContext* renderContext() { return renderContext_.get(); }
    RenderFrame* renderFrame() { return renderFrame_.get(); }
    ImmediateDraw* immediateDraw() { return immediateDraw_.get(); }
    GeometryManager* geometryManager() { return geometryManager_.get(); }
    PostProcessPipeline* postProcessPipeline() { return postProcessPipeline_.get(); }
    resource::ResourceManager* resourceManager() { return resourceManager_.get(); }
    ecs::TransformSystem* transformSystem() { return transformSystem_.get(); }

#ifdef ES_ENABLE_SPINE
    spine::SpineResourceManager* spineResourceManager() { return spineResourceManager_.get(); }
    spine::SpineSystem* spineSystem() { return spineSystem_.get(); }
#endif

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglContext() const { return webglContext_; }
    void setWebglContext(EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx) { webglContext_ = ctx; }

    bool immediateDrawActive() const { return immediateDrawActive_; }
    void setImmediateDrawActive(bool active) { immediateDrawActive_ = active; }

    bool glErrorCheckEnabled() const { return glErrorCheckEnabled_; }
    void setGlErrorCheckEnabled(bool enabled) { glErrorCheckEnabled_ = enabled; }

    u32 viewportWidth() const { return viewportWidth_; }
    u32 viewportHeight() const { return viewportHeight_; }
    void setViewport(u32 width, u32 height) {
        viewportWidth_ = width;
        viewportHeight_ = height;
    }

    const glm::vec4& clearColor() const { return clearColor_; }
    void setClearColor(const glm::vec4& color) { clearColor_ = color; }

    const glm::mat4& currentViewProjection() const { return currentViewProjection_; }
    void setCurrentViewProjection(const glm::mat4& vp) { currentViewProjection_ = vp; }

    void setInitialized(bool initialized) { initialized_ = initialized; }
    void setRenderContext(Unique<RenderContext> ctx) { renderContext_ = std::move(ctx); }
    void setRenderFrame(Unique<RenderFrame> frame) { renderFrame_ = std::move(frame); }
    void setImmediateDraw(Unique<ImmediateDraw> draw) { immediateDraw_ = std::move(draw); }
    void setGeometryManager(Unique<GeometryManager> mgr) { geometryManager_ = std::move(mgr); }
    void setPostProcessPipeline(Unique<PostProcessPipeline> pipeline) { postProcessPipeline_ = std::move(pipeline); }
    void setResourceManager(Unique<resource::ResourceManager> mgr) { resourceManager_ = std::move(mgr); }
    void setTransformSystem(Unique<ecs::TransformSystem> sys) { transformSystem_ = std::move(sys); }

#ifdef ES_ENABLE_SPINE
    void setSpineResourceManager(Unique<spine::SpineResourceManager> mgr) { spineResourceManager_ = std::move(mgr); }
    void setSpineSystem(Unique<spine::SpineSystem> sys) { spineSystem_ = std::move(sys); }
#endif

private:
    EngineContext() = default;
    ~EngineContext() = default;

    Unique<RenderContext> renderContext_;
    Unique<RenderFrame> renderFrame_;
    Unique<ImmediateDraw> immediateDraw_;
    Unique<GeometryManager> geometryManager_;
    Unique<PostProcessPipeline> postProcessPipeline_;
    Unique<resource::ResourceManager> resourceManager_;
    Unique<ecs::TransformSystem> transformSystem_;

#ifdef ES_ENABLE_SPINE
    Unique<spine::SpineResourceManager> spineResourceManager_;
    Unique<spine::SpineSystem> spineSystem_;
#endif

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglContext_ = 0;
    bool initialized_ = false;
    bool immediateDrawActive_ = false;
    bool glErrorCheckEnabled_ = false;
    u32 viewportWidth_ = 1280;
    u32 viewportHeight_ = 720;
    glm::vec4 clearColor_{0.0f, 0.0f, 0.0f, 1.0f};
    glm::mat4 currentViewProjection_{1.0f};
};

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
