#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class MaskMode : u8 {
    Scissor,
    Stencil
};

ES_COMPONENT()
struct UIMask {
    ES_PROPERTY()
    bool enabled{true};
    ES_PROPERTY()
    MaskMode mode{MaskMode::Scissor};
};

}  // namespace esengine::ecs
