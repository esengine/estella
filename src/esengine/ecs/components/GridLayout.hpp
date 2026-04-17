#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class GridDirection : u8 {
    Vertical = 0,
    Horizontal = 1,
};

ES_COMPONENT()
struct GridLayout {
    ES_PROPERTY()
    GridDirection direction{GridDirection::Vertical};

    ES_PROPERTY()
    i32 crossAxisCount{3};

    ES_PROPERTY()
    glm::vec2 itemSize{100.0f, 100.0f};

    ES_PROPERTY()
    glm::vec2 spacing{4.0f, 4.0f};
};

}  // namespace esengine::ecs
