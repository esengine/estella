#include "SpritePlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../ecs/components/UIRect.hpp"

#include <cmath>

namespace esengine {

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

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = sprite.layer,
            .shaderId = shaderId,
            .blend = BlendMode::Normal,
            .textureId = textureId,
            .depth = position.z,
            .entity = entity,
            .type = RenderType::Sprite,
        };

        if (hasTiling) {
            emitTiledQuads(buffers, draw_list, clips,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, sprite.color, uvOff, uvSc,
                sprite.tileSize * glm::vec2(scale),
                sprite.tileSpacing * glm::vec2(scale),
                key);
        } else if (useNineSlice) {
            emitNineSlice(buffers, draw_list, clips,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, texSize,
                glm::vec4(sliceBorder.left, sliceBorder.right, sliceBorder.top, sliceBorder.bottom),
                uvOff, uvSc, sprite.color, key);
        } else {
            emitQuad(buffers, draw_list, clips,
                glm::vec2(position), finalSize, sprite.pivot,
                angle, uvOff, uvSc, sprite.color, key);
        }
    }
}

void SpritePlugin::emitTiledQuads(
    TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
    const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivot,
    f32 angle, const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec2& tileSize, const glm::vec2& tileSpacing,
    const BatchDrawKey& key
) {
    glm::vec2 step = tileSize + tileSpacing;
    if (step.x <= 0.0f || step.y <= 0.0f) return;

    glm::vec2 absSize = glm::vec2(std::abs(size.x), std::abs(size.y));

    f32 baseX = position.x - absSize.x * pivot.x;
    f32 baseY = position.y - absSize.y * pivot.y;

    bool hasRotation = std::abs(angle) > 0.001f;
    f32 cosA = 1.0f, sinA = 0.0f;
    if (hasRotation) {
        cosA = std::cos(angle);
        sinA = std::sin(angle);
    }

    u32 pc = packColor(color);

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
                verts[0] = { rotatePoint(position, x0, y0, cosA, sinA), pc, { uvOffset.x,                 uvOffset.y } };
                verts[1] = { rotatePoint(position, x1, y0, cosA, sinA), pc, { uvOffset.x + tileUvScale.x, uvOffset.y } };
                verts[2] = { rotatePoint(position, x1, y1, cosA, sinA), pc, { uvOffset.x + tileUvScale.x, uvOffset.y + tileUvScale.y } };
                verts[3] = { rotatePoint(position, x0, y1, cosA, sinA), pc, { uvOffset.x,                 uvOffset.y + tileUvScale.y } };
            } else {
                verts[0] = { { x0, y0 }, pc, { uvOffset.x,                 uvOffset.y } };
                verts[1] = { { x1, y0 }, pc, { uvOffset.x + tileUvScale.x, uvOffset.y } };
                verts[2] = { { x1, y1 }, pc, { uvOffset.x + tileUvScale.x, uvOffset.y + tileUvScale.y } };
                verts[3] = { { x0, y1 }, pc, { uvOffset.x,                 uvOffset.y + tileUvScale.y } };
            }

            appendQuad(buffers, draw_list, clips, verts, key);
        }
    }
}

}  // namespace esengine
