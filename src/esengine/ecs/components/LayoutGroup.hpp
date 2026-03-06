#pragma once

#include "../../core/Types.hpp"
#include "../../core/UITypes.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class LayoutDirection : u8 {
    Horizontal,
    Vertical
};

ES_ENUM()
enum class ChildAlignment : u8 {
    Start,
    Center,
    End
};

ES_COMPONENT()
struct LayoutGroup {
    ES_PROPERTY()
    LayoutDirection direction{LayoutDirection::Horizontal};

    ES_PROPERTY()
    f32 spacing{0.0f};

    ES_PROPERTY()
    Padding padding{};

    ES_PROPERTY()
    ChildAlignment childAlignment{ChildAlignment::Start};

    ES_PROPERTY()
    bool reverseOrder{false};
};

}  // namespace esengine::ecs
