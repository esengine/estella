#include "SpritePlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../ecs/components/UIRect.hpp"

#include <cmath>

namespace esengine {

void SpritePlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void SpritePlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto spriteView = registry.view<ecs::Transform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);
        if (!sprite.enabled) continue;
        if (registry.has<ecs::UIRect>(entity)) continue;

        auto& transform = spriteView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        glm::vec2 finalSize = sprite.size * glm::vec2(scale);
        glm::vec2 pivotOffset((0.5f - sprite.pivot.x) * finalSize.x,
                              (0.5f - sprite.pivot.y) * finalSize.y);
        glm::vec3 aabbCenter = position + glm::vec3(pivotOffset, 0.0f);
        glm::vec3 halfExtents = glm::vec3(std::abs(finalSize.x), std::abs(finalSize.y), 0.0f) * 0.5f;
        if (!frustum.intersectsAABB(aabbCenter, halfExtents)) {
            continue;
        }

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);

        u32 textureId = ctx.white_texture_id;
        glm::vec2 texSize{0.0f};
        bool useNineSlice = false;
        resource::SliceBorder sliceBorder{};

        if (sprite.texture.isValid()) {
            Texture* tex = ctx.resources.getTexture(sprite.texture);
            if (tex) {
                textureId = tex->getId();
                texSize = glm::vec2(
                    static_cast<f32>(tex->getWidth()),
                    static_cast<f32>(tex->getHeight())
                );
                const auto* metadata = ctx.resources.getTextureMetadata(sprite.texture);
                if (metadata && metadata->sliceBorder.hasSlicing()) {
                    useNineSlice = true;
                    sliceBorder = metadata->sliceBorder;
                }
            }
        }

        glm::vec2 uvOff = sprite.uvOffset;
        glm::vec2 uvSc = sprite.uvScale;
        if (sprite.flipX) {
            uvOff.x += uvSc.x;
            uvSc.x = -uvSc.x;
        }
        if (sprite.flipY) {
            uvOff.y += uvSc.y;
            uvSc.y = -uvSc.y;
        }

        bool hasTiling = sprite.tileSize.x > 0.0f && sprite.tileSize.y > 0.0f;

        u32 shaderId = (sprite.material != 0) ? sprite.material : batch_shader_id_;
        BlendMode blend = BlendMode::Normal;

        if (hasTiling) {
            emitTiledQuads(buffers, draw_list,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, position.z,
                textureId, sprite.color, uvOff, uvSc,
                sprite.tileSize * glm::vec2(scale),
                sprite.tileSpacing * glm::vec2(scale),
                entity, ctx.current_stage, sprite.layer,
                blend, shaderId, clips);
        } else if (useNineSlice) {
            emitNineSlice(buffers, draw_list,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, position.z,
                textureId, texSize, sliceBorder,
                sprite.color, uvOff, uvSc,
                entity, ctx.current_stage, sprite.layer,
                blend, shaderId, clips);
        } else {
            emitQuad(buffers, draw_list,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, position.z,
                textureId, sprite.color, uvOff, uvSc,
                entity, ctx.current_stage, sprite.layer,
                blend, shaderId, clips);
        }
    }
}

void SpritePlugin::emitQuad(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& pivot,
    f32 angle, f32 depth, u32 textureId,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    Entity entity, RenderStage stage, i32 layer,
    BlendMode blend, u32 shaderId,
    const ClipState& clips
) {
    BatchVertex verts[4];
    f32 ox = 0.5f - pivot.x;
    f32 oy = 0.5f - pivot.y;

    if (std::abs(angle) > 0.001f) {
        f32 cosA = std::cos(angle);
        f32 sinA = std::sin(angle);
        for (u32 i = 0; i < 4; ++i) {
            f32 lx = (QUAD_POSITIONS[i].x + ox) * size.x;
            f32 ly = (QUAD_POSITIONS[i].y + oy) * size.y;
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
                position.x + (QUAD_POSITIONS[i].x + ox) * size.x,
                position.y + (QUAD_POSITIONS[i].y + oy) * size.y
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
    cmd.type = RenderType::Sprite;
    cmd.layer = layer;

    clips.applyTo(entity, cmd);

    draw_list.push(cmd);
}

void SpritePlugin::emitNineSlice(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& pivot,
    f32 angle, f32 depth, u32 textureId,
    const glm::vec2& texSize, const resource::SliceBorder& border,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    Entity entity, RenderStage stage, i32 layer,
    BlendMode blend, u32 shaderId,
    const ClipState& clips
) {
    f32 L = border.left;
    f32 R = border.right;
    f32 T = border.top;
    f32 B = border.bottom;

    f32 baseX = position.x - size.x * pivot.x;
    f32 baseY = position.y - size.y * pivot.y;

    f32 x[4] = { baseX, baseX + L, baseX + size.x - R, baseX + size.x };
    f32 y[4] = { baseY, baseY + B, baseY + size.y - T, baseY + size.y };

    f32 u[4] = {
        uvOffset.x,
        uvOffset.x + L / texSize.x,
        uvOffset.x + uvScale.x - R / texSize.x,
        uvOffset.x + uvScale.x
    };
    f32 v[4] = {
        uvOffset.y,
        uvOffset.y + B / texSize.y,
        uvOffset.y + uvScale.y - T / texSize.y,
        uvOffset.y + uvScale.y
    };

    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);

    auto rotatePoint = [&](f32 px, f32 py) -> glm::vec2 {
        f32 dx = px - position.x;
        f32 dy = py - position.y;
        return glm::vec2(
            position.x + dx * cosA - dy * sinA,
            position.y + dx * sinA + dy * cosA
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
            cmd.type = RenderType::Sprite;
            cmd.layer = layer;

            clips.applyTo(entity, cmd);

            draw_list.push(cmd);
        }
    }
}

void SpritePlugin::emitTiledQuads(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& pivot,
    f32 angle, f32 depth, u32 textureId,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec2& tileSize, const glm::vec2& tileSpacing,
    Entity entity, RenderStage stage, i32 layer,
    BlendMode blend, u32 shaderId,
    const ClipState& clips
) {
    glm::vec2 step = tileSize + tileSpacing;
    if (step.x <= 0.0f || step.y <= 0.0f) return;

    glm::vec2 absSize = glm::vec2(std::abs(size.x), std::abs(size.y));

    f32 baseX = position.x - absSize.x * pivot.x;
    f32 baseY = position.y - absSize.y * pivot.y;

    bool hasRotation = std::abs(angle) > 0.001f;
    f32 cosA = 0.0f, sinA = 0.0f;
    if (hasRotation) {
        cosA = std::cos(angle);
        sinA = std::sin(angle);
    }

    auto rotatePoint = [&](f32 px, f32 py) -> glm::vec2 {
        f32 dx = px - position.x;
        f32 dy = py - position.y;
        return glm::vec2(
            position.x + dx * cosA - dy * sinA,
            position.y + dx * sinA + dy * cosA
        );
    };

    u32 pc = packColor(color);

    DrawCommand tmpl{};
    tmpl.sort_key = DrawCommand::buildSortKey(stage, layer, shaderId, blend, 0, textureId, depth);
    tmpl.index_count = 6;
    tmpl.shader_id = shaderId;
    tmpl.blend_mode = blend;
    tmpl.layout_id = LayoutId::Batch;
    tmpl.texture_count = 1;
    tmpl.texture_ids[0] = textureId;
    tmpl.entity = entity;
    tmpl.type = RenderType::Sprite;
    tmpl.layer = layer;
    clips.applyTo(entity, tmpl);

    i32 tilesY = static_cast<i32>(std::ceil(absSize.y / step.y));
    i32 tilesX = static_cast<i32>(std::ceil(absSize.x / step.x));

    for (i32 iy = 0; iy < tilesY; ++iy) {
        f32 ty = static_cast<f32>(iy) * step.y;
        f32 th = glm::min(tileSize.y, absSize.y - ty);
        if (th <= 0.0f) break;
        f32 vFrac = th / tileSize.y;

        for (i32 ix = 0; ix < tilesX; ++ix) {
            f32 tx = static_cast<f32>(ix) * step.x;
            f32 tw = glm::min(tileSize.x, absSize.x - tx);
            if (tw <= 0.0f) break;
            f32 uFrac = tw / tileSize.x;

            f32 x0 = baseX + tx;
            f32 y0 = baseY + ty;
            f32 x1 = x0 + tw;
            f32 y1 = y0 + th;

            glm::vec2 tileUvScale = { uvScale.x * uFrac, uvScale.y * vFrac };

            BatchVertex verts[4];
            if (hasRotation) {
                verts[0] = { rotatePoint(x0, y0), pc, { uvOffset.x,                uvOffset.y } };
                verts[1] = { rotatePoint(x1, y0), pc, { uvOffset.x + tileUvScale.x, uvOffset.y } };
                verts[2] = { rotatePoint(x1, y1), pc, { uvOffset.x + tileUvScale.x, uvOffset.y + tileUvScale.y } };
                verts[3] = { rotatePoint(x0, y1), pc, { uvOffset.x,                uvOffset.y + tileUvScale.y } };
            } else {
                verts[0] = { { x0, y0 }, pc, { uvOffset.x,                uvOffset.y } };
                verts[1] = { { x1, y0 }, pc, { uvOffset.x + tileUvScale.x, uvOffset.y } };
                verts[2] = { { x1, y1 }, pc, { uvOffset.x + tileUvScale.x, uvOffset.y + tileUvScale.y } };
                verts[3] = { { x0, y1 }, pc, { uvOffset.x,                uvOffset.y + tileUvScale.y } };
            }

            u32 vOff = buffers.appendVertices(verts, sizeof(verts));
            u32 baseVert = vOff / sizeof(BatchVertex);

            u16 indices[6];
            for (u32 i = 0; i < 6; ++i) {
                indices[i] = static_cast<u16>(baseVert + QUAD_INDICES[i]);
            }
            u32 iOff = buffers.appendIndices(indices, 6);

            DrawCommand cmd = tmpl;
            cmd.index_offset = iOff;
            cmd.vertex_byte_offset = vOff;
            draw_list.push(cmd);
        }
    }
}

}  // namespace esengine
