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
#include "../renderer/PostProcessPipeline.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
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
