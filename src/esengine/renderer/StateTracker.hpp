#pragma once

#include "../core/Types.hpp"
#include "BlendMode.hpp"
#include "GfxDevice.hpp"

#include <array>

namespace esengine {

class StateTracker {
public:
    explicit StateTracker(GfxDevice& device);

    void init();
    void reset();

    void setBlendEnabled(bool enabled);
    void setBlendMode(BlendMode mode);
    void resetBlendState();

    void setScissorEnabled(bool enabled);
    void setScissor(i32 x, i32 y, i32 w, i32 h);

    void beginStencilWrite(i32 refValue);
    void endStencilWrite();
    void beginStencilTest(i32 refValue);
    void endStencilTest();

    void bindTexture(u32 slot, u32 textureId);

    void useProgram(u32 programId);

    void setDepthTest(bool enabled);
    void setDepthWrite(bool enabled);

    void setViewport(i32 x, i32 y, u32 w, u32 h);

    void setCulling(bool enabled);
    void setCullFace(bool front);

    /** @brief Gets the underlying graphics device */
    GfxDevice& device() { return device_; }

    static constexpr u32 MAX_TEXTURE_SLOTS = 16;

private:
    GfxDevice& device_;

    BlendMode blend_mode_ = BlendMode::Normal;
    bool blend_enabled_ = true;

    bool scissor_enabled_ = false;
    i32 scissor_x_ = 0, scissor_y_ = 0, scissor_w_ = 0, scissor_h_ = 0;

    enum class StencilState : u8 { Off, Write, Test };
    StencilState stencil_state_ = StencilState::Off;
    i32 stencil_ref_ = 0;

    bool depth_test_ = false;
    bool depth_write_ = true;

    u32 current_program_ = 0;
    std::array<u32, MAX_TEXTURE_SLOTS> bound_textures_{};

    i32 vp_x_ = -1, vp_y_ = -1;
    u32 vp_w_ = 0, vp_h_ = 0;

    bool cull_enabled_ = false;
    bool cull_front_ = false;

    bool initialized_ = false;
};

}  // namespace esengine
