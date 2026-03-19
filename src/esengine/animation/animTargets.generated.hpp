#pragma once

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/BitmapText.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/UIRenderer.hpp"
#include "../ecs/components/UIRect.hpp"

#include <glm/glm.hpp>
#include <cmath>

namespace esengine::animation {

enum class AnimTargetComponent : u8 {
    BitmapText = 0,
    Camera = 1,
    Sprite = 2,
    Transform = 3,
    UIRect = 4,
    UIRenderer = 5,
    Custom = 6,
    COUNT
};

enum class AnimTargetField : u8 {
    BitmapTextColorR = 0,
    BitmapTextColorG = 1,
    BitmapTextColorB = 2,
    BitmapTextColorA = 3,
    CameraOrthoSize = 4,
    SpriteColorR = 5,
    SpriteColorG = 6,
    SpriteColorB = 7,
    SpriteColorA = 8,
    SpriteSizeX = 9,
    SpriteSizeY = 10,
    TransformPositionX = 11,
    TransformPositionY = 12,
    TransformPositionZ = 13,
    TransformRotationZ = 14,
    TransformScaleX = 15,
    TransformScaleY = 16,
    TransformScaleZ = 17,
    UIRectAnchorMinX = 18,
    UIRectAnchorMinY = 19,
    UIRectAnchorMaxX = 20,
    UIRectAnchorMaxY = 21,
    UIRectOffsetMinX = 22,
    UIRectOffsetMinY = 23,
    UIRectOffsetMaxX = 24,
    UIRectOffsetMaxY = 25,
    UIRectPivotX = 26,
    UIRectPivotY = 27,
    UIRendererColorR = 28,
    UIRendererColorG = 29,
    UIRendererColorB = 30,
    UIRendererColorA = 31,
    CustomField = 32,
    COUNT
};

inline void applyAnimatedValue(
    ecs::Registry& registry, Entity entity,
    AnimTargetField field, f32 value)
{
    switch (field) {
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
        case AnimTargetField::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(entity)) {
                c->orthoSize = value;
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
        case AnimTargetField::CustomField:
        default:
            break;
    }
}

}  // namespace esengine::animation
