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

void EngineContext::shutdown() {
    if (!initialized_) return;

    if (auto* rf = renderFrame()) {
        rf->shutdown();
    }

    if (auto* id = immediateDraw()) {
        id->shutdown();
    }

#ifdef ES_ENABLE_SPINE
    if (auto* srm = spineResourceManager()) {
        srm->shutdown();
    }
#endif

    if (auto* rc = renderContext()) {
        rc->shutdown();
    }

    if (auto* rm = resourceManager()) {
        rm->shutdown();
    }

    services_.clear();

    if (webglContext_ > 0) {
        emscripten_webgl_destroy_context(webglContext_);
        webglContext_ = 0;
    }

    materialCache_.clear();
    initialized_ = false;
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
