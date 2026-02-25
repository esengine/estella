#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct UIInteraction {
    ES_PROPERTY()
    bool hovered{false};
    ES_PROPERTY()
    bool pressed{false};
    ES_PROPERTY()
    bool justPressed{false};
    ES_PROPERTY()
    bool justReleased{false};
};

}  // namespace esengine::ecs
