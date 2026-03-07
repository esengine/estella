#include "TimelineSystem.hpp"
#include "AnimPropertyApply.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/Common.hpp"

#include <cmath>
#include <algorithm>

namespace esengine::animation {

const std::string TimelineSystem::EMPTY_STRING;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

TimelineHandle TimelineSystem::createTimeline(TimelineData&& data) {
    TimelineHandle handle = nextHandle_++;
    Instance inst;
    inst.spineClipIndices.resize(data.eventTracks.size(), -1);
    inst.data = std::move(data);
    instances_.emplace(handle, std::move(inst));
    return handle;
}

void TimelineSystem::destroyTimeline(TimelineHandle handle) {
    instances_.erase(handle);
}

// ---------------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------------

void TimelineSystem::play(TimelineHandle handle) {
    if (auto* inst = getInstance(handle)) {
        inst->currentTime = 0.0f;
        inst->previousTime = 0.0f;
        inst->playing = true;
        inst->childCache.clear();
        std::fill(inst->spineClipIndices.begin(), inst->spineClipIndices.end(), -1);
    }
}

void TimelineSystem::pause(TimelineHandle handle) {
    if (auto* inst = getInstance(handle)) {
        inst->playing = false;
    }
}

void TimelineSystem::stop(TimelineHandle handle) {
    if (auto* inst = getInstance(handle)) {
        inst->playing = false;
        inst->currentTime = 0.0f;
        inst->previousTime = 0.0f;
        inst->childCache.clear();
        std::fill(inst->spineClipIndices.begin(), inst->spineClipIndices.end(), -1);
    }
}

void TimelineSystem::setTime(TimelineHandle handle, f32 time) {
    if (auto* inst = getInstance(handle)) {
        inst->previousTime = inst->currentTime;
        inst->currentTime = time;
    }
}

void TimelineSystem::setSpeed(TimelineHandle handle, f32 speed) {
    if (auto* inst = getInstance(handle)) {
        inst->speed = speed;
    }
}

f32 TimelineSystem::getTime(TimelineHandle handle) const {
    if (auto* inst = getInstance(handle)) {
        return inst->currentTime;
    }
    return 0.0f;
}

bool TimelineSystem::isPlaying(TimelineHandle handle) const {
    if (auto* inst = getInstance(handle)) {
        return inst->playing;
    }
    return false;
}

bool TimelineSystem::isStopped(TimelineHandle handle) const {
    if (auto* inst = getInstance(handle)) {
        return !inst->playing && inst->currentTime == 0.0f;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

f32 TimelineSystem::hermiteInterpolate(f32 p0, f32 p1, f32 m0, f32 m1, f32 t) {
    f32 t2 = t * t;
    f32 t3 = t2 * t;
    f32 h00 = 2.0f * t3 - 3.0f * t2 + 1.0f;
    f32 h10 = t3 - 2.0f * t2 + t;
    f32 h01 = -2.0f * t3 + 3.0f * t2;
    f32 h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

f32 TimelineSystem::evaluateChannel(const TimelineChannel& channel, f32 time) {
    const auto& kfs = channel.keyframes;
    if (kfs.empty()) return 0.0f;
    if (kfs.size() == 1) return kfs[0].value;

    if (time <= kfs.front().time) return kfs.front().value;
    if (time >= kfs.back().time) return kfs.back().value;

    usize i = 0;
    while (i < kfs.size() - 1 && kfs[i + 1].time <= time) {
        i++;
    }

    const auto& k0 = kfs[i];
    const auto& k1 = kfs[i + 1];
    f32 dt = k1.time - k0.time;
    if (dt <= 0.0f) return k0.value;

    f32 t = (time - k0.time) / dt;
    return hermiteInterpolate(k0.value, k1.value, k0.outTangent * dt, k1.inTangent * dt, t);
}

f32 TimelineSystem::applyWrapMode(f32 time, f32 duration, TimelineWrapMode mode, bool& stopped) {
    stopped = false;
    if (time < 0.0f) return 0.0f;
    if (time < duration) return time;

    switch (mode) {
        case TimelineWrapMode::Once:
            stopped = true;
            return duration;
        case TimelineWrapMode::Loop:
            return std::fmod(time, duration);
        case TimelineWrapMode::PingPong: {
            f32 cycle = duration * 2.0f;
            f32 t = std::fmod(time, cycle);
            return (t <= duration) ? t : cycle - t;
        }
        default:
            stopped = true;
            return duration;
    }
}

// ---------------------------------------------------------------------------
// Child entity resolution
// ---------------------------------------------------------------------------

Entity TimelineSystem::resolveChildEntity(
    ecs::Registry& registry, Entity root,
    const std::string& path, Instance& inst) const
{
    if (path.empty()) return root;

    auto it = inst.childCache.find(path);
    if (it != inst.childCache.end()) {
        if (registry.valid(it->second)) return it->second;
        inst.childCache.erase(it);
    }

    Entity current = root;
    usize start = 0;
    while (start < path.size()) {
        auto slash = path.find('/', start);
        auto segment = (slash == std::string::npos)
            ? path.substr(start)
            : path.substr(start, slash - start);
        start = (slash == std::string::npos) ? path.size() : slash + 1;

        auto* children = registry.tryGet<ecs::Children>(current);
        if (!children) return INVALID_ENTITY;

        Entity found = INVALID_ENTITY;
        for (auto child : children->entities) {
            auto* name = registry.tryGet<ecs::Name>(child);
            if (name && name->value == segment) {
                found = child;
                break;
            }
        }
        if (found == INVALID_ENTITY) return INVALID_ENTITY;
        current = found;
    }

    inst.childCache[path] = current;
    return current;
}

// ---------------------------------------------------------------------------
// Property apply
// ---------------------------------------------------------------------------

void TimelineSystem::applyPropertyValue(
    ecs::Registry& registry, Entity entity,
    AnimTargetField field, f32 value) const
{
    applyAnimatedValue(registry, entity, field, value);
}

// ---------------------------------------------------------------------------
// Evaluate property tracks
// ---------------------------------------------------------------------------

void TimelineSystem::evaluatePropertyTracks(
    ecs::Registry& registry, Entity rootEntity, Instance& inst)
{
    f32 time = inst.currentTime;
    for (i32 ti = 0; ti < static_cast<i32>(inst.data.propertyTracks.size()); ti++) {
        const auto& track = inst.data.propertyTracks[ti];
        Entity target = track.resolvedTarget != INVALID_ENTITY
            ? track.resolvedTarget
            : resolveChildEntity(registry, rootEntity, track.childPath, inst);
        if (target == INVALID_ENTITY) continue;

        for (i32 ci = 0; ci < static_cast<i32>(track.channels.size()); ci++) {
            f32 value = evaluateChannel(track.channels[ci], time);
            AnimTargetField field = track.fields[ci];

            if (field == AnimTargetField::CustomField) {
                pendingCustomProperties_.push_back({target, ti, ci, value});
            } else {
                applyPropertyValue(registry, target, field, value);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Evaluate event tracks
// ---------------------------------------------------------------------------

void TimelineSystem::evaluateEventTracks(
    ecs::Registry& registry, Entity rootEntity, Instance& inst)
{
    f32 time = inst.currentTime;
    f32 prevTime = inst.previousTime;

    for (i32 i = 0; i < static_cast<i32>(inst.data.eventTracks.size()); i++) {
        const auto& track = inst.data.eventTracks[i];
        Entity target = track.resolvedTarget != INVALID_ENTITY
            ? track.resolvedTarget
            : resolveChildEntity(registry, rootEntity, track.childPath, inst);
        if (target == INVALID_ENTITY) continue;

        switch (track.type) {
            case EventTrackType::Spine: {
                i32 currentClip = -1;
                for (i32 ci = static_cast<i32>(track.spineClips.size()) - 1; ci >= 0; ci--) {
                    const auto& clip = track.spineClips[ci];
                    if (time >= clip.start && time < clip.start + clip.duration) {
                        currentClip = ci;
                        break;
                    }
                }

                i32 prevClip = inst.spineClipIndices[i];
                if (currentClip != prevClip) {
                    inst.spineClipIndices[i] = currentClip;
                    if (currentClip == -1) {
                        if (prevClip >= 0) {
                            pendingEvents_.push_back({
                                TimelineEvent::SpineStop, target, 0, 0.0f, -1
                            });
                        }
                    } else {
                        const auto& clip = track.spineClips[currentClip];
                        i32 strIdx = addEventString(clip.animation);
                        pendingEvents_.push_back({
                            TimelineEvent::SpinePlay, target,
                            clip.loop ? 1 : 0, clip.speed, strIdx
                        });
                    }
                }
                break;
            }
            case EventTrackType::SpriteAnim: {
                if (prevTime <= track.spriteAnimStartTime &&
                    time >= track.spriteAnimStartTime && time > prevTime) {
                    i32 strIdx = addEventString(track.spriteAnimClip);
                    pendingEvents_.push_back({
                        TimelineEvent::SpriteAnimPlay, target, 0, 0.0f, strIdx
                    });
                }
                break;
            }
            case EventTrackType::Audio: {
                for (const auto& event : track.audioEvents) {
                    if (event.time > prevTime && event.time <= time) {
                        i32 strIdx = addEventString(event.clip);
                        pendingEvents_.push_back({
                            TimelineEvent::AudioPlay, target, 0, event.volume, strIdx
                        });
                    }
                }
                break;
            }
            case EventTrackType::Activation: {
                bool active = false;
                for (const auto& range : track.activationRanges) {
                    if (time >= range.start && time < range.end) {
                        active = true;
                        break;
                    }
                }
                pendingEvents_.push_back({
                    TimelineEvent::ActivationSet, target, active ? 1 : 0, 0.0f, -1
                });
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Advance (runtime per-frame)
// ---------------------------------------------------------------------------

void TimelineSystem::advance(
    ecs::Registry& registry, TimelineHandle handle,
    Entity rootEntity, f32 deltaTime)
{
    auto* inst = getInstance(handle);
    if (!inst || !inst->playing) return;

    inst->previousTime = inst->currentTime;
    inst->currentTime += deltaTime * inst->speed;

    bool stopped = false;
    inst->currentTime = applyWrapMode(
        inst->currentTime, inst->data.duration, inst->data.wrapMode, stopped);

    evaluatePropertyTracks(registry, rootEntity, *inst);
    evaluateEventTracks(registry, rootEntity, *inst);

    if (stopped) {
        inst->playing = false;
    }
}

// ---------------------------------------------------------------------------
// EvaluateAt (editor scrub, evaluate only)
// ---------------------------------------------------------------------------

i32 TimelineSystem::evaluateAt(
    TimelineHandle handle, f32 time,
    f32* outValues, i32 maxChannels) const
{
    auto* inst = getInstance(handle);
    if (!inst) return 0;

    i32 idx = 0;
    for (const auto& track : inst->data.propertyTracks) {
        for (const auto& channel : track.channels) {
            if (idx >= maxChannels) return idx;
            outValues[idx++] = evaluateChannel(channel, time);
        }
    }
    return idx;
}

// ---------------------------------------------------------------------------
// Event string pool
// ---------------------------------------------------------------------------

i32 TimelineSystem::addEventString(const std::string& str) {
    stringPool_.push_back(str);
    return static_cast<i32>(stringPool_.size()) - 1;
}

const std::string& TimelineSystem::getEventString(i32 index) const {
    if (index < 0 || index >= static_cast<i32>(stringPool_.size())) {
        return EMPTY_STRING;
    }
    return stringPool_[index];
}

void TimelineSystem::setTrackTarget(
    TimelineHandle handle, bool isEventTrack,
    i32 trackIndex, Entity target)
{
    auto* inst = getInstance(handle);
    if (!inst) return;

    if (isEventTrack) {
        if (trackIndex >= 0 && trackIndex < static_cast<i32>(inst->data.eventTracks.size())) {
            inst->data.eventTracks[trackIndex].resolvedTarget = target;
        }
    } else {
        if (trackIndex >= 0 && trackIndex < static_cast<i32>(inst->data.propertyTracks.size())) {
            inst->data.propertyTracks[trackIndex].resolvedTarget = target;
        }
    }
}

void TimelineSystem::clearPendingResults() {
    pendingEvents_.clear();
    pendingCustomProperties_.clear();
    stringPool_.clear();
}

// ---------------------------------------------------------------------------
// Instance lookup
// ---------------------------------------------------------------------------

TimelineSystem::Instance* TimelineSystem::getInstance(TimelineHandle handle) {
    auto it = instances_.find(handle);
    return (it != instances_.end()) ? &it->second : nullptr;
}

const TimelineSystem::Instance* TimelineSystem::getInstance(TimelineHandle handle) const {
    auto it = instances_.find(handle);
    return (it != instances_.end()) ? &it->second : nullptr;
}

}  // namespace esengine::animation
