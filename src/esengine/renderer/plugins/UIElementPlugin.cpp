#include "UIElementPlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/UIRenderer.hpp"
#include "../../ecs/components/UIRect.hpp"

#include <cmath>

namespace esengine {

void UIElementPlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void UIElementPlugin::collect(
    ecs::Registry& registry,
    const Frustum& frustum,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    auto uiView = registry.view<ecs::Transform, ecs::UIRenderer, ecs::UIRect>();

    for (auto entity : uiView) {
        const auto& renderer = uiView.get<ecs::UIRenderer>(entity);
        if (!renderer.enabled || renderer.visualType == ecs::UIVisualType::None) continue;

        auto& transform = uiView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const auto& rect = uiView.get<ecs::UIRect>(entity);

        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        f32 w = rect.computed_size_.x;
        f32 h = rect.computed_size_.y;
        if (w <= 0.0f && h <= 0.0f) continue;

        f32 dx = (0.5f - rect.pivot.x) * w * scale.x;
        f32 dy = (0.5f - rect.pivot.y) * h * scale.y;
        f32 sinHalf = rotation.z;
        if (sinHalf * sinHalf > 1e-6f) {
            f32 cosHalf = rotation.w;
            f32 s = 2.0f * sinHalf * cosHalf;
            f32 c = cosHalf * cosHalf - sinHalf * sinHalf;
            f32 rdx = dx * c - dy * s;
            f32 rdy = dx * s + dy * c;
            dx = rdx;
            dy = rdy;
        }
        position.x += dx;
        position.y += dy;

        glm::vec3 halfExtents = glm::vec3(w * scale.x, h * scale.y, 0.0f) * 0.5f;
        if (!frustum.intersectsAABB(position, halfExtents)) continue;

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);
        i32 layer = UI_BASE_LAYER + renderer.uiOrder;

        u32 textureId = ctx.white_texture_id;
        glm::vec2 texSize{0.0f};
        bool useNineSlice = false;
        glm::vec4 sliceBorder{0.0f};

        if (renderer.texture.isValid()) {
            Texture* tex = ctx.resources.getTexture(renderer.texture);
            if (tex) {
                textureId = tex->getId();
                texSize = glm::vec2(
                    static_cast<f32>(tex->getWidth()),
                    static_cast<f32>(tex->getHeight())
                );
                const auto* metadata = ctx.resources.getTextureMetadata(renderer.texture);
                if (metadata && metadata->sliceBorder.hasSlicing()) {
                    useNineSlice = true;
                    sliceBorder = glm::vec4(
                        metadata->sliceBorder.left,
                        metadata->sliceBorder.right,
                        metadata->sliceBorder.top,
                        metadata->sliceBorder.bottom
                    );
                }
            }
        }

        if (renderer.visualType == ecs::UIVisualType::NineSlice) {
            useNineSlice = true;
            if (sliceBorder == glm::vec4(0.0f)) {
                sliceBorder = renderer.sliceBorder;
            }
        }

        glm::vec2 finalSize = rect.computed_size_ * glm::vec2(scale);
        u32 shaderId = batch_shader_id_;
        BlendMode blend = BlendMode::Normal;

        if (useNineSlice) {
            emitNineSlice(buffers, draw_list,
                glm::vec2(position), finalSize, angle, position.z,
                textureId, texSize, sliceBorder,
                renderer.color, renderer.uvOffset, renderer.uvScale,
                entity, ctx.current_stage, layer,
                blend, shaderId, clips);
        } else {
            emitQuad(buffers, draw_list,
                glm::vec2(position), finalSize, angle, position.z,
                textureId, renderer.color, renderer.uvOffset, renderer.uvScale,
                entity, ctx.current_stage, layer,
                blend, shaderId, clips);
        }
    }

}

void UIElementPlugin::emitQuad(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    f32 angle, f32 depth, u32 textureId,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    Entity entity, RenderStage stage, i32 layer,
    BlendMode blend, u32 shaderId,
    const ClipState& clips
) {
    BatchVertex verts[4];

    if (std::abs(angle) > 0.001f) {
        f32 cosA = std::cos(angle);
        f32 sinA = std::sin(angle);
        for (u32 i = 0; i < 4; ++i) {
            f32 lx = QUAD_POSITIONS[i].x * size.x;
            f32 ly = QUAD_POSITIONS[i].y * size.y;
            verts[i].position = glm::vec2(
                position.x + lx * cosA - ly * sinA,
                position.y + lx * sinA + ly * cosA
            );
            verts[i].color = packColor(color);
            verts[i].texCoord = QUAD_TEX_COORDS[i] * uvScale + uvOffset;
        }
    } else {
        for (u32 i = 0; i < 4; ++i) {
            verts[i].position = glm::vec2(
                position.x + QUAD_POSITIONS[i].x * size.x,
                position.y + QUAD_POSITIONS[i].y * size.y
            );
            verts[i].color = packColor(color);
            verts[i].texCoord = QUAD_TEX_COORDS[i] * uvScale + uvOffset;
        }
    }

    u32 vOff = buffers.appendVertices(verts, sizeof(verts));
    u32 baseVertex = vOff / sizeof(BatchVertex);

    u16 indices[6];
    for (u32 i = 0; i < 6; ++i) {
        indices[i] = static_cast<u16>(baseVertex + QUAD_INDICES[i]);
    }
    u32 iOff = buffers.appendIndices(indices, 6);

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(stage, layer, shaderId, blend, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = 6;
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = shaderId;
    cmd.blend_mode = blend;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::UIElement;
    cmd.layer = layer;

    clips.applyTo(entity, cmd);

    draw_list.push(cmd);
}

void UIElementPlugin::emitNineSlice(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    f32 angle, f32 depth, u32 textureId,
    const glm::vec2& texSize, const glm::vec4& sliceBorder,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    Entity entity, RenderStage stage, i32 layer,
    BlendMode blend, u32 shaderId,
    const ClipState& clips
) {
    f32 L = sliceBorder.x;
    f32 R = sliceBorder.y;
    f32 T = sliceBorder.z;
    f32 B = sliceBorder.w;

    f32 baseX = position.x - size.x * 0.5f;
    f32 baseY = position.y - size.y * 0.5f;

    f32 x[4] = { baseX, baseX + L, baseX + size.x - R, baseX + size.x };
    f32 y[4] = { baseY, baseY + B, baseY + size.y - T, baseY + size.y };

    f32 u[4], v[4];
    if (texSize.x > 0.0f && texSize.y > 0.0f) {
        u[0] = uvOffset.x;
        u[1] = uvOffset.x + L / texSize.x;
        u[2] = uvOffset.x + uvScale.x - R / texSize.x;
        u[3] = uvOffset.x + uvScale.x;
        v[0] = uvOffset.y;
        v[1] = uvOffset.y + B / texSize.y;
        v[2] = uvOffset.y + uvScale.y - T / texSize.y;
        v[3] = uvOffset.y + uvScale.y;
    } else {
        u[0] = uvOffset.x;
        u[1] = uvOffset.x;
        u[2] = uvOffset.x + uvScale.x;
        u[3] = uvOffset.x + uvScale.x;
        v[0] = uvOffset.y;
        v[1] = uvOffset.y;
        v[2] = uvOffset.y + uvScale.y;
        v[3] = uvOffset.y + uvScale.y;
    }

    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);

    auto rotatePoint = [&](f32 px, f32 py) -> glm::vec2 {
        f32 ddx = px - position.x;
        f32 ddy = py - position.y;
        return glm::vec2(
            position.x + ddx * cosA - ddy * sinA,
            position.y + ddx * sinA + ddy * cosA
        );
    };

    for (i32 row = 0; row < 3; ++row) {
        for (i32 col = 0; col < 3; ++col) {
            f32 pw = x[col + 1] - x[col];
            f32 ph = y[row + 1] - y[row];
            if (pw <= 0.0f || ph <= 0.0f) continue;

            BatchVertex verts[4];
            glm::vec2 p0 = rotatePoint(x[col],     y[row]);
            glm::vec2 p1 = rotatePoint(x[col + 1], y[row]);
            glm::vec2 p2 = rotatePoint(x[col + 1], y[row + 1]);
            glm::vec2 p3 = rotatePoint(x[col],     y[row + 1]);

            u32 pc = packColor(color);
            verts[0] = { p0, pc, {u[col],     v[row]}     };
            verts[1] = { p1, pc, {u[col + 1], v[row]}     };
            verts[2] = { p2, pc, {u[col + 1], v[row + 1]} };
            verts[3] = { p3, pc, {u[col],     v[row + 1]} };

            u32 vOff = buffers.appendVertices(verts, sizeof(verts));
            u32 baseVert = vOff / sizeof(BatchVertex);

            u16 indices[6];
            for (u32 i = 0; i < 6; ++i) {
                indices[i] = static_cast<u16>(baseVert + QUAD_INDICES[i]);
            }
            u32 iOff = buffers.appendIndices(indices, 6);

            DrawCommand cmd{};
            cmd.sort_key = DrawCommand::buildSortKey(stage, layer, shaderId, blend, 0, textureId, depth);
            cmd.index_offset = iOff;
            cmd.index_count = 6;
            cmd.vertex_byte_offset = vOff;
            cmd.shader_id = shaderId;
            cmd.blend_mode = blend;
            cmd.layout_id = LayoutId::Batch;
            cmd.texture_count = 1;
            cmd.texture_ids[0] = textureId;
            cmd.entity = entity;
            cmd.type = RenderType::UIElement;
            cmd.layer = layer;

            clips.applyTo(entity, cmd);

            draw_list.push(cmd);
        }
    }
}

}  // namespace esengine
