/**
 * @file    Framebuffer.cpp
 * @brief   Framebuffer implementation for OpenGL/WebGL
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Framebuffer.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #include <glad/glad.h>
#endif

namespace esengine {

// =============================================================================
// Constructor / Destructor
// =============================================================================

Framebuffer::~Framebuffer() {
    cleanup();
}

Framebuffer::Framebuffer(Framebuffer&& other) noexcept
    : spec_(other.spec_),
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

Unique<Framebuffer> Framebuffer::create(const FramebufferSpec& spec) {
    auto framebuffer = makeUnique<Framebuffer>();
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
    glBindFramebuffer(GL_FRAMEBUFFER, framebufferId_);
}

void Framebuffer::unbind() const {
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void Framebuffer::resize(u32 width, u32 height) {
    if (width == 0 || height == 0 || width > 8192 || height > 8192) {
        ES_LOG_WARN("Invalid framebuffer size: {}x{}", width, height);
        return;
    }

    spec_.width = width;
    spec_.height = height;

    cleanup();
    initialize();
}

// =============================================================================
// Private Methods
// =============================================================================

bool Framebuffer::initialize() {
    glGenFramebuffers(1, &framebufferId_);
    glBindFramebuffer(GL_FRAMEBUFFER, framebufferId_);

    glGenTextures(1, &colorAttachment_);
    glBindTexture(GL_TEXTURE_2D, colorAttachment_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, spec_.width, spec_.height, 0,
                 GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                          GL_TEXTURE_2D, colorAttachment_, 0);

    if (spec_.depthStencil) {
        glGenTextures(1, &depthAttachment_);
        glBindTexture(GL_TEXTURE_2D, depthAttachment_);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, spec_.width, spec_.height, 0,
                     GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
                              GL_TEXTURE_2D, depthAttachment_, 0);
    }

    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        ES_LOG_ERROR("Framebuffer is incomplete! Status: 0x{:X}", status);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return false;
    }

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return true;
}

void Framebuffer::cleanup() {
    if (colorAttachment_) {
        glDeleteTextures(1, &colorAttachment_);
        colorAttachment_ = 0;
    }

    if (depthAttachment_) {
        glDeleteTextures(1, &depthAttachment_);
        depthAttachment_ = 0;
    }

    if (framebufferId_) {
        glDeleteFramebuffers(1, &framebufferId_);
        framebufferId_ = 0;
    }
}

}  // namespace esengine
