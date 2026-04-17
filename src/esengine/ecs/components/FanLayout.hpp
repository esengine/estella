#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class FanDirection : u8 {
    Up = 0,
    Down = 1,
};

ES_COMPONENT()
struct FanLayout {
    ES_PROPERTY()
    f32 radius{600.0f};

    ES_PROPERTY()
    f32 maxSpreadAngle{30.0f};

    ES_PROPERTY()
    f32 maxCardAngle{8.0f};

    ES_PROPERTY()
    f32 tiltFactor{1.0f};

    ES_PROPERTY()
    f32 cardSpacing{0.0f};  // 0=auto (arc-based), >0=fixed center-to-center distance

    ES_PROPERTY()
    FanDirection direction{FanDirection::Up};
};

}  // namespace esengine::ecs
