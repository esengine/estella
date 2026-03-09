/**
 * @file    EngineContext.cpp
 * @brief   Implementation of centralized engine context
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#ifdef ES_PLATFORM_WEB

#include "EngineContext.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "../renderer/PostProcessPipeline.hpp"
#endif
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../animation/TweenSystem.hpp"
#ifdef ES_ENABLE_TIMELINE
#include "../animation/TimelineSystem.hpp"
#endif
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif
#include <emscripten/html5.h>

namespace esengine {

EngineContext& EngineContext::instance() {
    static EngineContext ctx;
    return ctx;
}

void EngineContext::setRenderContext(Unique<RenderContext> ctx) { renderContext_ = std::move(ctx); }
void EngineContext::setRenderFrame(Unique<RenderFrame> frame) { renderFrame_ = std::move(frame); }
void EngineContext::setImmediateDraw(Unique<ImmediateDraw> draw) { immediateDraw_ = std::move(draw); }
void EngineContext::setGeometryManager(Unique<GeometryManager> mgr) { geometryManager_ = std::move(mgr); }
#ifdef ES_ENABLE_POSTPROCESS
void EngineContext::setPostProcessPipeline(Unique<PostProcessPipeline> pipeline) { postProcessPipeline_ = std::move(pipeline); }
#endif
void EngineContext::setResourceManager(Unique<resource::ResourceManager> mgr) { resourceManager_ = std::move(mgr); }
void EngineContext::setTransformSystem(Unique<ecs::TransformSystem> sys) { transformSystem_ = std::move(sys); }
void EngineContext::setTweenSystem(Unique<animation::TweenSystem> sys) { tweenSystem_ = std::move(sys); }
#ifdef ES_ENABLE_TIMELINE
void EngineContext::setTimelineSystem(Unique<animation::TimelineSystem> sys) { timelineSystem_ = std::move(sys); }
#endif
#ifdef ES_ENABLE_PARTICLES
void EngineContext::setParticleSystem(Unique<particle::ParticleSystem> sys) { particleSystem_ = std::move(sys); }
#endif

#ifdef ES_ENABLE_SPINE
void EngineContext::setSpineResourceManager(Unique<spine::SpineResourceManager> mgr) { spineResourceManager_ = std::move(mgr); }
void EngineContext::setSpineSystem(Unique<spine::SpineSystem> sys) { spineSystem_ = std::move(sys); }
#endif

void EngineContext::shutdown() {
    if (!initialized_) return;

    geometryManager_.reset();

    if (renderFrame_) {
        renderFrame_->shutdown();
        renderFrame_.reset();
    }

    if (immediateDraw_) {
        immediateDraw_->shutdown();
        immediateDraw_.reset();
    }

#ifdef ES_ENABLE_SPINE
    spineSystem_.reset();
    if (spineResourceManager_) {
        spineResourceManager_->shutdown();
        spineResourceManager_.reset();
    }
#endif

#ifdef ES_ENABLE_TIMELINE
    timelineSystem_.reset();
#endif
#ifdef ES_ENABLE_PARTICLES
    particleSystem_.reset();
#endif
    tweenSystem_.reset();
    transformSystem_.reset();
    if (renderContext_) {
        renderContext_->shutdown();
        renderContext_.reset();
    }
    if (resourceManager_) {
        resourceManager_->shutdown();
        resourceManager_.reset();
    }

    if (webglContext_ > 0) {
        emscripten_webgl_destroy_context(webglContext_);
        webglContext_ = 0;
    }

    initialized_ = false;
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
