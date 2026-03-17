#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct Interactable {
    ES_PROPERTY()
    bool enabled{true};
    ES_PROPERTY()
    bool blockRaycast{true};
    ES_PROPERTY()
    bool raycastTarget{true};
};

}  // namespace esengine::ecs
