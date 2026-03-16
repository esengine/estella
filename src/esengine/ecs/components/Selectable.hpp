#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct Selectable {
    ES_PROPERTY()
    bool selected{false};

    ES_PROPERTY()
    i32 group{0};
};

}  // namespace esengine::ecs
