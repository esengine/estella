#pragma once

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "TimelineData.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::animation {

using TimelineHandle = u32;
constexpr TimelineHandle INVALID_TIMELINE = 0;

struct TimelineEvent {
    enum Type : u8 {
        SpinePlay = 0,
        SpineStop,
        SpriteAnimPlay,
        AudioPlay,
        ActivationSet,
    };

    Type type;
    Entity targetEntity{INVALID_ENTITY};
    i32 intParam{0};
    f32 floatParam{0.0f};
    i32 stringIndex{-1};
};

struct CustomPropertyResult {
    Entity targetEntity{INVALID_ENTITY};
    i32 trackIndex{0};
    i32 channelIndex{0};
    f32 value{0.0f};
};

class TimelineSystem {
public:
    TimelineHandle createTimeline(TimelineData&& data);
    void destroyTimeline(TimelineHandle handle);

    void play(TimelineHandle handle);
    void pause(TimelineHandle handle);
    void stop(TimelineHandle handle);
    void setTime(TimelineHandle handle, f32 time);
    void setSpeed(TimelineHandle handle, f32 speed);
    f32 getTime(TimelineHandle handle) const;
    bool isPlaying(TimelineHandle handle) const;
    bool isStopped(TimelineHandle handle) const;

    void advance(ecs::Registry& registry, TimelineHandle handle,
                 Entity rootEntity, f32 deltaTime);

    void setTrackTarget(TimelineHandle handle, bool isEventTrack,
                        i32 trackIndex, Entity target);

    i32 evaluateAt(TimelineHandle handle, f32 time,
                   f32* outValues, i32 maxChannels) const;

    const std::vector<TimelineEvent>& pendingEvents() const { return pendingEvents_; }
    const std::vector<CustomPropertyResult>& pendingCustomProperties() const { return pendingCustomProperties_; }
    const std::string& getEventString(i32 index) const;
    void clearPendingResults();

private:
    struct Instance {
        TimelineData data;
        f32 currentTime{0.0f};
        f32 previousTime{0.0f};
        f32 speed{1.0f};
        bool playing{false};
        std::vector<i32> spineClipIndices;
        std::unordered_map<std::string, Entity> childCache;
    };

    static f32 hermiteInterpolate(f32 p0, f32 p1, f32 m0, f32 m1, f32 t);
    static f32 evaluateChannel(const TimelineChannel& channel, f32 time);
    static f32 applyWrapMode(f32 time, f32 duration, TimelineWrapMode mode, bool& stopped);

    Entity resolveChildEntity(ecs::Registry& registry, Entity root,
                              const std::string& path, Instance& inst) const;

    void applyPropertyValue(ecs::Registry& registry, Entity entity,
                            AnimTargetField field, f32 value) const;

    void evaluatePropertyTracks(ecs::Registry& registry, Entity rootEntity,
                                Instance& inst);
    void evaluateEventTracks(ecs::Registry& registry, Entity rootEntity,
                             Instance& inst);

    i32 addEventString(const std::string& str);

public:
    Instance* getInstance(TimelineHandle handle);
    const Instance* getInstance(TimelineHandle handle) const;

private:

    u32 nextHandle_{1};
    std::unordered_map<TimelineHandle, Instance> instances_;
    std::vector<TimelineEvent> pendingEvents_;
    std::vector<CustomPropertyResult> pendingCustomProperties_;
    std::vector<std::string> stringPool_;

    static const std::string EMPTY_STRING;
};

}  // namespace esengine::animation
