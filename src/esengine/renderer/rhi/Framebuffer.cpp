// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Framebuffer.cpp
 * @brief   Framebuffer implementation (device-backed)
 * @details Thin RAII handle over a GPU framebuffer + its attachments. All GL is
 *          delegated to GfxDevice; this file contains no GL calls.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "./Framebuffer.hpp"
#include "./GfxDevice.hpp"
#include "../../core/Log.hpp"

namespace esengine {

// =============================================================================
// Constructor / Destructor
// =============================================================================

Framebuffer::~Framebuffer() {
    cleanup();
}

Framebuffer::Framebuffer(Framebuffer&& other) noexcept
    : device_(other.device_),
      spec_(other.spec_),
      handle_(other.handle_),
      colorAttachment_(other.colorAttachment_),
      depthAttachment_(other.depthAttachment_) {
    other.handle_ = FramebufferHandle::Default;
    other.colorAttachment_ = TextureHandle::Invalid;
    other.depthAttachment_ = TextureHandle::Invalid;
}

Framebuffer& Framebuffer::operator=(Framebuffer&& other) noexcept {
    if (this != &other) {
        cleanup();
        device_ = other.device_;
        spec_ = other.spec_;
        handle_ = other.handle_;
        colorAttachment_ = other.colorAttachment_;
        depthAttachment_ = other.depthAttachment_;
        other.handle_ = FramebufferHandle::Default;
        other.colorAttachment_ = TextureHandle::Invalid;
        other.depthAttachment_ = TextureHandle::Invalid;
    }
    return *this;
}

// =============================================================================
// Creation
// =============================================================================

Unique<Framebuffer> Framebuffer::create(GfxDevice& device, const FramebufferSpec& spec) {
    auto framebuffer = makeUnique<Framebuffer>();
    framebuffer->device_ = &device;
    framebuffer->spec_ = spec;

    if (!framebuffer->initialize()) {
        ES_LOG_ERROR("Failed to create framebuffer");
        return nullptr;
    }

    return framebuffer;
}

// =============================================================================
// Operations
// =============================================================================

void Framebuffer::bind() const {
    if (device_) device_->beginRenderPass({handle_});
}

void Framebuffer::unbind() const {
    if (device_) device_->endRenderPass();
}

void Framebuffer::resize(u32 width, u32 height) {
    if (width == 0 || height == 0 || width > 8192 || height > 8192) {
        ES_LOG_WARN("Invalid framebuffer size: {}x{}", width, height);
        return;
    }

    spec_.width = width;
    spec_.height = height;

    cleanup();
    if (!initialize()) {
        ES_LOG_ERROR("Framebuffer resize failed: {}x{}", width, height);
    }
}

// =============================================================================
// Private Methods
// =============================================================================

bool Framebuffer::initialize() {
    const TextureFilter filter = spec_.linearFilter ? TextureFilter::Linear : TextureFilter::Nearest;

    TextureDesc colorDesc;
    colorDesc.width = spec_.width;
    colorDesc.height = spec_.height;
    colorDesc.format = spec_.colorFormat;
    colorDesc.minFilter = filter;
    colorDesc.magFilter = filter;
    colorAttachment_ = device_->createTexture(colorDesc, nullptr);

    if (spec_.depthStencil) {
        TextureDesc depthDesc;
        depthDesc.width = spec_.width;
        depthDesc.height = spec_.height;
        depthDesc.format = GfxPixelFormat::Depth24Stencil8;
        depthDesc.minFilter = TextureFilter::Nearest;
        depthDesc.magFilter = TextureFilter::Nearest;
        depthAttachment_ = device_->createTexture(depthDesc, nullptr);
    }

    handle_ = device_->createFramebuffer({colorAttachment_, depthAttachment_});
    if (handle_ == FramebufferHandle::Default) {
        ES_LOG_ERROR("Framebuffer is incomplete! (size: {}x{}, GL error 0x{:X})",
                     spec_.width, spec_.height, device_->getError());
        cleanup();
        return false;
    }
    return true;
}

void Framebuffer::cleanup() {
    if (!device_) return;

    if (colorAttachment_ != TextureHandle::Invalid) {
        device_->deleteTexture(colorAttachment_);
        colorAttachment_ = TextureHandle::Invalid;
    }

    if (depthAttachment_ != TextureHandle::Invalid) {
        device_->deleteTexture(depthAttachment_);
        depthAttachment_ = TextureHandle::Invalid;
    }

    if (handle_ != FramebufferHandle::Default) {
        device_->deleteFramebuffer(handle_);
        handle_ = FramebufferHandle::Default;
    }
}

}  // namespace esengine
