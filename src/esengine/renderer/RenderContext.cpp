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
#include "FrameConstants.hpp"
#include "../core/Log.hpp"

#include <glm/gtc/type_ptr.hpp>

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
    initFrameUbo();

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

    if (frameUbo_ != 0) {
        device_.deleteBuffer(frameUbo_);
        frameUbo_ = 0;
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

void RenderContext::initFrameUbo() {
    frameUbo_ = device_.createBuffer();

    FrameConstants initial{};
    device_.bindUniformBuffer(frameUbo_);
    device_.bufferData(GfxBufferTarget::Uniform, &initial, sizeof(FrameConstants), /*dynamic=*/true);

    // The binding point persists for the context lifetime; only the contents change
    // per frame. Every engine shader's FrameConstants block is linked to this point
    // at compile time (Shader::compile).
    device_.bindBufferBase(FRAME_CONSTANTS_BINDING, frameUbo_);

    ES_LOG_DEBUG("FrameConstants UBO created (ID: {})", frameUbo_);
}

void RenderContext::updateFrameConstants(const glm::mat4& viewProjection) {
    viewProjection_ = viewProjection;
    device_.bindUniformBuffer(frameUbo_);
    device_.bufferSubData(GfxBufferTarget::Uniform, 0, glm::value_ptr(viewProjection),
                          sizeof(glm::mat4));
}

}  // namespace esengine
