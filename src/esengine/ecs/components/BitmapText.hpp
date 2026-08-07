// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

#include <string>

namespace esengine::ecs {

ES_ENUM()
enum class TextAlign : u8 {
    Left,
    Center,
    Right
};

ES_COMPONENT(renderable=enabled)
struct BitmapText {
    ES_PROPERTY()
    std::string text;

    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f};

    ES_PROPERTY(min=1)
    f32 fontSize{1.0f};

    ES_PROPERTY()
    TextAlign align{TextAlign::Left};

    ES_PROPERTY()
    f32 spacing{0.0f};

    /** @brief Parallax scroll factor per axis. 1 = moves with the world (default, no
     *         parallax); <1 = scrolls slower than the camera (appears farther, e.g. a
     *         background); 0 = locked to the camera (e.g. a sky). The renderer offsets
     *         the text by camera_center * (1 - factor). */
    ES_PROPERTY(advanced, tooltip="Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).")
    glm::vec2 parallax{1.0f, 1.0f};

    ES_PROPERTY(step=1)
    i32 layer{0};

    ES_PROPERTY(asset = font)
    resource::BitmapFontHandle font;

    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs
