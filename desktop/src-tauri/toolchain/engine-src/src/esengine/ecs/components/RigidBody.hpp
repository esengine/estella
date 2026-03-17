#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class BodyType : u8 {
    Static,
    Kinematic,
    Dynamic
};

ES_COMPONENT()
struct RigidBody {
    ES_PROPERTY()
    BodyType bodyType{BodyType::Dynamic};

    ES_PROPERTY()
    f32 gravityScale{1.0f};

    ES_PROPERTY()
    f32 linearDamping{0.0f};

    ES_PROPERTY()
    f32 angularDamping{0.0f};

    ES_PROPERTY()
    bool fixedRotation{false};

    ES_PROPERTY()
    bool bullet{false};

    ES_PROPERTY()
    bool enabled{true};

    RigidBody() = default;
};

}  // namespace esengine::ecs
