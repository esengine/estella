// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class ShapeType : u8 {
    Circle = 0,
    Capsule = 1,
    RoundedRect = 2,
};

ES_COMPONENT(renderable=enabled)
struct ShapeRenderer {
    ES_PROPERTY(enum=ShapeType)
    u8 shapeType{0};

    ES_PROPERTY()
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec2 size{100.0f, 100.0f};

    ES_PROPERTY(min=0)
    f32 cornerRadius{0.0f};

    ES_PROPERTY(step=1, enum_source=sortingLayers)
    i32 layer{0};

    /** @brief Parallax scroll factor per axis. 1 = moves with the world (default, no
     *         parallax); <1 = scrolls slower than the camera (appears farther, e.g. a
     *         background); 0 = locked to the camera (e.g. a sky). The renderer offsets
     *         the shape by camera_center * (1 - factor). */
    ES_PROPERTY(advanced, tooltip="Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).")
    glm::vec2 parallax{1.0f, 1.0f};

    ES_PROPERTY()
    bool enabled{true};

    ShapeRenderer() = default;
};

}  // namespace esengine::ecs
