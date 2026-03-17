#pragma once

#include "../core/Types.hpp"

namespace esengine::animation {

enum class EasingType : u8 {
    Linear = 0,
    EaseInQuad,
    EaseOutQuad,
    EaseInOutQuad,
    EaseInCubic,
    EaseOutCubic,
    EaseInOutCubic,
    EaseInBack,
    EaseOutBack,
    EaseInOutBack,
    EaseInElastic,
    EaseOutElastic,
    EaseInOutElastic,
    EaseOutBounce,
    CubicBezier,
    Step,
    COUNT
};

enum class TweenTarget : u8 {
    TransformPositionX = 0,
    TransformPositionY,
    TransformPositionZ,
    TransformScaleX,
    TransformScaleY,
    TransformRotationZ,
    SpriteColorR,
    SpriteColorG,
    SpriteColorB,
    SpriteColorA,
    SpriteSizeX,
    SpriteSizeY,
    CameraOrthoSize,
    COUNT
};

enum class TweenState : u8 {
    Running = 0,
    Paused,
    Completed,
    Cancelled
};

enum class LoopMode : u8 {
    None = 0,
    Restart,
    PingPong
};

struct TweenData {
    Entity target_entity{INVALID_ENTITY};
    TweenTarget target_property{TweenTarget::TransformPositionX};

    f32 from_value{0.0f};
    f32 to_value{0.0f};
    f32 duration{1.0f};
    f32 elapsed{0.0f};
    f32 delay{0.0f};

    EasingType easing{EasingType::Linear};

    f32 bezier_p1x{0.0f};
    f32 bezier_p1y{0.0f};
    f32 bezier_p2x{1.0f};
    f32 bezier_p2y{1.0f};

    TweenState state{TweenState::Running};

    LoopMode loop_mode{LoopMode::None};
    i32 loop_count{0};
    i32 loops_remaining{0};

    u32 group_id{0};
    Entity sequence_next{INVALID_ENTITY};
};

}  // namespace esengine::animation
