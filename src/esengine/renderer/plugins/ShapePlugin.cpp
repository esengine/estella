// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ShapePlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../frame/RenderContext.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ShapeRenderer.hpp"
#include "../../resource/ShaderParser.hpp"

#include <cmath>

namespace esengine {

void ShapePlugin::init(RenderFrameContext& ctx) {
    // One path for both backends: the WGSL twin rides shape.esshader, so the
    // stages assemble for the preferred target. Attribute name bindings are a
    // GL link-time concept; the WGSL twin fixes its locations in-source.
    // A device rebuild runs init() again; releasing the previous handle is what
    // keeps the pool from filling with shaders of dead contexts.
    if (shape_shader_handle_.isValid()) ctx.resources.releaseShader(shape_shader_handle_);
    const auto target = ctx.resources.preferredShaderTarget();
    auto shapeParsed = resource::ShaderParser::parse(ShaderEmbeds::SHAPE);
    shape_shader_handle_ = ctx.resources.createShaderWithBindings(
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Vertex, "", {}, target),
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Fragment, "", {}, target),
        {{0, "a_position"}, {1, "a_texCoord"}, {2, "a_color"}, {3, "a_shapeInfo"}},
        ctx.resources.preferredShaderLanguage());

    Shader* shader = ctx.resources.getShader(shape_shader_handle_);
    shape_shader_id_ = shader ? shader->getProgramId() : 0;
}

void ShapePlugin::shutdown() {
}

void ShapePlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto shapeView = registry.view<ecs::Transform, ecs::ShapeRenderer>();

    for (auto entity : shapeView) {
        const auto& shape = shapeView.get<ecs::ShapeRenderer>(entity);
        if (!shape.enabled) continue;

        auto& transform = shapeView.get<ecs::Transform>(entity);
        glm::vec3 position = parallaxedWorldPosition(transform, shape.parallax, collect_ctx.camera);
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        glm::vec3 halfExtents = glm::vec3(shape.size.x * scale.x, shape.size.y * scale.y, 0.0f) * 0.5f;
        if (!frustum.intersectsAABB(position, halfExtents)) {
            continue;
        }

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);
        f32 cosA = std::cos(angle);
        f32 sinA = std::sin(angle);

        glm::vec2 scale2 = glm::vec2(scale);
        glm::vec2 halfSize = shape.size * scale2 * 0.5f;
        glm::vec2 pos(position);
        // The corner radius must scale with the box, or a scaled rounded-rect keeps
        // its absolute radius and the rounding looks proportionally tighter. Average
        // the two axes for a uniform-scale approximation (exact when scale is uniform).
        f32 cornerScale = 0.5f * (std::abs(scale2.x) + std::abs(scale2.y));

        glm::vec2 localCorners[4] = {
            {-halfSize.x, -halfSize.y},
            { halfSize.x, -halfSize.y},
            { halfSize.x,  halfSize.y},
            {-halfSize.x,  halfSize.y},
        };

        glm::vec2 uvCorners[4] = {
            {-1.0f, -1.0f},
            { 1.0f, -1.0f},
            { 1.0f,  1.0f},
            {-1.0f,  1.0f},
        };

        ShapeVertex verts[4];
        for (u32 v = 0; v < 4; ++v) {
            f32 rx = localCorners[v].x * cosA - localCorners[v].y * sinA;
            f32 ry = localCorners[v].x * sinA + localCorners[v].y * cosA;

            verts[v].px = pos.x + rx;
            verts[v].py = pos.y + ry;
            verts[v].ux = uvCorners[v].x;
            verts[v].uy = uvCorners[v].y;
            verts[v].cr = shape.color.r;
            verts[v].cg = shape.color.g;
            verts[v].cb = shape.color.b;
            verts[v].ca = shape.color.a;
            verts[v].shapeType = static_cast<f32>(shape.shapeType);
            verts[v].halfW = halfSize.x;
            verts[v].halfH = halfSize.y;
            verts[v].cornerRadius = shape.cornerRadius * cornerScale;
        }

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = shape.layer,
            .shaderId = shape_shader_id_,
            .blend = BlendMode::Normal,
            .depth = collect_ctx.camera.viewDepth(position),
            .y = position.y,
            .entity = entity,
            .type = RenderType::Shape,
            .layoutId = LayoutId::Shape,
        };
        appendIndexedDraw(buffers, draw_list, clips, verts, 4, BATCH_QUAD_INDICES, 6, key);
    }
}

}  // namespace esengine
