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

#include <algorithm>

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
      depthAttachment_(other.depthAttachment_),
      resolveColor_(other.resolveColor_),
      resolveDepth_(other.resolveDepth_),
      colorAttachment1_(other.colorAttachment1_),
      resolveColor1_(other.resolveColor1_),
      colorAttachment2_(other.colorAttachment2_),
      resolveColor2_(other.resolveColor2_) {
    other.colorAttachment1_ = TextureHandle::Invalid;
    other.resolveColor1_ = TextureHandle::Invalid;
    other.colorAttachment2_ = TextureHandle::Invalid;
    other.resolveColor2_ = TextureHandle::Invalid;
    other.handle_ = FramebufferHandle::Default;
    other.colorAttachment_ = TextureHandle::Invalid;
    other.depthAttachment_ = TextureHandle::Invalid;
    other.resolveColor_ = TextureHandle::Invalid;
    other.resolveDepth_ = TextureHandle::Invalid;
}

Framebuffer& Framebuffer::operator=(Framebuffer&& other) noexcept {
    if (this != &other) {
        cleanup();
        device_ = other.device_;
        spec_ = other.spec_;
        handle_ = other.handle_;
        colorAttachment_ = other.colorAttachment_;
        depthAttachment_ = other.depthAttachment_;
        resolveColor_ = other.resolveColor_;
        resolveDepth_ = other.resolveDepth_;
        colorAttachment1_ = other.colorAttachment1_;
        resolveColor1_ = other.resolveColor1_;
        colorAttachment2_ = other.colorAttachment2_;
        resolveColor2_ = other.resolveColor2_;
        other.colorAttachment1_ = TextureHandle::Invalid;
        other.resolveColor1_ = TextureHandle::Invalid;
        other.colorAttachment2_ = TextureHandle::Invalid;
        other.resolveColor2_ = TextureHandle::Invalid;
        other.handle_ = FramebufferHandle::Default;
        other.colorAttachment_ = TextureHandle::Invalid;
        other.depthAttachment_ = TextureHandle::Invalid;
        other.resolveColor_ = TextureHandle::Invalid;
        other.resolveDepth_ = TextureHandle::Invalid;
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
    // The backend's ceiling, not the caller's wish: asking a backend with no MSAA
    // for samples would leave a resolve reading an attachment nothing multisampled.
    const u32 samples = std::min(std::max(spec_.samples, 1u), device_->maxSamples());

    TextureDesc colorDesc;
    colorDesc.width = spec_.width;
    colorDesc.height = spec_.height;
    colorDesc.format = spec_.colorFormat;
    colorDesc.minFilter = filter;
    colorDesc.magFilter = filter;
    colorDesc.samples = samples;
    colorDesc.storage = spec_.storage && samples == 1 && device_->supportsCompute();
    colorAttachment_ = device_->createTexture(colorDesc, GfxContent::transient(), nullptr);

    // The surface's own record: 8 bits a channel is what an octahedral normal, a roughness and a metalness
    // need, and a float target would spend four times the bandwidth for precision none of them uses.
    if (spec_.gbuffer) {
        TextureDesc gDesc = colorDesc;
        gDesc.format = GfxPixelFormat::RGBA8;
        // Nearest: a normal or a roughness blended with its neighbour's is neither's.
        gDesc.minFilter = TextureFilter::Nearest;
        gDesc.magFilter = TextureFilter::Nearest;
        colorAttachment1_ = device_->createTexture(gDesc, GfxContent::transient(), nullptr);
        // Beside it, the surface's diffuse colour: light an effect adds after the frame lit it (bounce
        // light) is coloured by what it lands on, and the lit picture cannot say that where the frame left it dark.
        colorAttachment2_ = device_->createTexture(gDesc, GfxContent::transient(), nullptr);
        if (samples > 1) {
            gDesc.samples = 1;
            resolveColor1_ = device_->createTexture(gDesc, GfxContent::transient(), nullptr);
            resolveColor2_ = device_->createTexture(gDesc, GfxContent::transient(), nullptr);
        }
    }

    TextureDesc depthDesc;
    depthDesc.width = spec_.width;
    depthDesc.height = spec_.height;
    depthDesc.format = GfxPixelFormat::Depth24Stencil8;
    depthDesc.minFilter = TextureFilter::Nearest;
    depthDesc.magFilter = TextureFilter::Nearest;
    if (spec_.depthStencil) {
        depthDesc.samples = samples;
        depthAttachment_ = device_->createTexture(depthDesc, GfxContent::transient(), nullptr);
    }

    // The single-sample twins the multisampled attachments resolve into. They
    // belong to this target: it is what makes a multisampled target sampleable,
    // and no pass or effect has to know it happened.
    if (samples > 1) {
        colorDesc.samples = 1;
        resolveColor_ = device_->createTexture(colorDesc, GfxContent::transient(), nullptr);
        // Depth resolves only where the backend can: WebGPU has no depth resolve,
        // and a twin nothing ever writes would hand an effect an empty depth
        // buffer that looks like a working one.
        if (spec_.depthStencil && device_->resolvesDepth()) {
            depthDesc.samples = 1;
            resolveDepth_ = device_->createTexture(depthDesc, GfxContent::transient(), nullptr);
        }
    }

    FramebufferDesc fb;
    fb.color0 = colorAttachment_;
    fb.depthStencil = depthAttachment_;
    fb.resolveColor0 = resolveColor_;
    fb.resolveDepthStencil = resolveDepth_;
    fb.color1 = colorAttachment1_;
    fb.resolveColor1 = resolveColor1_;
    fb.color2 = colorAttachment2_;
    fb.resolveColor2 = resolveColor2_;
    fb.width = spec_.width;
    fb.height = spec_.height;
    handle_ = device_->createFramebuffer(fb);
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

    if (resolveColor_ != TextureHandle::Invalid) {
        device_->deleteTexture(resolveColor_);
        resolveColor_ = TextureHandle::Invalid;
    }
    if (resolveColor1_ != TextureHandle::Invalid) {
        device_->deleteTexture(resolveColor1_);
        resolveColor1_ = TextureHandle::Invalid;
    }
    if (colorAttachment1_ != TextureHandle::Invalid) {
        device_->deleteTexture(colorAttachment1_);
        colorAttachment1_ = TextureHandle::Invalid;
    }
    if (resolveColor2_ != TextureHandle::Invalid) {
        device_->deleteTexture(resolveColor2_);
        resolveColor2_ = TextureHandle::Invalid;
    }
    if (colorAttachment2_ != TextureHandle::Invalid) {
        device_->deleteTexture(colorAttachment2_);
        colorAttachment2_ = TextureHandle::Invalid;
    }
    if (resolveDepth_ != TextureHandle::Invalid) {
        device_->deleteTexture(resolveDepth_);
        resolveDepth_ = TextureHandle::Invalid;
    }
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
