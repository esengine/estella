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

#include "./RenderContext.hpp"
#include "../rhi/GfxDevice.hpp"
#include "./FrameConstants.hpp"
#include "../draw/DrawParams.hpp"
#include "../../core/Log.hpp"

#include <vector>

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
    materials_.setBuiltinDefaults(whiteTexture_, blackTexture_, flatNormalTexture_);
    lights_.setDevice(&device_);

    initialized_ = true;
}

void RenderContext::shutdown() {
    if (!initialized_) {
        return;
    }

    for (TextureHandle* tex : {&whiteTexture_, &blackTexture_, &flatNormalTexture_}) {
        if (*tex != TextureHandle::Invalid) {
            device_.deleteTexture(*tex);
            *tex = TextureHandle::Invalid;
        }
    }

    if (frameUbo_ != BufferHandle::Invalid) {
        device_.deleteBuffer(frameUbo_);
        frameUbo_ = BufferHandle::Invalid;
    }
    if (timeUbo_ != BufferHandle::Invalid) {
        device_.deleteBuffer(timeUbo_);
        timeUbo_ = BufferHandle::Invalid;
    }

    materials_.clear();  // free per-material UBOs while the device is still valid
    lights_.free();      // free the lighting UBO while the device is still valid

    device_.shutdown();
    initialized_ = false;
    ES_LOG_INFO("RenderContext shutdown");
}

TextureHandle RenderContext::make1x1Texture(u32 rgba) {
    TextureDesc desc;
    desc.width = 1;
    desc.height = 1;
    desc.minFilter = TextureFilter::Nearest;
    desc.magFilter = TextureFilter::Nearest;
    return device_.createTexture(desc, &rgba);
}

void RenderContext::initDefaultTextures() {
    // Byte order in memory is R,G,B,A; these u32s are little-endian (so 0xAABBGGRR).
    whiteTexture_ = make1x1Texture(0xFFFFFFFF);       // RGBA(255,255,255,255)
    blackTexture_ = make1x1Texture(0xFF000000);       // RGBA(0,0,0,255)
    flatNormalTexture_ = make1x1Texture(0xFFFF8080);  // RGB(128,128,255) → normal (0,0,1)
    ES_LOG_DEBUG("Default textures created (white {}, black {}, flatNormal {})",
                 static_cast<u32>(whiteTexture_), static_cast<u32>(blackTexture_),
                 static_cast<u32>(flatNormalTexture_));
}

void RenderContext::initFrameUbo() {
    FrameConstants initial{};
    frameUbo_ = device_.createBuffer(
        {GfxBufferUsage::Uniform, static_cast<u32>(sizeof(FrameConstants)), /*dynamic=*/true}, &initial);

    // The binding slot persists for the context lifetime; only the contents change
    // per frame. Every engine shader's FrameConstants block is linked to this slot
    // at compile time (Shader::compile).
    device_.setUniformBuffer(FRAME_CONSTANTS_BINDING, frameUbo_);

    TimeConstants time{};
    timeUbo_ = device_.createBuffer(
        {GfxBufferUsage::Uniform, static_cast<u32>(sizeof(TimeConstants)), /*dynamic=*/true}, &time);
    device_.setUniformBuffer(TIME_CONSTANTS_BINDING, timeUbo_);

    // Zeroed fallback for the shared per-draw params slot: a shader whose loose
    // uniforms were lifted into a DrawParams block but whose draw path never
    // commits (e.g. a raw material shader drawn by the batch path) must still
    // find a buffer covering its block there — members then read zero, exactly
    // what their loose-uniform ancestors read.
    const std::vector<u8> zeros(DRAW_PARAMS_FALLBACK_SIZE, 0);
    drawParamsFallback_ = device_.createBuffer(
        {GfxBufferUsage::Uniform, DRAW_PARAMS_FALLBACK_SIZE, /*dynamic=*/false}, zeros.data());
    device_.setUniformBuffer(DRAW_PARAMS_BINDING, drawParamsFallback_);

    ES_LOG_DEBUG("FrameConstants UBO created (handle: {})", static_cast<u32>(frameUbo_));
}

void RenderContext::updateFrameConstants(const glm::mat4& viewProjection) {
    viewProjection_ = viewProjection;
    device_.updateBuffer(frameUbo_, 0, glm::value_ptr(viewProjection), sizeof(glm::mat4));
    // Re-arm the params fallback for this pass: a post-process or custom-draw
    // commit from the previous pass left its own (differently sized) buffer on
    // the shared slot.
    device_.setUniformBuffer(DRAW_PARAMS_BINDING, drawParamsFallback_);
}

void RenderContext::setFrameTime(f32 elapsedSec, u32 viewportW, u32 viewportH) {
    const f32 dt = (lastElapsed_ > 0.0f && elapsedSec > lastElapsed_) ? elapsedSec - lastElapsed_ : 0.0f;
    lastElapsed_ = elapsedSec;
    const f32 w = static_cast<f32>(viewportW);
    const f32 h = static_cast<f32>(viewportH);
    TimeConstants time{
        glm::vec4(elapsedSec, dt, 0.0f, 0.0f),
        glm::vec4(w, h, w > 0.0f ? 1.0f / w : 0.0f, h > 0.0f ? 1.0f / h : 0.0f),
    };
    device_.updateBuffer(timeUbo_, 0, &time, sizeof(TimeConstants));

    // The backbuffer follows the viewport from the same size source the frame
    // clock carries: GL tracks the canvas implicitly (no-op), WebGPU
    // reconfigures its fixed-size swapchain when the size changes. Called at
    // the top of the frame, before any pass opens.
    device_.resizeBackbuffer(viewportW, viewportH);
}

}  // namespace esengine
