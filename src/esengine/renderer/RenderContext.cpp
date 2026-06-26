// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderContext.cpp
 * @brief   Rendering context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
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
    initDefaultTextures();
    initFrameUbo();
    materials_.setDevice(&device_);
    lights_.setDevice(&device_);

    initialized_ = true;
}

void RenderContext::shutdown() {
    if (!initialized_) {
        return;
    }

    for (u32* tex : {&whiteTextureId_, &blackTextureId_, &flatNormalTextureId_}) {
        if (*tex != 0) {
            device_.deleteTexture(*tex);
            *tex = 0;
        }
    }

    if (frameUbo_ != 0) {
        device_.deleteBuffer(frameUbo_);
        frameUbo_ = 0;
    }

    materials_.clear();  // free per-material UBOs while the device is still valid
    lights_.free();      // free the lighting UBO while the device is still valid

    device_.shutdown();
    initialized_ = false;
    ES_LOG_INFO("RenderContext shutdown");
}

u32 RenderContext::make1x1Texture(u32 rgba) {
    u32 id = device_.createTexture();
    device_.texImage2D(id, 1, 1, GfxPixelFormat::RGBA8, &rgba);
    device_.setTextureParams(id, TextureFilter::Nearest, TextureFilter::Nearest,
                             TextureWrap::ClampToEdge, TextureWrap::ClampToEdge);
    return id;
}

void RenderContext::initDefaultTextures() {
    // Byte order in memory is R,G,B,A; these u32s are little-endian (so 0xAABBGGRR).
    whiteTextureId_ = make1x1Texture(0xFFFFFFFF);       // RGBA(255,255,255,255)
    blackTextureId_ = make1x1Texture(0xFF000000);       // RGBA(0,0,0,255)
    flatNormalTextureId_ = make1x1Texture(0xFFFF8080);  // RGB(128,128,255) → normal (0,0,1)
    ES_LOG_DEBUG("Default textures created (white {}, black {}, flatNormal {})",
                 whiteTextureId_, blackTextureId_, flatNormalTextureId_);
}

u32 RenderContext::defaultTextureByName(const std::string& name) const {
    if (name == "black") return blackTextureId_;
    if (name == "flatnormal" || name == "normal") return flatNormalTextureId_;
    return whiteTextureId_;  // "white" / empty / unknown
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
