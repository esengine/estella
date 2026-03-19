#include "StateTracker.hpp"

namespace esengine {

StateTracker::StateTracker(GfxDevice& device)
    : device_(device) {
}

void StateTracker::init() {
    reset();
    initialized_ = true;
}

void StateTracker::reset() {
    device_.setBlendEnabled(true);
    device_.setBlendMode(BlendMode::Normal);
    blend_mode_ = BlendMode::Normal;
    blend_enabled_ = true;

    device_.setScissorTest(false);
    scissor_enabled_ = false;
    scissor_x_ = 0;
    scissor_y_ = 0;
    scissor_w_ = 0;
    scissor_h_ = 0;

    device_.setStencilTest(false);
    device_.setStencilMask(0xFF);
    stencil_state_ = StencilState::Off;
    stencil_ref_ = 0;

    device_.setDepthTest(false);
    device_.setDepthWrite(true);
    depth_test_ = false;
    depth_write_ = true;

    device_.setCulling(false);
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
    device_.setBlendEnabled(enabled);
}

void StateTracker::setBlendMode(BlendMode mode) {
    if (mode == blend_mode_) return;
    blend_mode_ = mode;
    device_.setBlendMode(mode);
}

void StateTracker::resetBlendState() {
    blend_mode_ = BlendMode::Normal;
}

void StateTracker::setScissorEnabled(bool enabled) {
    if (scissor_enabled_ == enabled) return;
    scissor_enabled_ = enabled;
    device_.setScissorTest(enabled);
}

void StateTracker::setScissor(i32 x, i32 y, i32 w, i32 h) {
    if (scissor_x_ == x && scissor_y_ == y && scissor_w_ == w && scissor_h_ == h) return;
    scissor_x_ = x;
    scissor_y_ = y;
    scissor_w_ = w;
    scissor_h_ = h;
    device_.setScissor(x, y, w, h);
}

void StateTracker::beginStencilWrite(i32 refValue) {
    if (stencil_state_ == StencilState::Write && stencil_ref_ == refValue) return;
    stencil_state_ = StencilState::Write;
    stencil_ref_ = refValue;
    device_.setStencilTest(true);
    device_.setStencilFunc(GfxStencilFunc::Always, refValue, 0xFF);
    device_.setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep, GfxStencilOp::Replace);
    device_.setColorMask(false, false, false, false);
    device_.setStencilMask(0xFF);
}

void StateTracker::endStencilWrite() {
    device_.setColorMask(true, true, true, true);
    device_.setStencilMask(0x00);
}

void StateTracker::beginStencilTest(i32 refValue) {
    if (stencil_state_ == StencilState::Test && stencil_ref_ == refValue) return;
    stencil_state_ = StencilState::Test;
    stencil_ref_ = refValue;
    device_.setStencilTest(true);
    device_.setStencilFunc(GfxStencilFunc::Equal, refValue, 0xFF);
    device_.setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep, GfxStencilOp::Keep);
    device_.setStencilMask(0x00);
}

void StateTracker::endStencilTest() {
    if (stencil_state_ == StencilState::Off) return;
    stencil_state_ = StencilState::Off;
    stencil_ref_ = 0;
    device_.setStencilTest(false);
    device_.setStencilMask(0xFF);
}

void StateTracker::bindTexture(u32 slot, u32 textureId) {
    if (slot < MAX_TEXTURE_SLOTS && bound_textures_[slot] == textureId) return;
    if (slot < MAX_TEXTURE_SLOTS) {
        bound_textures_[slot] = textureId;
    }
    device_.bindTexture(slot, textureId);
}

void StateTracker::useProgram(u32 programId) {
    if (current_program_ == programId) return;
    current_program_ = programId;
    device_.useProgram(programId);
}

void StateTracker::setDepthTest(bool enabled) {
    if (depth_test_ == enabled) return;
    depth_test_ = enabled;
    device_.setDepthTest(enabled);
}

void StateTracker::setDepthWrite(bool enabled) {
    if (depth_write_ == enabled) return;
    depth_write_ = enabled;
    device_.setDepthWrite(enabled);
}

void StateTracker::setViewport(i32 x, i32 y, u32 w, u32 h) {
    if (vp_x_ == x && vp_y_ == y && vp_w_ == w && vp_h_ == h) return;
    vp_x_ = x;
    vp_y_ = y;
    vp_w_ = w;
    vp_h_ = h;
    device_.setViewport(x, y, w, h);
}

void StateTracker::setCulling(bool enabled) {
    if (cull_enabled_ == enabled) return;
    cull_enabled_ = enabled;
    device_.setCulling(enabled);
}

void StateTracker::setCullFace(bool front) {
    if (cull_front_ == front) return;
    cull_front_ = front;
    device_.setCullFace(front);
}

}  // namespace esengine
