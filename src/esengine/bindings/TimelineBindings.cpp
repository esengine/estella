#ifdef ES_PLATFORM_WEB
#ifdef ES_ENABLE_TIMELINE

#include <emscripten.h>
#include <emscripten/bind.h>

#include "EngineContext.hpp"
#include "../animation/TimelineSystem.hpp"

#include <cstring>
#include <string>

namespace esengine {

static animation::TimelineSystem* tlSys() { return EngineContext::instance().timelineSystem(); }

// ---------------------------------------------------------------------------
// Create / Destroy
// ---------------------------------------------------------------------------

u32 tl_create(f32 duration, i32 wrapMode) {
    auto* sys = tlSys();
    if (!sys) return 0;
    animation::TimelineData data;
    data.duration = duration;
    data.wrapMode = static_cast<animation::TimelineWrapMode>(wrapMode);
    return sys->createTimeline(std::move(data));
}

void tl_destroy(u32 handle) {
    if (auto* sys = tlSys()) {
        sys->destroyTimeline(handle);
    }
}

// ---------------------------------------------------------------------------
// Upload property track
// ---------------------------------------------------------------------------

void tl_addPropertyTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                          i32 component,
                          uintptr_t fieldsPtr, i32 channelCount,
                          uintptr_t keyframeDataPtr, uintptr_t keyframeCountsPtr) {
    auto* sys = tlSys();
    if (!sys) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);
    auto* fields = reinterpret_cast<const u8*>(fieldsPtr);
    auto* kfCounts = reinterpret_cast<const i32*>(keyframeCountsPtr);
    auto* kfData = reinterpret_cast<const f32*>(keyframeDataPtr);

    animation::PropertyTrackBinding track;
    track.childPath = std::move(childPath);
    track.component = static_cast<animation::AnimTargetComponent>(component);

    i32 dataOffset = 0;
    for (i32 ci = 0; ci < channelCount; ci++) {
        track.fields.push_back(static_cast<animation::AnimTargetField>(fields[ci]));
        animation::TimelineChannel channel;
        i32 count = kfCounts[ci];
        channel.keyframes.resize(count);
        for (i32 ki = 0; ki < count; ki++) {
            channel.keyframes[ki] = {
                kfData[dataOffset], kfData[dataOffset + 1],
                kfData[dataOffset + 2], kfData[dataOffset + 3],
                static_cast<animation::InterpType>(static_cast<u8>(kfData[dataOffset + 4]))
            };
            dataOffset += 5;
        }
        track.channels.push_back(std::move(channel));
    }

    // Access internal data through system
    // We need a way to add tracks to existing timeline
    // For simplicity, we get the instance and modify it
    // This is only called during setup, not per-frame
    auto* inst = sys->getInstance(handle);
    if (inst) {
        inst->data.propertyTracks.push_back(std::move(track));
    }
}

void tl_addCustomPropertyTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                                 uintptr_t componentNamePtr, i32 componentNameLen,
                                 uintptr_t fieldPathsPtr, uintptr_t fieldPathLensPtr,
                                 i32 channelCount,
                                 uintptr_t keyframeDataPtr, uintptr_t keyframeCountsPtr) {
    auto* sys = tlSys();
    if (!sys) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);
    std::string componentName(reinterpret_cast<const char*>(componentNamePtr), componentNameLen);
    auto* pathChars = reinterpret_cast<const char*>(fieldPathsPtr);
    auto* pathLens = reinterpret_cast<const i32*>(fieldPathLensPtr);
    auto* kfCounts = reinterpret_cast<const i32*>(keyframeCountsPtr);
    auto* kfData = reinterpret_cast<const f32*>(keyframeDataPtr);

    animation::PropertyTrackBinding track;
    track.childPath = std::move(childPath);
    track.component = animation::AnimTargetComponent::Custom;
    track.customComponentName = std::move(componentName);

    i32 pathOffset = 0;
    i32 dataOffset = 0;
    for (i32 ci = 0; ci < channelCount; ci++) {
        track.fields.push_back(animation::AnimTargetField::CustomField);
        track.customFieldPaths.emplace_back(pathChars + pathOffset, pathLens[ci]);
        pathOffset += pathLens[ci];

        animation::TimelineChannel channel;
        i32 count = kfCounts[ci];
        channel.keyframes.resize(count);
        for (i32 ki = 0; ki < count; ki++) {
            channel.keyframes[ki] = {
                kfData[dataOffset], kfData[dataOffset + 1],
                kfData[dataOffset + 2], kfData[dataOffset + 3],
                static_cast<animation::InterpType>(static_cast<u8>(kfData[dataOffset + 4]))
            };
            dataOffset += 5;
        }
        track.channels.push_back(std::move(channel));
    }

    auto* inst = sys->getInstance(handle);
    if (inst) {
        inst->data.propertyTracks.push_back(std::move(track));
    }
}

// ---------------------------------------------------------------------------
// Upload event tracks
// ---------------------------------------------------------------------------

void tl_addSpineTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                       uintptr_t clipsDataPtr, uintptr_t clipAnimPtrs,
                       uintptr_t clipAnimLens, i32 clipCount, f32 blendIn) {
    auto* sys = tlSys();
    if (!sys) return;
    auto* inst = sys->getInstance(handle);
    if (!inst) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);
    auto* clipFloats = reinterpret_cast<const f32*>(clipsDataPtr);
    auto* animPtrs = reinterpret_cast<const uintptr_t*>(clipAnimPtrs);
    auto* animLens = reinterpret_cast<const i32*>(clipAnimLens);

    animation::EventTrack track;
    track.childPath = std::move(childPath);
    track.type = animation::EventTrackType::Spine;
    track.spineBlendIn = blendIn;

    for (i32 i = 0; i < clipCount; i++) {
        animation::SpineClipData clip;
        clip.start = clipFloats[i * 4];
        clip.duration = clipFloats[i * 4 + 1];
        clip.speed = clipFloats[i * 4 + 2];
        clip.loop = clipFloats[i * 4 + 3] > 0.5f;
        clip.animation = std::string(reinterpret_cast<const char*>(animPtrs[i]), animLens[i]);
        track.spineClips.push_back(std::move(clip));
    }

    inst->data.eventTracks.push_back(std::move(track));
    inst->spineClipIndices.push_back(-1);
}

void tl_addAudioTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                       uintptr_t eventsFloatPtr, uintptr_t clipPtrs,
                       uintptr_t clipLens, i32 eventCount) {
    auto* sys = tlSys();
    if (!sys) return;
    auto* inst = sys->getInstance(handle);
    if (!inst) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);
    auto* floats = reinterpret_cast<const f32*>(eventsFloatPtr);
    auto* cPtrs = reinterpret_cast<const uintptr_t*>(clipPtrs);
    auto* cLens = reinterpret_cast<const i32*>(clipLens);

    animation::EventTrack track;
    track.childPath = std::move(childPath);
    track.type = animation::EventTrackType::Audio;

    for (i32 i = 0; i < eventCount; i++) {
        animation::AudioEventData evt;
        evt.time = floats[i * 2];
        evt.volume = floats[i * 2 + 1];
        evt.clip = std::string(reinterpret_cast<const char*>(cPtrs[i]), cLens[i]);
        track.audioEvents.push_back(std::move(evt));
    }

    inst->data.eventTracks.push_back(std::move(track));
}

void tl_addActivationTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                             uintptr_t rangesPtr, i32 rangeCount) {
    auto* sys = tlSys();
    if (!sys) return;
    auto* inst = sys->getInstance(handle);
    if (!inst) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);
    auto* floats = reinterpret_cast<const f32*>(rangesPtr);

    animation::EventTrack track;
    track.childPath = std::move(childPath);
    track.type = animation::EventTrackType::Activation;

    for (i32 i = 0; i < rangeCount; i++) {
        track.activationRanges.push_back({floats[i * 2], floats[i * 2 + 1]});
    }

    inst->data.eventTracks.push_back(std::move(track));
}

void tl_addSpriteAnimTrack(u32 handle, uintptr_t childPathPtr, i32 childPathLen,
                             uintptr_t clipPathPtr, i32 clipPathLen, f32 startTime) {
    auto* sys = tlSys();
    if (!sys) return;
    auto* inst = sys->getInstance(handle);
    if (!inst) return;

    std::string childPath(reinterpret_cast<const char*>(childPathPtr), childPathLen);

    animation::EventTrack track;
    track.childPath = std::move(childPath);
    track.type = animation::EventTrackType::SpriteAnim;
    track.spriteAnimClip = std::string(reinterpret_cast<const char*>(clipPathPtr), clipPathLen);
    track.spriteAnimStartTime = startTime;

    inst->data.eventTracks.push_back(std::move(track));
}

// ---------------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------------

void tl_play(u32 handle) { if (auto* s = tlSys()) s->play(handle); }
void tl_pause(u32 handle) { if (auto* s = tlSys()) s->pause(handle); }
void tl_stop(u32 handle) { if (auto* s = tlSys()) s->stop(handle); }
void tl_setTime(u32 handle, f32 time) { if (auto* s = tlSys()) s->setTime(handle, time); }
void tl_setSpeed(u32 handle, f32 speed) { if (auto* s = tlSys()) s->setSpeed(handle, speed); }
f32 tl_getTime(u32 handle) { auto* s = tlSys(); return s ? s->getTime(handle) : 0.0f; }
i32 tl_isPlaying(u32 handle) { auto* s = tlSys(); return s && s->isPlaying(handle) ? 1 : 0; }

// ---------------------------------------------------------------------------
// Advance (runtime per-frame)
// ---------------------------------------------------------------------------

void tl_advance(ecs::Registry& registry, u32 handle, u32 rootEntity, f32 deltaTime, f32 speed) {
    auto* sys = tlSys();
    if (!sys) return;
    sys->setSpeed(handle, speed);
    sys->advance(registry, handle, static_cast<Entity>(rootEntity), deltaTime);
}

// ---------------------------------------------------------------------------
// Evaluate at time (editor scrub)
// ---------------------------------------------------------------------------

i32 tl_evaluateAt(u32 handle, f32 time, uintptr_t outPtr, i32 maxChannels) {
    auto* sys = tlSys();
    if (!sys) return 0;
    return sys->evaluateAt(handle, time, reinterpret_cast<f32*>(outPtr), maxChannels);
}

// ---------------------------------------------------------------------------
// Read pending results
// ---------------------------------------------------------------------------

i32 tl_getEventCount() {
    auto* sys = tlSys();
    return sys ? static_cast<i32>(sys->pendingEvents().size()) : 0;
}

i32 tl_getEventType(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return -1;
    return static_cast<i32>(sys->pendingEvents()[index].type);
}

u32 tl_getEventEntity(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return INVALID_ENTITY;
    return sys->pendingEvents()[index].targetEntity;
}

i32 tl_getEventIntParam(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return 0;
    return sys->pendingEvents()[index].intParam;
}

f32 tl_getEventFloatParam(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return 0.0f;
    return sys->pendingEvents()[index].floatParam;
}

uintptr_t tl_getEventString(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return 0;
    i32 strIdx = sys->pendingEvents()[index].stringIndex;
    const auto& str = sys->getEventString(strIdx);
    return reinterpret_cast<uintptr_t>(str.c_str());
}

i32 tl_getEventStringLen(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingEvents().size())) return 0;
    i32 strIdx = sys->pendingEvents()[index].stringIndex;
    return static_cast<i32>(sys->getEventString(strIdx).size());
}

i32 tl_getCustomPropertyCount() {
    auto* sys = tlSys();
    return sys ? static_cast<i32>(sys->pendingCustomProperties().size()) : 0;
}

u32 tl_getCustomPropertyEntity(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingCustomProperties().size())) return INVALID_ENTITY;
    return sys->pendingCustomProperties()[index].targetEntity;
}

i32 tl_getCustomPropertyTrackIndex(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingCustomProperties().size())) return -1;
    return sys->pendingCustomProperties()[index].trackIndex;
}

i32 tl_getCustomPropertyChannelIndex(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingCustomProperties().size())) return -1;
    return sys->pendingCustomProperties()[index].channelIndex;
}

f32 tl_getCustomPropertyValue(i32 index) {
    auto* sys = tlSys();
    if (!sys || index < 0 || index >= static_cast<i32>(sys->pendingCustomProperties().size())) return 0.0f;
    return sys->pendingCustomProperties()[index].value;
}

void tl_clearResults() {
    if (auto* sys = tlSys()) {
        sys->clearPendingResults();
    }
}

void tl_setTrackTarget(u32 handle, i32 isEventTrack, i32 trackIndex, u32 entity) {
    auto* sys = tlSys();
    if (!sys) return;
    sys->setTrackTarget(handle, isEventTrack != 0, trackIndex, static_cast<Entity>(entity));
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_timeline) {
    emscripten::function("_tl_create", &esengine::tl_create);
    emscripten::function("_tl_destroy", &esengine::tl_destroy);
    emscripten::function("_tl_addPropertyTrack", &esengine::tl_addPropertyTrack);
    emscripten::function("_tl_addCustomPropertyTrack", &esengine::tl_addCustomPropertyTrack);
    emscripten::function("_tl_addSpineTrack", &esengine::tl_addSpineTrack);
    emscripten::function("_tl_addAudioTrack", &esengine::tl_addAudioTrack);
    emscripten::function("_tl_addActivationTrack", &esengine::tl_addActivationTrack);
    emscripten::function("_tl_addSpriteAnimTrack", &esengine::tl_addSpriteAnimTrack);
    emscripten::function("_tl_play", &esengine::tl_play);
    emscripten::function("_tl_pause", &esengine::tl_pause);
    emscripten::function("_tl_stop", &esengine::tl_stop);
    emscripten::function("_tl_setTime", &esengine::tl_setTime);
    emscripten::function("_tl_setSpeed", &esengine::tl_setSpeed);
    emscripten::function("_tl_getTime", &esengine::tl_getTime);
    emscripten::function("_tl_isPlaying", &esengine::tl_isPlaying);
    emscripten::function("_tl_advance", &esengine::tl_advance);
    emscripten::function("_tl_evaluateAt", &esengine::tl_evaluateAt);
    emscripten::function("_tl_getEventCount", &esengine::tl_getEventCount);
    emscripten::function("_tl_getEventType", &esengine::tl_getEventType);
    emscripten::function("_tl_getEventEntity", &esengine::tl_getEventEntity);
    emscripten::function("_tl_getEventIntParam", &esengine::tl_getEventIntParam);
    emscripten::function("_tl_getEventFloatParam", &esengine::tl_getEventFloatParam);
    emscripten::function("_tl_getEventString", &esengine::tl_getEventString);
    emscripten::function("_tl_getEventStringLen", &esengine::tl_getEventStringLen);
    emscripten::function("_tl_getCustomPropertyCount", &esengine::tl_getCustomPropertyCount);
    emscripten::function("_tl_getCustomPropertyEntity", &esengine::tl_getCustomPropertyEntity);
    emscripten::function("_tl_getCustomPropertyTrackIndex", &esengine::tl_getCustomPropertyTrackIndex);
    emscripten::function("_tl_getCustomPropertyChannelIndex", &esengine::tl_getCustomPropertyChannelIndex);
    emscripten::function("_tl_getCustomPropertyValue", &esengine::tl_getCustomPropertyValue);
    emscripten::function("_tl_clearResults", &esengine::tl_clearResults);
    emscripten::function("_tl_setTrackTarget", &esengine::tl_setTrackTarget);
}

#endif  // ES_ENABLE_TIMELINE
#endif  // ES_PLATFORM_WEB
