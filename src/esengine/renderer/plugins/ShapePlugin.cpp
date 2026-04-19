#include "ShapePlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Shader.hpp"
#include "../ShaderEmbeds.generated.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ShapeRenderer.hpp"
#include "../../resource/ShaderParser.hpp"

#include <cmath>

namespace esengine {

void ShapePlugin::init(RenderFrameContext& ctx) {
    auto shapeParsed = resource::ShaderParser::parse(ShaderEmbeds::SHAPE);
    shape_shader_handle_ = ctx.resources.createShaderWithBindings(
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Fragment),
        {{0, "a_position"}, {1, "a_texCoord"}, {2, "a_color"}, {3, "a_shapeInfo"}}
    );

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
        transform.ensureDecomposed();
        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        glm::vec3 halfExtents = glm::vec3(shape.size.x * scale.x, shape.size.y * scale.y, 0.0f) * 0.5f;
        if (!frustum.intersectsAABB(position, halfExtents)) {
            continue;
        }

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);
        f32 cosA = std::cos(angle);
        f32 sinA = std::sin(angle);

        glm::vec2 halfSize = shape.size * glm::vec2(scale) * 0.5f;
        glm::vec2 pos(position);

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
            verts[v].cornerRadius = shape.cornerRadius;
        }

        u32 vOff = buffers.appendVertices(LayoutId::Shape, verts, sizeof(verts));
        u32 baseVertex = vOff / sizeof(ShapeVertex);

        u16 indices[6];
        for (u32 i = 0; i < 6; ++i) {
            indices[i] = static_cast<u16>(baseVertex + QUAD_INDICES[i]);
        }
        u32 iOff = buffers.appendIndices(LayoutId::Shape, indices, 6);

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(ctx.current_stage, shape.layer, shape_shader_id_, BlendMode::Normal, 0, 0, position.z);
        cmd.index_offset = iOff;
        cmd.index_count = 6;
        cmd.vertex_byte_offset = vOff;
        cmd.shader_id = shape_shader_id_;
        cmd.blend_mode = BlendMode::Normal;
        cmd.layout_id = LayoutId::Shape;
        cmd.texture_count = 0;
        cmd.entity = entity;
        cmd.type = RenderType::Shape;
        cmd.layer = shape.layer;
        cmd.state_flags |= CMD_STATE_CUSTOM_DRAW;

        clips.applyTo(entity, cmd);

        draw_list.push(cmd);
    }
}

void ShapePlugin::customDraw(
    const DrawCommand& cmd,
    StateTracker& state,
    TransientBufferPool& buffers,
    RenderFrameContext& ctx
) {
    Shader* shader = ctx.resources.getShader(shape_shader_handle_);
    if (!shader || !shader->isValid()) return;

    shader->bind();
    shader->setUniform("u_projection", ctx.view_projection);

    state.setBlendEnabled(true);
    state.setBlendMode(BlendMode::Normal);

    buffers.bindLayout(LayoutId::Shape);

    state.device().drawElements(
        cmd.index_count,
        GfxDataType::UnsignedShort,
        static_cast<u32>(cmd.index_offset * sizeof(u16)));
}

}  // namespace esengine
