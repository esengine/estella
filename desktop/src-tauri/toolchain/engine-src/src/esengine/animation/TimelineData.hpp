#pragma once

#include "../core/Types.hpp"
#include "animTargets.generated.hpp"

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
