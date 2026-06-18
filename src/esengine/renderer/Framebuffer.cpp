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
 *            Licensed under the MIT License.
 */

#include "Framebuffer.hpp"
#include "GfxDevice.hpp"
#include "../core/Log.hpp"

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
      framebufferId_(other.framebufferId_),
      colorAttachment_(other.colorAttachment_),
      depthAttachment_(other.depthAttachment_) {
    other.framebufferId_ = 0;
    other.colorAttachment_ = 0;
    other.depthAttachment_ = 0;
}

Framebuffer& Framebuffer::operator=(Framebuffer&& other) noexcept {
    if (this != &other) {
        cleanup();
        device_ = other.device_;
        spec_ = other.spec_;
        framebufferId_ = other.framebufferId_;
        colorAttachment_ = other.colorAttachment_;
        depthAttachment_ = other.depthAttachment_;
        other.framebufferId_ = 0;
        other.colorAttachment_ = 0;
        other.depthAttachment_ = 0;
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
    if (device_) device_->bindFramebuffer(framebufferId_);
}

void Framebuffer::unbind() const {
    if (device_) device_->bindFramebuffer(0);
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

    framebufferId_ = device_->createFramebuffer();
    device_->bindFramebuffer(framebufferId_);

    colorAttachment_ = device_->createTexture();
    device_->texImage2D(colorAttachment_, spec_.width, spec_.height, GfxPixelFormat::RGBA8, nullptr);
    device_->setTextureParams(colorAttachment_, filter, filter,
                              TextureWrap::ClampToEdge, TextureWrap::ClampToEdge);
    device_->framebufferTexture2D(framebufferId_, GfxAttachment::Color0, colorAttachment_);

    if (spec_.depthStencil) {
        depthAttachment_ = device_->createTexture();
        device_->texImage2D(depthAttachment_, spec_.width, spec_.height,
                            GfxPixelFormat::Depth24Stencil8, nullptr);
        device_->setTextureParams(depthAttachment_, TextureFilter::Nearest, TextureFilter::Nearest,
                                  TextureWrap::ClampToEdge, TextureWrap::ClampToEdge);
        device_->framebufferTexture2D(framebufferId_, GfxAttachment::DepthStencil, depthAttachment_);
    }

    if (u32 err = device_->getError(); err != 0) {
        ES_LOG_ERROR("Framebuffer GL error before completeness check: 0x{:X} (size: {}x{})",
                     err, spec_.width, spec_.height);
    }

    if (!device_->checkFramebufferStatus()) {
        ES_LOG_ERROR("Framebuffer is incomplete! (size: {}x{})", spec_.width, spec_.height);
        device_->bindFramebuffer(0);
        cleanup();
        return false;
    }

    device_->bindFramebuffer(0);
    return true;
}

void Framebuffer::cleanup() {
    if (!device_) return;

    if (colorAttachment_) {
        device_->deleteTexture(colorAttachment_);
        colorAttachment_ = 0;
    }

    if (depthAttachment_) {
        device_->deleteTexture(depthAttachment_);
        depthAttachment_ = 0;
    }

    if (framebufferId_) {
        device_->deleteFramebuffer(framebufferId_);
        framebufferId_ = 0;
    }
}

}  // namespace esengine
