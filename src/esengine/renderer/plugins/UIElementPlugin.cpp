#include "UIElementPlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/UIRenderer.hpp"
#include "../../ecs/components/UIRect.hpp"

#include <cmath>

namespace esengine {

void UIElementPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
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

        // UI bakes the pivot into the world position here, so the quad is emitted centered.
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

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = layer,
            .shaderId = batch_shader_id_,
            .blend = BlendMode::Normal,
            .textureId = textureId,
            .depth = position.z,
            .entity = entity,
            .type = RenderType::UIElement,
        };

        constexpr glm::vec2 CENTERED_PIVOT{0.5f, 0.5f};

        if (useNineSlice) {
            emitNineSlice(buffers, draw_list, clips,
                glm::vec2(position), finalSize, CENTERED_PIVOT,
                angle, texSize, sliceBorder,
                renderer.uvOffset, renderer.uvScale, renderer.color, key);
        } else {
            emitQuad(buffers, draw_list, clips,
                glm::vec2(position), finalSize, CENTERED_PIVOT,
                angle, renderer.uvOffset, renderer.uvScale, renderer.color, key);
        }
    }
}

}  // namespace esengine
