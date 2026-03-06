#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct UIRect {
    ES_PROPERTY()
    glm::vec2 anchorMin{0.5f, 0.5f};

    ES_PROPERTY()
    glm::vec2 anchorMax{0.5f, 0.5f};

    ES_PROPERTY()
    glm::vec2 offsetMin{0.0f, 0.0f};

    ES_PROPERTY()
    glm::vec2 offsetMax{0.0f, 0.0f};

    ES_PROPERTY()
    glm::vec2 size{100.0f, 100.0f};

    ES_PROPERTY()
    glm::vec2 pivot{0.5f, 0.5f};

    glm::vec2 computed_size_{0.0f};

    UIRect() = default;
};

}  // namespace esengine::ecs
