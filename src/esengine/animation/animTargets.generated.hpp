#pragma once

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UIRenderer.hpp"
#include "../ecs/components/BitmapText.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UIRect.hpp"

#include <glm/glm.hpp>
#include <cmath>

namespace esengine::animation {

enum class AnimTargetComponent : u8 {
    UIRect = 0,
    Transform = 1,
    UIRenderer = 2,
    BitmapText = 3,
    Sprite = 4,
    Camera = 5,
    Custom = 6,
    COUNT
};

enum class AnimTargetField : u8 {
    UIRectAnchorMinX = 0,
    UIRectAnchorMinY = 1,
    UIRectAnchorMaxX = 2,
    UIRectAnchorMaxY = 3,
    UIRectOffsetMinX = 4,
    UIRectOffsetMinY = 5,
    UIRectOffsetMaxX = 6,
    UIRectOffsetMaxY = 7,
    UIRectPivotX = 8,
    UIRectPivotY = 9,
    TransformPositionX = 10,
    TransformPositionY = 11,
    TransformPositionZ = 12,
    TransformRotationZ = 13,
    TransformScaleX = 14,
    TransformScaleY = 15,
    TransformScaleZ = 16,
    UIRendererColorR = 17,
    UIRendererColorG = 18,
    UIRendererColorB = 19,
    UIRendererColorA = 20,
    BitmapTextColorR = 21,
    BitmapTextColorG = 22,
    BitmapTextColorB = 23,
    BitmapTextColorA = 24,
    SpriteColorR = 25,
    SpriteColorG = 26,
    SpriteColorB = 27,
    SpriteColorA = 28,
    SpriteSizeX = 29,
    SpriteSizeY = 30,
    CameraOrthoSize = 31,
    CustomField = 32,
    COUNT
};

inline void applyAnimatedValue(
    ecs::Registry& registry, Entity entity,
    AnimTargetField field, f32 value)
{
    switch (field) {
        case AnimTargetField::UIRectAnchorMinX:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->anchorMin.x = value;
            }
            break;
        case AnimTargetField::UIRectAnchorMinY:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->anchorMin.y = value;
            }
            break;
        case AnimTargetField::UIRectAnchorMaxX:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->anchorMax.x = value;
            }
            break;
        case AnimTargetField::UIRectAnchorMaxY:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->anchorMax.y = value;
            }
            break;
        case AnimTargetField::UIRectOffsetMinX:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->offsetMin.x = value;
            }
            break;
        case AnimTargetField::UIRectOffsetMinY:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->offsetMin.y = value;
            }
            break;
        case AnimTargetField::UIRectOffsetMaxX:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->offsetMax.x = value;
            }
            break;
        case AnimTargetField::UIRectOffsetMaxY:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->offsetMax.y = value;
            }
            break;
        case AnimTargetField::UIRectPivotX:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->pivot.x = value;
            }
            break;
        case AnimTargetField::UIRectPivotY:
            if (auto* c = registry.tryGet<ecs::UIRect>(entity)) {
                c->pivot.y = value;
            }
            break;
        case AnimTargetField::TransformPositionX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_POS_X;
            }
            break;
        case AnimTargetField::TransformPositionY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_POS_Y;
            }
            break;
        case AnimTargetField::TransformPositionZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.z = value;
            }
            break;
        case AnimTargetField::TransformRotationZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                f32 h = value * 0.5f;
                c->rotation = glm::quat(std::cos(h), 0.0f, 0.0f, std::sin(h));
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_ROT_Z;
            }
            break;
        case AnimTargetField::TransformScaleX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_SCALE_X;
            }
            break;
        case AnimTargetField::TransformScaleY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_SCALE_Y;
            }
            break;
        case AnimTargetField::TransformScaleZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.z = value;
            }
            break;
        case AnimTargetField::UIRendererColorR:
            if (auto* c = registry.tryGet<ecs::UIRenderer>(entity)) {
                c->color.r = value;
            }
            break;
        case AnimTargetField::UIRendererColorG:
            if (auto* c = registry.tryGet<ecs::UIRenderer>(entity)) {
                c->color.g = value;
            }
            break;
        case AnimTargetField::UIRendererColorB:
            if (auto* c = registry.tryGet<ecs::UIRenderer>(entity)) {
                c->color.b = value;
            }
            break;
        case AnimTargetField::UIRendererColorA:
            if (auto* c = registry.tryGet<ecs::UIRenderer>(entity)) {
                c->color.a = value;
            }
            break;
        case AnimTargetField::BitmapTextColorR:
            if (auto* c = registry.tryGet<ecs::BitmapText>(entity)) {
                c->color.r = value;
            }
            break;
        case AnimTargetField::BitmapTextColorG:
            if (auto* c = registry.tryGet<ecs::BitmapText>(entity)) {
                c->color.g = value;
            }
            break;
        case AnimTargetField::BitmapTextColorB:
            if (auto* c = registry.tryGet<ecs::BitmapText>(entity)) {
                c->color.b = value;
            }
            break;
        case AnimTargetField::BitmapTextColorA:
            if (auto* c = registry.tryGet<ecs::BitmapText>(entity)) {
                c->color.a = value;
            }
            break;
        case AnimTargetField::SpriteColorR:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->color.r = value;
            }
            break;
        case AnimTargetField::SpriteColorG:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->color.g = value;
            }
            break;
        case AnimTargetField::SpriteColorB:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->color.b = value;
            }
            break;
        case AnimTargetField::SpriteColorA:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->color.a = value;
            }
            break;
        case AnimTargetField::SpriteSizeX:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->size.x = value;
            }
            break;
        case AnimTargetField::SpriteSizeY:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) {
                c->size.y = value;
            }
            break;
        case AnimTargetField::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(entity)) {
                c->orthoSize = value;
            }
            break;
        case AnimTargetField::CustomField:
        default:
            break;
    }
}

}  // namespace esengine::animation
