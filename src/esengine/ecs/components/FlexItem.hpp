#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

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
};

}  // namespace esengine::ecs
