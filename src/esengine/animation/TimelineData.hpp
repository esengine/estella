#pragma once

#include "../core/Types.hpp"

#include <string>
#include <vector>

namespace esengine::animation {

enum class TimelineWrapMode : u8 {
    Once = 0,
    Loop,
    PingPong,
};

enum class InterpType : u8 {
    Hermite = 0,
    Linear,
    Step,
    EaseIn,
    EaseOut,
    EaseInOut,
};

struct TimelineKeyframe {
    f32 time;
    f32 value;
    f32 inTangent;
    f32 outTangent;
    InterpType interpolation{InterpType::Hermite};
};

struct TimelineChannel {
    std::vector<TimelineKeyframe> keyframes;
};

enum class AnimTargetComponent : u8 {
    Transform = 0,
    Sprite,
    UIRect,
    Camera,
    Custom,
    COUNT
};

enum class AnimTargetField : u8 {
    // Transform
    PositionX = 0,
    PositionY,
    PositionZ,
    ScaleX,
    ScaleY,
    ScaleZ,
    RotationZ,
    // Sprite
    ColorR,
    ColorG,
    ColorB,
    ColorA,
    SpriteOpacity,
    SpriteSizeX,
    SpriteSizeY,
    // UIRect
    OffsetMinX,
    OffsetMinY,
    OffsetMaxX,
    OffsetMaxY,
    AnchorMinX,
    AnchorMinY,
    AnchorMaxX,
    AnchorMaxY,
    PivotX,
    PivotY,
    // Camera
    CameraOrthoSize,
    // Custom (fallback to TS)
    CustomField,
    COUNT
};

struct PropertyTrackBinding {
    std::string childPath;
    AnimTargetComponent component;
    std::vector<AnimTargetField> fields;
    std::vector<TimelineChannel> channels;
    std::string customComponentName;
    std::vector<std::string> customFieldPaths;
    Entity resolvedTarget{INVALID_ENTITY};
};

struct SpineClipData {
    f32 start;
    f32 duration;
    std::string animation;
    bool loop;
    f32 speed;
};

struct AudioEventData {
    f32 time;
    std::string clip;
    f32 volume;
};

struct ActivationRange {
    f32 start;
    f32 end;
};

enum class EventTrackType : u8 {
    Spine = 0,
    SpriteAnim,
    Audio,
    Activation,
};

struct EventTrack {
    std::string childPath;
    EventTrackType type;
    std::vector<SpineClipData> spineClips;
    f32 spineBlendIn{0.0f};
    std::string spriteAnimClip;
    f32 spriteAnimStartTime{0.0f};
    std::vector<AudioEventData> audioEvents;
    std::vector<ActivationRange> activationRanges;
    Entity resolvedTarget{INVALID_ENTITY};
};

struct TimelineData {
    f32 duration{0.0f};
    TimelineWrapMode wrapMode{TimelineWrapMode::Once};
    std::vector<PropertyTrackBinding> propertyTracks;
    std::vector<EventTrack> eventTracks;
};

}  // namespace esengine::animation
