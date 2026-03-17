#include "StateTracker.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

namespace esengine {

void StateTracker::init() {
    reset();
    initialized_ = true;
}

void StateTracker::reset() {
    glEnable(GL_BLEND);
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    blend_mode_ = BlendMode::Normal;
    blend_enabled_ = true;

    glDisable(GL_SCISSOR_TEST);
    scissor_enabled_ = false;
    scissor_x_ = 0;
    scissor_y_ = 0;
    scissor_w_ = 0;
    scissor_h_ = 0;

    glDisable(GL_STENCIL_TEST);
    glStencilMask(0xFF);
    stencil_state_ = StencilState::Off;
    stencil_ref_ = 0;

    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_TRUE);
    depth_test_ = false;
    depth_write_ = true;

    glDisable(GL_CULL_FACE);
    cull_enabled_ = false;
    cull_front_ = false;

    current_program_ = 0;
    bound_textures_.fill(0);

    vp_x_ = -1;
    vp_y_ = -1;
    vp_w_ = 0;
    vp_h_ = 0;
}

void StateTracker::setBlendEnabled(bool enabled) {
    if (blend_enabled_ == enabled) return;
    blend_enabled_ = enabled;
    if (enabled) {
        glEnable(GL_BLEND);
    } else {
        glDisable(GL_BLEND);
    }
}

void StateTracker::setBlendMode(BlendMode mode) {
    if (mode == blend_mode_) return;
    blend_mode_ = mode;
    switch (mode) {
        case BlendMode::Normal:
            glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case BlendMode::Additive:
            glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE, GL_ONE, GL_ONE);
            break;
        case BlendMode::Multiply:
            glBlendFuncSeparate(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case BlendMode::Screen:
            glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_COLOR, GL_ONE, GL_ONE_MINUS_SRC_COLOR);
            break;
        case BlendMode::PremultipliedAlpha:
            glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case BlendMode::PmaAdditive:
            glBlendFuncSeparate(GL_ONE, GL_ONE, GL_ONE, GL_ONE);
            break;
    }
}

void StateTracker::resetBlendState() {
    blend_mode_ = BlendMode::Normal;
}

void StateTracker::setScissorEnabled(bool enabled) {
    if (scissor_enabled_ == enabled) return;
    scissor_enabled_ = enabled;
    if (enabled) {
        glEnable(GL_SCISSOR_TEST);
    } else {
        glDisable(GL_SCISSOR_TEST);
    }
}

void StateTracker::setScissor(i32 x, i32 y, i32 w, i32 h) {
    if (scissor_x_ == x && scissor_y_ == y && scissor_w_ == w && scissor_h_ == h) return;
    scissor_x_ = x;
    scissor_y_ = y;
    scissor_w_ = w;
    scissor_h_ = h;
    glScissor(x, y, w, h);
}

void StateTracker::beginStencilWrite(i32 refValue) {
    if (stencil_state_ == StencilState::Write && stencil_ref_ == refValue) return;
    stencil_state_ = StencilState::Write;
    stencil_ref_ = refValue;
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_ALWAYS, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
    glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
    glStencilMask(0xFF);
}

void StateTracker::endStencilWrite() {
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glStencilMask(0x00);
}

void StateTracker::beginStencilTest(i32 refValue) {
    if (stencil_state_ == StencilState::Test && stencil_ref_ == refValue) return;
    stencil_state_ = StencilState::Test;
    stencil_ref_ = refValue;
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_EQUAL, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
    glStencilMask(0x00);
}

void StateTracker::endStencilTest() {
    if (stencil_state_ == StencilState::Off) return;
    stencil_state_ = StencilState::Off;
    stencil_ref_ = 0;
    glDisable(GL_STENCIL_TEST);
    glStencilMask(0xFF);
}

void StateTracker::bindTexture(u32 slot, u32 textureId) {
    if (slot < MAX_TEXTURE_SLOTS && bound_textures_[slot] == textureId) return;
    if (slot < MAX_TEXTURE_SLOTS) {
        bound_textures_[slot] = textureId;
    }
    glActiveTexture(GL_TEXTURE0 + slot);
    glBindTexture(GL_TEXTURE_2D, textureId);
}

void StateTracker::useProgram(u32 programId) {
    if (current_program_ == programId) return;
    current_program_ = programId;
    glUseProgram(programId);
}

void StateTracker::setDepthTest(bool enabled) {
    if (depth_test_ == enabled) return;
    depth_test_ = enabled;
    if (enabled) {
        glEnable(GL_DEPTH_TEST);
    } else {
        glDisable(GL_DEPTH_TEST);
    }
}

void StateTracker::setDepthWrite(bool enabled) {
    if (depth_write_ == enabled) return;
    depth_write_ = enabled;
    glDepthMask(enabled ? GL_TRUE : GL_FALSE);
}

void StateTracker::setViewport(i32 x, i32 y, u32 w, u32 h) {
    if (vp_x_ == x && vp_y_ == y && vp_w_ == w && vp_h_ == h) return;
    vp_x_ = x;
    vp_y_ = y;
    vp_w_ = w;
    vp_h_ = h;
    glViewport(x, y, static_cast<GLsizei>(w), static_cast<GLsizei>(h));
}

void StateTracker::setCulling(bool enabled) {
    if (cull_enabled_ == enabled) return;
    cull_enabled_ = enabled;
    if (enabled) {
        glEnable(GL_CULL_FACE);
    } else {
        glDisable(GL_CULL_FACE);
    }
}

void StateTracker::setCullFace(bool front) {
    if (cull_front_ == front) return;
    cull_front_ = front;
    glCullFace(front ? GL_FRONT : GL_BACK);
}

}  // namespace esengine
