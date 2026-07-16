// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "UIElementPlugin.hpp"
#include "../MaterialStore.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/UIVisual.hpp"
#include "../../ecs/components/UINode.hpp"

#include <algorithm>
#include <cmath>

namespace esengine {

static bool isRadialMethod(ecs::UIFillMethod m) {
    return m == ecs::UIFillMethod::Radial360
        || m == ecs::UIFillMethod::Radial90
        || m == ecs::UIFillMethod::Radial180;
}

// Clockwise radial start direction (box-local, +y = up), by origin edge:
// Top = 12 o'clock, Right = 3, Bottom = 6, Left = 9.
static f32 radialStartAngle(ecs::UIFillOrigin origin) {
    constexpr f32 HALF_PI = 1.57079632679f;
    switch (origin) {
        case ecs::UIFillOrigin::Right:  return 0.0f;
        case ecs::UIFillOrigin::Bottom: return -HALF_PI;
        case ecs::UIFillOrigin::Left:   return 2.0f * HALF_PI;
        case ecs::UIFillOrigin::Top:    return HALF_PI;
    }
    return HALF_PI;
}

// The mode's full arc; fillAmount scales the swept angle within it.
static f32 radialMaxSweep(ecs::UIFillMethod m) {
    constexpr f32 HALF_PI = 1.57079632679f;
    switch (m) {
        case ecs::UIFillMethod::Radial90:  return HALF_PI;
        case ecs::UIFillMethod::Radial180: return 2.0f * HALF_PI;
        default:                           return 4.0f * HALF_PI;  // Radial360
    }
}

void UIElementPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto uiView = registry.view<ecs::Transform, ecs::UIVisual>();

    for (auto entity : uiView) {
        const auto& renderer = uiView.get<ecs::UIVisual>(entity);
        if (!renderer.enabled || renderer.visualType == ecs::UIVisualType::None) continue;

        // Geometry from the UINode (CSS box) — always pivot-centered.
        const auto* node = registry.tryGet<ecs::UINode>(entity);
        if (!node || node->hidden_in_tree_) continue;
        f32 w = node->computed_size_.x, h = node->computed_size_.y;
        f32 pivotX = 0.5f, pivotY = 0.5f;
        if (w <= 0.0f && h <= 0.0f) continue;

        auto& transform = uiView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();

        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        // UI bakes the pivot into the world position here, so the quad is emitted centered.
        f32 dx = (0.5f - pivotX) * w * scale.x;
        f32 dy = (0.5f - pivotY) * h * scale.y;
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

        // Derive the sampled UV from the base sub-region + the fill mode. This
        // replaces the old per-frame Image->UIRenderer copy: Tiled repeats by
        // box/tileSize, Filled crops to fillAmount.
        glm::vec2 uvOffset = renderer.uvOffset;
        glm::vec2 uvScale = renderer.uvScale;
        if (renderer.visualType == ecs::UIVisualType::Tiled) {
            if (renderer.tileSize.x > 0.0f && renderer.tileSize.y > 0.0f) {
                uvScale.x = renderer.uvScale.x * (w / renderer.tileSize.x);
                uvScale.y = renderer.uvScale.y * (h / renderer.tileSize.y);
            }
        } else if (renderer.visualType == ecs::UIVisualType::Filled) {
            f32 amount = std::clamp(renderer.fillAmount, 0.0f, 1.0f);
            if (renderer.fillMethod == ecs::UIFillMethod::Horizontal) {
                uvScale.x = renderer.uvScale.x * amount;
                if (renderer.fillOrigin == ecs::UIFillOrigin::Right) {
                    uvOffset.x = renderer.uvOffset.x + renderer.uvScale.x * (1.0f - amount);
                }
            } else if (renderer.fillMethod == ecs::UIFillMethod::Vertical) {
                uvScale.y = renderer.uvScale.y * amount;
                if (renderer.fillOrigin == ecs::UIFillOrigin::Top) {
                    uvOffset.y = renderer.uvOffset.y + renderer.uvScale.y * (1.0f - amount);
                }
            }
            // Radial360 samples the full base UV per fan vertex — no crop here.
        }

        glm::vec2 finalSize = glm::vec2(w, h) * glm::vec2(scale);

        const bool isRadialFill = renderer.visualType == ecs::UIVisualType::Filled
                               && isRadialMethod(renderer.fillMethod);

        // Filled derives its own UV/geometry, so 9-slice never applies. Linear
        // fills crop the box in lockstep with the UV crop above: the box shrinks
        // to fillAmount along the axis, anchored at fillOrigin, its center shifting
        // toward that edge by half the removed extent (rotated into world space to
        // match the pivot bake). A UV-only crop would no-op on a solid colour and
        // stretch a texture; cropping geometry too makes both reveal. Radial fills
        // are emitted as a wedge fan instead (below), so they skip the box crop.
        if (renderer.visualType == ecs::UIVisualType::Filled) {
            useNineSlice = false;
            if (!isRadialFill) {
                f32 amount = std::clamp(renderer.fillAmount, 0.0f, 1.0f);
                f32 offX = 0.0f, offY = 0.0f;
                if (renderer.fillMethod == ecs::UIFillMethod::Horizontal) {
                    f32 removed = finalSize.x * (1.0f - amount);
                    offX = (renderer.fillOrigin == ecs::UIFillOrigin::Right ? 0.5f : -0.5f) * removed;
                    finalSize.x *= amount;
                } else {
                    f32 removed = finalSize.y * (1.0f - amount);
                    offY = (renderer.fillOrigin == ecs::UIFillOrigin::Top ? 0.5f : -0.5f) * removed;
                    finalSize.y *= amount;
                }
                if (std::abs(angle) > 0.001f) {
                    f32 cosA = std::cos(angle), sinA = std::sin(angle);
                    f32 rx = offX * cosA - offY * sinA;
                    f32 ry = offX * sinA + offY * cosA;
                    offX = rx;
                    offY = ry;
                }
                position.x += offX;
                position.y += offY;
            }
        }

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

        // Same resolution as SpritePlugin: an unregistered handle falls back to
        // the default batch shader, so a dangling material renders plainly.
        if (renderer.material != 0) {
            if (const MaterialRecord* m = ctx.materials ? ctx.materials->find(renderer.material) : nullptr) {
                key.shaderId = (m->shader != 0) ? m->shader : batch_shader_id_;
                key.blend = m->blend;
                key.materialId = renderer.material;
                key.depthTest = m->depthTest;
                key.depthWrite = m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
            }
        }

        constexpr glm::vec2 CENTERED_PIVOT{0.5f, 0.5f};

        if (isRadialFill) {
            f32 sweep = std::clamp(renderer.fillAmount, 0.0f, 1.0f)
                      * radialMaxSweep(renderer.fillMethod);
            emitRadialFill(buffers, draw_list, clips,
                glm::vec2(position), finalSize, angle,
                radialStartAngle(renderer.fillOrigin), sweep,
                uvOffset, uvScale, renderer.color, key);
        } else if (useNineSlice) {
            emitNineSlice(buffers, draw_list, clips,
                glm::vec2(position), finalSize, CENTERED_PIVOT,
                angle, texSize, sliceBorder,
                uvOffset, uvScale, renderer.color, key);
        } else {
            emitQuad(buffers, draw_list, clips,
                glm::vec2(position), finalSize, CENTERED_PIVOT,
                angle, uvOffset, uvScale, renderer.color, key);
        }
    }
}

}  // namespace esengine
