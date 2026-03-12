#pragma once

#include "../../core/Types.hpp"
#include "../../core/UITypes.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class AlignSelf : u8 {
    Auto,
    Start,
    Center,
    End,
    Stretch
};

ES_COMPONENT()
struct FlexItem {
    ES_PROPERTY()
    f32 flexGrow{0.0f};
    ES_PROPERTY()
    f32 flexShrink{1.0f};
    ES_PROPERTY()
    f32 flexBasis{-1.0f};
    ES_PROPERTY()
    i32 order{0};
    ES_PROPERTY()
    AlignSelf alignSelf{AlignSelf::Auto};
    ES_PROPERTY()
    Padding margin{};
    ES_PROPERTY()
    f32 minWidth{-1.0f};
    ES_PROPERTY()
    f32 minHeight{-1.0f};
    ES_PROPERTY()
    f32 maxWidth{-1.0f};
    ES_PROPERTY()
    f32 maxHeight{-1.0f};
    ES_PROPERTY()
    f32 widthPercent{-1.0f};
    ES_PROPERTY()
    f32 heightPercent{-1.0f};
};

}  // namespace esengine::ecs
