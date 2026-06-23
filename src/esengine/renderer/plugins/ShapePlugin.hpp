// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../RenderTypePlugin.hpp"

namespace esengine {

class Shader;

class ShapePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override;

    void collect(RenderCollectContext& ctx) override;

private:
    struct ShapeVertex {
        f32 px, py;
        f32 ux, uy;
        f32 cr, cg, cb, ca;
        f32 shapeType, halfW, halfH, cornerRadius;
    };

    static constexpr u32 QUAD_INDICES[6] = { 0, 1, 2, 2, 3, 0 };

    resource::ShaderHandle shape_shader_handle_;
    u32 shape_shader_id_ = 0;
};

}  // namespace esengine
