// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineModuleEntry.cpp
 * @brief   The Spine module's exported ABI — everything that does not depend on
 *          which Spine release is vendored.
 *
 * @details Pure computation: skeleton loading, animation update, mesh extraction.
 *          No GL, no filesystem. The engine core submits the batches this hands back.
 *
 *          Handle tables, batch packing and the readback buffers live here and are
 *          written once. The runtime itself sits behind SpineRuntime.hpp, implemented
 *          per vendored release, so adding a Spine version costs a backend rather
 *          than another branch through this file.
 *
 *          The same TU compiles into the native host binary, where there is no side
 *          module story: the entry points are declared in SpineBindings.hpp and
 *          reached through the QuickJS wrappers EHT generates from them.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

// KEEPALIVE keeps these exported through the emscripten link; natively the attribute
// has no meaning and the header does not exist.
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "SpineBindings.hpp"
#include "SpineRuntime.hpp"

#include <cstdio>
#include <cstring>
#include <iterator>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

using es::spine::ConstraintKind;
using es::spine::Event;
using es::spine::InstancePtr;
using es::spine::PathMix;
using es::spine::SkeletonPtr;
using es::spine::TransformMix;

/// One draw's worth of geometry: interleaved x,y,u,v,r,g,b,a plus its indices.
struct MeshBatch {
    std::vector<float> vertices;
    std::vector<uint16_t> indices;
    uint32_t texture = 0;
    int blendMode = 0;
};

constexpr int VERTEX_FLOATS = 8;
/// 16-bit indices, so a batch stops short of the point where one would wrap.
constexpr size_t MAX_BATCH_VERTICES = 65535;

constexpr int MAX_EVENTS_PER_UPDATE = 64;

struct LiveInstance {
    InstancePtr instance;
    int skeletonHandle = -1;
};

struct EventRecord {
    const char* animationName = nullptr;
    const char* eventName = nullptr;
    const char* stringValue = nullptr;
};

struct Context {
    std::unordered_map<int, SkeletonPtr> skeletons;
    std::unordered_map<int, LiveInstance> instances;
    int nextSkeletonId = 1;
    int nextInstanceId = 1;

    std::vector<MeshBatch> batches;

    /// Clip-region processing, on by default: a debug and perf knob, so a scene
    /// with no clip regions can skip the machinery and a clipped one can be
    /// compared against its unclipped self.
    bool clippingEnabled = true;

    std::string stringBuffer;
    std::string lastError;

    std::vector<float> eventBuffer;
    std::vector<EventRecord> eventRecords;
    int eventCount = 0;

    es::spine::Instance* instanceOf(int id) {
        auto it = instances.find(id);
        return it == instances.end() ? nullptr : it->second.instance.get();
    }

    es::spine::Skeleton* skeletonOf(int handle) {
        auto it = skeletons.find(handle);
        return it == skeletons.end() ? nullptr : it->second.get();
    }
};

Context g_ctx;

/**
 * Collects a backend's triangles into batches. A texture or blend-mode change
 * starts a new batch, as does filling one up; within a batch the incoming indices
 * are rebased onto the vertices already written.
 */
class BatchCollector final : public es::spine::TriangleSink {
public:
    void emit(const float* positions, const float* uvs, int vertexCount,
              const uint16_t* indices, int indexCount,
              uint32_t texture, int blendMode, const float rgba[4]) override {
        if (vertexCount <= 0 || indexCount <= 0) return;

        MeshBatch& batch = batchFor(texture, blendMode, vertexCount);
        const auto base = static_cast<uint16_t>(batch.vertices.size() / VERTEX_FLOATS);

        for (int i = 0; i < vertexCount; ++i) {
            batch.vertices.push_back(positions[i * 2]);
            batch.vertices.push_back(positions[i * 2 + 1]);
            batch.vertices.push_back(uvs[i * 2]);
            batch.vertices.push_back(uvs[i * 2 + 1]);
            batch.vertices.push_back(rgba[0]);
            batch.vertices.push_back(rgba[1]);
            batch.vertices.push_back(rgba[2]);
            batch.vertices.push_back(rgba[3]);
        }
        for (int i = 0; i < indexCount; ++i) {
            batch.indices.push_back(static_cast<uint16_t>(base + indices[i]));
        }
    }

private:
    // Indexed rather than pointed at: the batch list reallocates as it grows, and
    // an index survives that.
    MeshBatch& batchFor(uint32_t texture, int blendMode, int incomingVertices) {
        if (current_ < g_ctx.batches.size()) {
            MeshBatch& open = g_ctx.batches[current_];
            const bool sameState = texture == open.texture && blendMode == open.blendMode;
            const bool fits =
                open.vertices.size() / VERTEX_FLOATS + static_cast<size_t>(incomingVertices)
                <= MAX_BATCH_VERTICES;
            if (sameState && fits) return open;
        }
        current_ = g_ctx.batches.size();
        g_ctx.batches.emplace_back();
        MeshBatch& fresh = g_ctx.batches.back();
        fresh.texture = texture;
        fresh.blendMode = blendMode;
        return fresh;
    }

    size_t current_ = static_cast<size_t>(-1);
};

/// Packs one event into the float buffer the SDK reads back, plus its strings.
void collectEvent(const Event& event) {
    if (g_ctx.eventCount >= MAX_EVENTS_PER_UPDATE) return;

    // Two ints ride in the float buffer as their bit patterns — the SDK reads them
    // back through the same reinterpretation.
    const auto pushInt = [](int value) {
        float bits;
        std::memcpy(&bits, &value, sizeof(bits));
        g_ctx.eventBuffer.push_back(bits);
    };

    pushInt(static_cast<int>(event.kind));
    pushInt(event.track);
    g_ctx.eventBuffer.push_back(event.floatValue);
    pushInt(event.intValue);

    g_ctx.eventRecords.push_back(EventRecord{
        event.animation,
        event.name,
        event.stringValue,
    });
    ++g_ctx.eventCount;
}

/// Re-poses `instanceId` and refills the batch list the getters below read.
void extractBatches(int instanceId) {
    g_ctx.batches.clear();
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return;

    BatchCollector collector;
    es::spine::render(instance, collector, g_ctx.clippingEnabled);
}

const char* publish(const char* text) {
    g_ctx.stringBuffer = text ? text : "";
    return g_ctx.stringBuffer.c_str();
}

/// Builds `["a","b"]` from an indexed name getter — how animations and skins cross.
const char* publishNameArray(int count, const char* (*nameAt)(const es::spine::Instance*, int),
                             const es::spine::Instance* instance) {
    g_ctx.stringBuffer = "[";
    for (int i = 0; i < count; ++i) {
        if (i > 0) g_ctx.stringBuffer += ',';
        const char* name = nameAt(instance, i);
        g_ctx.stringBuffer += '"';
        g_ctx.stringBuffer += name ? name : "";
        g_ctx.stringBuffer += '"';
    }
    g_ctx.stringBuffer += ']';
    return g_ctx.stringBuffer.c_str();
}

}  // namespace

// =============================================================================
// Resource Management
// =============================================================================

extern "C" {

EMSCRIPTEN_KEEPALIVE
int spine_loadSkeleton(uintptr_t skelDataPtr, int skelDataLen,
                       const char* atlasText, int atlasLen, int isBinary) {
    g_ctx.lastError.clear();

    es::spine::Skeleton* loaded = es::spine::loadSkeleton(
        reinterpret_cast<const void*>(skelDataPtr), skelDataLen,
        atlasText, atlasLen, isBinary != 0, g_ctx.lastError);
    if (!loaded) return -1;

    const int id = g_ctx.nextSkeletonId++;
    g_ctx.skeletons.emplace(id, SkeletonPtr(loaded));
    return id;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getLastError() {
    return g_ctx.lastError.c_str();
}

EMSCRIPTEN_KEEPALIVE
void spine_unloadSkeleton(int handle) {
    auto it = g_ctx.skeletons.find(handle);
    if (it == g_ctx.skeletons.end()) return;

    // Instances hold the skeleton's data; they go first.
    for (auto instance = g_ctx.instances.begin(); instance != g_ctx.instances.end();) {
        instance = instance->second.skeletonHandle == handle
                       ? g_ctx.instances.erase(instance)
                       : std::next(instance);
    }
    g_ctx.skeletons.erase(it);
}

EMSCRIPTEN_KEEPALIVE
int spine_getAtlasPageCount(int handle) {
    return es::spine::atlasPageCount(g_ctx.skeletonOf(handle));
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getAtlasPageTextureName(int handle, int pageIndex) {
    return publish(es::spine::atlasPageName(g_ctx.skeletonOf(handle), pageIndex));
}

EMSCRIPTEN_KEEPALIVE
void spine_setAtlasPageTexture(int handle, int pageIndex,
                               uint32_t textureId, int width, int height) {
    es::spine::setAtlasPageTexture(g_ctx.skeletonOf(handle), pageIndex, textureId, width, height);
}

// =============================================================================
// Instance Management
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_createInstance(int skeletonHandle) {
    auto* skeleton = g_ctx.skeletonOf(skeletonHandle);
    if (!skeleton) return -1;

    es::spine::Instance* created = es::spine::createInstance(skeleton);
    if (!created) return -1;

    const int id = g_ctx.nextInstanceId++;
    g_ctx.instances.emplace(id, LiveInstance{InstancePtr(created), skeletonHandle});
    return id;
}

EMSCRIPTEN_KEEPALIVE
void spine_destroyInstance(int instanceId) {
    g_ctx.instances.erase(instanceId);
}

// =============================================================================
// Animation Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_playAnimation(int instanceId, const char* name, int loop, int track) {
    return es::spine::playAnimation(g_ctx.instanceOf(instanceId), name, loop != 0, track) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int spine_addAnimation(int instanceId, const char* name, int loop, float delay, int track) {
    return es::spine::addAnimation(g_ctx.instanceOf(instanceId), name, loop != 0, delay, track) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void spine_setSkin(int instanceId, const char* name) {
    es::spine::setSkin(g_ctx.instanceOf(instanceId), name);
}

EMSCRIPTEN_KEEPALIVE
void spine_update(int instanceId, float dt) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return;

    g_ctx.eventBuffer.clear();
    g_ctx.eventRecords.clear();
    g_ctx.eventCount = 0;

    es::spine::update(instance, dt);
}

// =============================================================================
// Query
// =============================================================================

EMSCRIPTEN_KEEPALIVE
const char* spine_getAnimations(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return publish("[]");
    return publishNameArray(es::spine::animationCount(instance), es::spine::animationName, instance);
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getSkins(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return publish("[]");
    return publishNameArray(es::spine::skinCount(instance), es::spine::skinName, instance);
}

EMSCRIPTEN_KEEPALIVE
int spine_getBonePosition(int instanceId, const char* bone,
                          uintptr_t outXPtr, uintptr_t outYPtr) {
    return es::spine::bonePosition(g_ctx.instanceOf(instanceId), bone,
                                   reinterpret_cast<float*>(outXPtr),
                                   reinterpret_cast<float*>(outYPtr))
               ? 1
               : 0;
}

EMSCRIPTEN_KEEPALIVE
float spine_getBoneRotation(int instanceId, const char* bone) {
    float degrees = 0.0f;
    es::spine::boneRotation(g_ctx.instanceOf(instanceId), bone, &degrees);
    return degrees;
}

EMSCRIPTEN_KEEPALIVE
void spine_getBounds(int instanceId, uintptr_t outXPtr, uintptr_t outYPtr,
                     uintptr_t outWPtr, uintptr_t outHPtr) {
    es::spine::bounds(g_ctx.instanceOf(instanceId),
                      reinterpret_cast<float*>(outXPtr), reinterpret_cast<float*>(outYPtr),
                      reinterpret_cast<float*>(outWPtr), reinterpret_cast<float*>(outHPtr));
}

// =============================================================================
// Mesh Extraction
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchCount(int instanceId) {
    extractBatches(instanceId);
    return static_cast<int>(g_ctx.batches.size());
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return 0;
    return static_cast<int>(g_ctx.batches[batchIndex].vertices.size() / VERTEX_FLOATS);
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchIndexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return 0;
    return static_cast<int>(g_ctx.batches[batchIndex].indices.size());
}

EMSCRIPTEN_KEEPALIVE
void spine_getMeshBatchData(int instanceId, int batchIndex,
                            uintptr_t outVerticesPtr, uintptr_t outIndicesPtr,
                            uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return;

    const MeshBatch& batch = g_ctx.batches[batchIndex];
    std::memcpy(reinterpret_cast<float*>(outVerticesPtr), batch.vertices.data(),
                batch.vertices.size() * sizeof(float));
    std::memcpy(reinterpret_cast<uint16_t*>(outIndicesPtr), batch.indices.data(),
                batch.indices.size() * sizeof(uint16_t));
    *reinterpret_cast<uint32_t*>(outTextureIdPtr) = batch.texture;
    *reinterpret_cast<int*>(outBlendModePtr) = batch.blendMode;
}

EMSCRIPTEN_KEEPALIVE
void spine_setClippingEnabled(int enabled) {
    g_ctx.clippingEnabled = enabled != 0;
}

// =============================================================================
// Mix Duration / Track Alpha
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void spine_setDefaultMix(int skeletonHandle, float duration) {
    es::spine::setDefaultMix(g_ctx.skeletonOf(skeletonHandle), duration);
}

EMSCRIPTEN_KEEPALIVE
void spine_setMixDuration(int skeletonHandle, const char* fromAnim,
                          const char* toAnim, float duration) {
    es::spine::setMixDuration(g_ctx.skeletonOf(skeletonHandle), fromAnim, toAnim, duration);
}

EMSCRIPTEN_KEEPALIVE
void spine_setTrackAlpha(int instanceId, int track, float alpha) {
    es::spine::setTrackAlpha(g_ctx.instanceOf(instanceId), track, alpha);
}

// =============================================================================
// Event Collection
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void spine_enableEvents(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return;
    es::spine::setEventSink(collectEvent);
    es::spine::enableEvents(instance);
}

EMSCRIPTEN_KEEPALIVE
int spine_getEventCount(int instanceId) {
    (void)instanceId;
    return g_ctx.eventCount;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t spine_getEventBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.eventBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
void spine_clearEvents() {
    g_ctx.eventBuffer.clear();
    g_ctx.eventRecords.clear();
    g_ctx.eventCount = 0;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventAnimationName(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    const char* name = g_ctx.eventRecords[index].animationName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventName(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    const char* name = g_ctx.eventRecords[index].eventName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventStringValue(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    const char* value = g_ctx.eventRecords[index].stringValue;
    return value ? value : "";
}

// =============================================================================
// Attachment / Constraint / Colour Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_setAttachment(int instanceId, const char* slotName, const char* attachmentName) {
    return es::spine::setAttachment(g_ctx.instanceOf(instanceId), slotName, attachmentName) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int spine_setIKTarget(int instanceId, const char* constraintName,
                      float targetX, float targetY, float mix) {
    return es::spine::setIkTarget(g_ctx.instanceOf(instanceId), constraintName,
                                  targetX, targetY, mix)
               ? 1
               : 0;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_listConstraints(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return publish("{}");

    static constexpr struct {
        const char* key;
        ConstraintKind kind;
    } kinds[] = {
        {"ik", ConstraintKind::Ik},
        {"transform", ConstraintKind::Transform},
        {"path", ConstraintKind::Path},
    };

    g_ctx.stringBuffer = "{";
    for (size_t k = 0; k < sizeof(kinds) / sizeof(kinds[0]); ++k) {
        if (k > 0) g_ctx.stringBuffer += ',';
        g_ctx.stringBuffer += '"';
        g_ctx.stringBuffer += kinds[k].key;
        g_ctx.stringBuffer += "\":[";
        const int count = es::spine::constraintCount(instance, kinds[k].kind);
        for (int i = 0; i < count; ++i) {
            if (i > 0) g_ctx.stringBuffer += ',';
            const char* name = es::spine::constraintName(instance, kinds[k].kind, i);
            g_ctx.stringBuffer += '"';
            g_ctx.stringBuffer += name ? name : "";
            g_ctx.stringBuffer += '"';
        }
        g_ctx.stringBuffer += ']';
    }
    g_ctx.stringBuffer += '}';
    return g_ctx.stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getTransformConstraintMix(int instanceId, const char* name) {
    TransformMix mix;
    if (!es::spine::transformMix(g_ctx.instanceOf(instanceId), name, &mix)) return publish("");

    char buffer[256];
    std::snprintf(buffer, sizeof(buffer),
                  "{\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g,"
                  "\"mixScaleX\":%.6g,\"mixScaleY\":%.6g,\"mixShearY\":%.6g}",
                  mix.rotate, mix.x, mix.y, mix.scaleX, mix.scaleY, mix.shearY);
    return publish(buffer);
}

EMSCRIPTEN_KEEPALIVE
int spine_setTransformConstraintMix(int instanceId, const char* name, float rotate,
                                    float x, float y, float scaleX, float scaleY, float shearY) {
    const TransformMix mix{rotate, x, y, scaleX, scaleY, shearY};
    return es::spine::setTransformMix(g_ctx.instanceOf(instanceId), name, mix) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getPathConstraintMix(int instanceId, const char* name) {
    PathMix mix;
    if (!es::spine::pathMix(g_ctx.instanceOf(instanceId), name, &mix)) return publish("");

    char buffer[256];
    std::snprintf(buffer, sizeof(buffer),
                  "{\"position\":%.6g,\"spacing\":%.6g,"
                  "\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g}",
                  mix.position, mix.spacing, mix.rotate, mix.x, mix.y);
    return publish(buffer);
}

EMSCRIPTEN_KEEPALIVE
int spine_setPathConstraintMix(int instanceId, const char* name, float position,
                               float spacing, float rotate, float x, float y) {
    const PathMix mix{position, spacing, rotate, x, y};
    return es::spine::setPathMix(g_ctx.instanceOf(instanceId), name, mix) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int spine_setSlotColor(int instanceId, const char* slotName,
                       float r, float g, float b, float a) {
    return es::spine::setSlotColor(g_ctx.instanceOf(instanceId), slotName, r, g, b, a) ? 1 : 0;
}

// Whole-skeleton tint: extraction already multiplies the skeleton colour into every
// vertex, so this is all the wiring a SpineAnimation.color needs.
EMSCRIPTEN_KEEPALIVE
int spine_setSkeletonColor(int instanceId, float r, float g, float b, float a) {
    return es::spine::setSkeletonColor(g_ctx.instanceOf(instanceId), r, g, b, a) ? 1 : 0;
}

// Which Spine runtime this build linked. Every backend exports the same symbols, so a
// binary carries exactly one and the caller has to be able to ask (the web names the
// artifact instead — spine38.wasm / spine41 / spine42 / spine43).
EMSCRIPTEN_KEEPALIVE
int spine_runtimeVersion() {
    return es::spine::version();
}

// The live extent of the event buffer, for the readback getter above: it is this
// module's own vector, so a caller cannot infer it from a count and a stride without
// assuming the stride — see `@heapreturn` in SpineBindings.hpp.
EMSCRIPTEN_KEEPALIVE
size_t spine_eventBufferBytes() {
    return g_ctx.eventBuffer.size() * sizeof(float);
}

}  // extern "C"

#ifdef __EMSCRIPTEN__
// The module is linked as an executable, so it needs an entry point; a native build
// links it into a host that has its own.
int main() {
    return 0;
}
#endif
