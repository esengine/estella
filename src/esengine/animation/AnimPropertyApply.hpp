#pragma once

#include "TimelineData.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UIRect.hpp"

#include <glm/glm.hpp>
#include <cmath>

namespace esengine::animation {

inline void applyAnimatedValue(
    ecs::Registry& registry, Entity entity,
    AnimTargetField field, f32 value)
{
    switch (field) {
        case AnimTargetField::PositionX:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) {
                t->position.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) {
                    r->anim_override_ |= ecs::UIRect::ANIM_POS_X;
                }
            }
            break;
        case AnimTargetField::PositionY:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) {
                t->position.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) {
                    r->anim_override_ |= ecs::UIRect::ANIM_POS_Y;
                }
            }
            break;
        case AnimTargetField::PositionZ:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) { t->position.z = value; }
            break;
        case AnimTargetField::ScaleX:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) {
                t->scale.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) {
                    r->anim_override_ |= ecs::UIRect::ANIM_SCALE_X;
                }
            }
            break;
        case AnimTargetField::ScaleY:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) {
                t->scale.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) {
                    r->anim_override_ |= ecs::UIRect::ANIM_SCALE_Y;
                }
            }
            break;
        case AnimTargetField::ScaleZ:
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) { t->scale.z = value; }
            break;
        case AnimTargetField::RotationZ: {
            if (auto* t = registry.tryGet<ecs::Transform>(entity)) {
                f32 halfAngle = value * 0.5f;
                t->rotation = glm::quat(std::cos(halfAngle), 0.0f, 0.0f, std::sin(halfAngle));
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) {
                    r->anim_override_ |= ecs::UIRect::ANIM_ROT_Z;
                }
            }
            break;
        }
        case AnimTargetField::ColorR:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->color.r = value; }
            break;
        case AnimTargetField::ColorG:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->color.g = value; }
            break;
        case AnimTargetField::ColorB:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->color.b = value; }
            break;
        case AnimTargetField::ColorA:
        case AnimTargetField::SpriteOpacity:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->color.a = value; }
            break;
        case AnimTargetField::SpriteSizeX:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->size.x = value; }
            break;
        case AnimTargetField::SpriteSizeY:
            if (auto* s = registry.tryGet<ecs::Sprite>(entity)) { s->size.y = value; }
            break;
        case AnimTargetField::OffsetMinX:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->offsetMin.x = value; }
            break;
        case AnimTargetField::OffsetMinY:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->offsetMin.y = value; }
            break;
        case AnimTargetField::OffsetMaxX:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->offsetMax.x = value; }
            break;
        case AnimTargetField::OffsetMaxY:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->offsetMax.y = value; }
            break;
        case AnimTargetField::AnchorMinX:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->anchorMin.x = value; }
            break;
        case AnimTargetField::AnchorMinY:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->anchorMin.y = value; }
            break;
        case AnimTargetField::AnchorMaxX:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->anchorMax.x = value; }
            break;
        case AnimTargetField::AnchorMaxY:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->anchorMax.y = value; }
            break;
        case AnimTargetField::PivotX:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->pivot.x = value; }
            break;
        case AnimTargetField::PivotY:
            if (auto* r = registry.tryGet<ecs::UIRect>(entity)) { r->pivot.y = value; }
            break;
        case AnimTargetField::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(entity)) { c->orthoSize = value; }
            break;
        case AnimTargetField::CustomField:
        default:
            break;
    }
}

}  // namespace esengine::animation
