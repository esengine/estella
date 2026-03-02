#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct BoxCollider {
    ES_PROPERTY()
    glm::vec2 halfExtents{0.5f, 0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    BoxCollider() = default;
};

ES_COMPONENT()
struct CircleCollider {
    ES_PROPERTY()
    f32 radius{0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    CircleCollider() = default;
};

ES_COMPONENT()
struct CapsuleCollider {
    ES_PROPERTY()
    f32 radius{0.25f};

    ES_PROPERTY()
    f32 halfHeight{0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    CapsuleCollider() = default;
};

}  // namespace esengine::ecs
