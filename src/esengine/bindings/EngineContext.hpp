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
#include "../core/ServiceRegistry.hpp"
#include "../animation/TweenSystem.hpp"
#include "MaterialCache.hpp"
#ifdef ES_ENABLE_TIMELINE
#include "../animation/TimelineSystem.hpp"
#endif
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif

namespace esengine {

class RenderContext;
class RenderFrame;
class ImmediateDraw;
class GeometryManager;
#ifdef ES_ENABLE_POSTPROCESS
class PostProcessPipeline;
#endif

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
 * @details Delegates subsystem storage to a ServiceRegistry.
 *          Typed accessors are provided for backward compatibility.
 */
class EngineContext {
public:
    static EngineContext& instance();

    EngineContext(const EngineContext&) = delete;
    EngineContext& operator=(const EngineContext&) = delete;

    bool isInitialized() const { return initialized_; }

    void shutdown();

    ServiceRegistry& services() { return services_; }

    // =========================================================================
    // Subsystem Accessors
    // =========================================================================

    RenderContext* renderContext() { return services_.getService<RenderContext>(); }
    RenderFrame* renderFrame() { return services_.getService<RenderFrame>(); }
    ImmediateDraw* immediateDraw() { return services_.getService<ImmediateDraw>(); }
    GeometryManager* geometryManager() { return services_.getService<GeometryManager>(); }
#ifdef ES_ENABLE_POSTPROCESS
    PostProcessPipeline* postProcessPipeline() { return services_.getService<PostProcessPipeline>(); }
#endif
    resource::ResourceManager* resourceManager() { return services_.getService<resource::ResourceManager>(); }
    ecs::TransformSystem* transformSystem() { return services_.getService<ecs::TransformSystem>(); }
    animation::TweenSystem* tweenSystem() { return services_.getService<animation::TweenSystem>(); }
#ifdef ES_ENABLE_TIMELINE
    animation::TimelineSystem* timelineSystem() { return services_.getService<animation::TimelineSystem>(); }
#endif
#ifdef ES_ENABLE_PARTICLES
    particle::ParticleSystem* particleSystem() { return services_.getService<particle::ParticleSystem>(); }
#endif

#ifdef ES_ENABLE_SPINE
    spine::SpineResourceManager* spineResourceManager() { return services_.getService<spine::SpineResourceManager>(); }
    spine::SpineSystem* spineSystem() { return services_.getService<spine::SpineSystem>(); }
#endif

    // =========================================================================
    // State
    // =========================================================================

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

    f32 deltaTime() const { return deltaTime_; }
    void setDeltaTime(f32 dt) { deltaTime_ = dt; }

    bool transformsUpdated() const { return transformsUpdated_; }
    void setTransformsUpdated(bool v) { transformsUpdated_ = v; }

    const glm::vec4& clearColor() const { return clearColor_; }
    void setClearColor(const glm::vec4& color) { clearColor_ = color; }

    const glm::mat4& currentViewProjection() const { return currentViewProjection_; }
    void setCurrentViewProjection(const glm::mat4& vp) { currentViewProjection_ = vp; }

    MaterialCache& materialCache() { return materialCache_; }

    void setInitialized(bool initialized) { initialized_ = initialized; }

private:
    EngineContext() = default;
    ~EngineContext() = default;

    ServiceRegistry services_;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglContext_ = 0;
    bool initialized_ = false;
    bool immediateDrawActive_ = false;
    bool glErrorCheckEnabled_ = true;
    u32 viewportWidth_ = 1280;
    u32 viewportHeight_ = 720;
    glm::vec4 clearColor_{0.0f, 0.0f, 0.0f, 1.0f};
    glm::mat4 currentViewProjection_{1.0f};
    f32 deltaTime_ = 0.016f;
    bool transformsUpdated_ = false;
    MaterialCache materialCache_;
};

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
