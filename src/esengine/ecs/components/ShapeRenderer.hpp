// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct ShapeRenderer {
    ES_PROPERTY()
    u8 shapeType{0};

    ES_PROPERTY()
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec2 size{100.0f, 100.0f};

    ES_PROPERTY(min=0)
    f32 cornerRadius{0.0f};

    ES_PROPERTY(step=1, enum_source=sortingLayers)
    i32 layer{0};

    ES_PROPERTY()
    bool enabled{true};

    ShapeRenderer() = default;
};

}  // namespace esengine::ecs
