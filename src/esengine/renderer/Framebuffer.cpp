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
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    #ifndef GL_FRAMEBUFFER
        #define GL_FRAMEBUFFER 0x8D40
        #define GL_COLOR_ATTACHMENT0 0x8CE0
        #define GL_DEPTH_ATTACHMENT 0x8D00
        #define GL_DEPTH_STENCIL_ATTACHMENT 0x821A
        #define GL_FRAMEBUFFER_COMPLETE 0x8CD5
        #define GL_TEXTURE_2D 0x0DE1
        #define GL_DEPTH_COMPONENT 0x1902
        #define GL_DEPTH_COMPONENT24 0x81A6
        #define GL_DEPTH24_STENCIL8 0x88F0
        #define GL_UNSIGNED_INT_24_8 0x84FA
        #define GL_RGB 0x1907
        #define GL_RGBA 0x1908
        #define GL_RGBA8 0x8058
        #define GL_UNSIGNED_BYTE 0x1401
        #define GL_NEAREST 0x2600
        #define GL_CLAMP_TO_EDGE 0x812F
        #define GL_TEXTURE_MIN_FILTER 0x2801
        #define GL_TEXTURE_MAG_FILTER 0x2800
        #define GL_TEXTURE_WRAP_S 0x2802
        #define GL_TEXTURE_WRAP_T 0x2803
    #endif

    extern "C" {
        void glGenFramebuffers(int, unsigned int*);
        void glDeleteFramebuffers(int, const unsigned int*);
        void glBindFramebuffer(unsigned int, unsigned int);
        void glFramebufferTexture2D(unsigned int, unsigned int, unsigned int, unsigned int, int);
        unsigned int glCheckFramebufferStatus(unsigned int);
        void glGenTextures(int, unsigned int*);
        void glDeleteTextures(int, const unsigned int*);
        void glBindTexture(unsigned int, unsigned int);
        void glTexImage2D(unsigned int, int, int, int, int, int, unsigned int, unsigned int, const void*);
        void glTexParameteri(unsigned int, unsigned int, int);
    }
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
        glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH24_STENCIL8, spec_.width, spec_.height, 0,
                     GL_DEPTH_COMPONENT, GL_UNSIGNED_INT_24_8, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT,
                              GL_TEXTURE_2D, depthAttachment_, 0);
    }

    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        ES_LOG_ERROR("Framebuffer is incomplete! Status: 0x{:X}", status);
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        return false;
    }

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    ES_LOG_INFO("Framebuffer created: {}x{}", spec_.width, spec_.height);
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
