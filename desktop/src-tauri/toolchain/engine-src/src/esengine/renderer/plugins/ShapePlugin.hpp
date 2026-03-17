#pragma once

#include "../RenderTypePlugin.hpp"

namespace esengine {

class Shader;

class ShapePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override;

    void collect(
        ecs::Registry& registry,
        const Frustum& frustum,
        const ClipState& clips,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        RenderFrameContext& ctx
    ) override;

    bool needsCustomDraw() const override { return true; }
    void customDraw(const DrawCommand& cmd,
                    StateTracker& state,
                    TransientBufferPool& buffers,
                    RenderFrameContext& ctx) override;

private:
    struct ShapeVertex {
        f32 px, py;
        f32 ux, uy;
        f32 cr, cg, cb, ca;
        f32 shapeType, halfW, halfH, cornerRadius;
    };

    static constexpr u16 QUAD_INDICES[6] = { 0, 1, 2, 2, 3, 0 };

    resource::ShaderHandle shape_shader_handle_;
    u32 shape_shader_id_ = 0;
};

}  // namespace esengine
