/**
 * @file    RenderContext.cpp
 * @brief   Rendering context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "RenderContext.hpp"
#include "GfxDevice.hpp"
#include "../core/Log.hpp"

namespace esengine {

RenderContext::RenderContext(GfxDevice& device)
    : device_(device) {
}

RenderContext::~RenderContext() {
    if (initialized_) {
        shutdown();
    }
}

void RenderContext::init() {
    if (initialized_) {
        ES_LOG_WARN("RenderContext already initialized");
        return;
    }

    device_.init();
    initWhiteTexture();

    initialized_ = true;
}

void RenderContext::shutdown() {
    if (!initialized_) {
        return;
    }

    if (whiteTextureId_ != 0) {
        device_.deleteTexture(whiteTextureId_);
        whiteTextureId_ = 0;
    }

    device_.shutdown();
    initialized_ = false;
    ES_LOG_INFO("RenderContext shutdown");
}

void RenderContext::initWhiteTexture() {
    whiteTextureId_ = device_.createTexture();

    u32 whiteData = 0xFFFFFFFF;
    device_.texImage2D(whiteTextureId_, 1, 1, GfxPixelFormat::RGBA8, &whiteData);
    device_.setTextureParams(whiteTextureId_, TextureFilter::Nearest, TextureFilter::Nearest,
                             TextureWrap::ClampToEdge, TextureWrap::ClampToEdge);

    ES_LOG_DEBUG("White texture created (ID: {})", whiteTextureId_);
}

}  // namespace esengine
