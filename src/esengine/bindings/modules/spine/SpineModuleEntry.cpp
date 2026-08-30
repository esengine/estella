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

#include "./SpineBindings.hpp"
#include "./SpineRuntime.hpp"

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

struct LiveInstance {
    InstancePtr instance;
    int skeletonHandle = -1;
};

struct Context {
    es::skeletal::HandleTable<SkeletonPtr> skeletons;
    es::skeletal::HandleTable<LiveInstance> instances;

    es::skeletal::BatchList batches;
    es::skeletal::StringBuffer strings;
    es::skeletal::EventBuffer events;

    /// Clip-region processing, on by default: a debug and perf knob, so a scene
    /// with no clip regions can skip the machinery and a clipped one can be
    /// compared against its unclipped self.
    bool clippingEnabled = true;

    std::string lastError;

    es::spine::Instance* instanceOf(int id) {
        auto* live = instances.find(id);
        return live ? live->instance.get() : nullptr;
    }

    es::spine::Skeleton* skeletonOf(int handle) {
        auto* held = skeletons.find(handle);
        return held ? held->get() : nullptr;
    }
};

Context g_ctx;

/// Queues one event for the SDK to drain after the update that produced it.
void collectEvent(const Event& event) {
    g_ctx.events.push(static_cast<int>(event.kind), event.track, event.floatValue, event.intValue,
                      es::skeletal::EventStrings{event.animation, event.name, event.stringValue});
}

/// Re-poses `instanceId` and refills the batch list the getters below read.
/** Takes what a stage emitted and keeps none of it: the walk without the cost of
 *  storing its output. Benchmark only — see spine_probe_extract. */
struct CountingSink final : es::skeletal::TriangleSink {
    void emit(const float*, const float*, int, const std::uint16_t*, int,
              std::uint32_t, int, const float[4]) override {}
};

/** The last probe run's counts. Benchmark only; a frame never writes it. */
es::spine::ProbeCounts g_probeCounts{};

/** The last staged pose's counts. Benchmark only, for the same reason. */
es::spine::PoseCounts g_poseCounts{};

void extractBatches(int instanceId) {
    g_ctx.batches.reset();
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return;

    es::skeletal::BatchCollector collector(g_ctx.batches);
    es::spine::render(instance, collector, g_ctx.clippingEnabled);
}

const char* publish(const char* text) { return g_ctx.strings.publish(text); }

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

    const int id = g_ctx.skeletons.add(SkeletonPtr(loaded));
    return id;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getLastError() {
    return g_ctx.lastError.c_str();
}

EMSCRIPTEN_KEEPALIVE
void spine_unloadSkeleton(int handle) {
    if (!g_ctx.skeletons.find(handle)) return;

    // Instances hold the skeleton's data; they go first.
    g_ctx.instances.eraseIf([handle](const LiveInstance& live) { return live.skeletonHandle == handle; });
    g_ctx.skeletons.erase(handle);
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

    const int id = g_ctx.instances.add(LiveInstance{InstancePtr(created), skeletonHandle});
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
    // The composition lives in the runtime beside the two halves, so there is
    // one definition of what a whole frame is rather than one here as well.
    g_ctx.events.clear();
    es::spine::update(instance, dt);
}

/**
 * Advance the animation clock and apply it to the bones' LOCAL transforms —
 * everything an animation means, and nothing about where it is in the world.
 * The events this produced are queued here, so a caller drains them whether or
 * not it goes on to materialize a world pose.
 */
EMSCRIPTEN_KEEPALIVE
void spine_advanceAndApply(int instanceId, float dt) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return;
    g_ctx.events.clear();
    es::spine::advanceAndApply(instance, dt);
}

/**
 * Resolve the world transforms the local pose implies. Deferring it past an
 * advance is only equivalent where the skeleton says so — see
 * {@link spine_requiresContinuousWorldPose}.
 */
EMSCRIPTEN_KEEPALIVE
void spine_materializeWorldPose(int instanceId, float dt) {
    es::spine::materializeWorldPose(g_ctx.instanceOf(instanceId), dt);
}

/** 1 where this skeleton's world pose carries state and may not be deferred. */
EMSCRIPTEN_KEEPALIVE
int spine_requiresContinuousWorldPose(int skeletonHandle) {
    return es::spine::requiresContinuousWorldPose(g_ctx.skeletonOf(skeletonHandle)) ? 1 : 0;
}

// =============================================================================
// Query
// =============================================================================

EMSCRIPTEN_KEEPALIVE
const char* spine_getAnimations(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return publish("[]");
    return g_ctx.strings.publishArray(es::spine::animationCount(instance),
                                      [instance](int i) { return es::spine::animationName(instance, i); });
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getSkins(int instanceId) {
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return publish("[]");
    return g_ctx.strings.publishArray(es::spine::skinCount(instance),
                                      [instance](int i) { return es::spine::skinName(instance, i); });
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

/**
 * The skeleton's AUTHORED extent, into four floats. Answerable from the data
 * alone — no instance, no pose — which is what makes it usable for deciding
 * whether a pose is worth computing. Zero and false where the runtime cannot
 * report it.
 */
EMSCRIPTEN_KEEPALIVE
int spine_getSkeletonBounds(int skeletonHandle, uintptr_t outXPtr, uintptr_t outYPtr,
                            uintptr_t outWPtr, uintptr_t outHPtr) {
    auto* x = reinterpret_cast<float*>(outXPtr);
    auto* y = reinterpret_cast<float*>(outYPtr);
    auto* w = reinterpret_cast<float*>(outWPtr);
    auto* h = reinterpret_cast<float*>(outHPtr);
    *x = *y = *w = *h = 0.0f;
    return es::spine::skeletonBounds(g_ctx.skeletonOf(skeletonHandle), x, y, w, h) ? 1 : 0;
}

// =============================================================================
// Mesh Extraction
// =============================================================================

/**
 * BENCHMARK ONLY — the extraction run to `stage`.
 *
 * `useCollector` 0 counts the emitted triangles and drops them, 1 stores them as
 * a frame does; the difference at the last stage is what the collector's vectors
 * cost. Not on any frame path: the staged walk is its own instantiation.
 */
EMSCRIPTEN_KEEPALIVE
int spine_probe_extract(int instanceId, int stage, int useCollector) {
    g_probeCounts = es::spine::ProbeCounts{};
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return 0;
    if (useCollector) {
        g_ctx.batches.reset();
        es::skeletal::BatchCollector collector(g_ctx.batches);
        return es::spine::renderStage(instance, collector, g_ctx.clippingEnabled,
                                      stage, &g_probeCounts) ? 1 : 0;
    }
    CountingSink sink;
    return es::spine::renderStage(instance, sink, g_ctx.clippingEnabled,
                                  stage, &g_probeCounts) ? 1 : 0;
}

/** The counts of the last {@link spine_probe_extract}, into twenty-four u32 slots. */
EMSCRIPTEN_KEEPALIVE
void spine_probe_counts(std::uint32_t* out) {
    if (!out) return;
    out[0] = g_probeCounts.slots;
    out[1] = g_probeCounts.regionAttachments;
    out[2] = g_probeCounts.meshAttachments;
    out[3] = g_probeCounts.clipStarts;
    out[4] = g_probeCounts.clippedEmits;
    out[5] = g_probeCounts.verticesGenerated;
    out[6] = g_probeCounts.verticesEmitted;
    out[7] = g_probeCounts.indicesEmitted;
    out[8] = g_probeCounts.emits;
    out[9] = g_probeCounts.clipPolygons;
    out[10] = g_probeCounts.clipPolygonVertices;
    out[11] = g_probeCounts.clipPolygonEdges;
    out[12] = g_probeCounts.clipInputTriangles;
    out[13] = g_probeCounts.clipOutputTriangles;
    out[14] = g_probeCounts.clipBoundsRejects;
    out[15] = g_probeCounts.clipInsideAccepts;
    out[16] = g_probeCounts.clipCandidateTriangles;
    out[17] = g_probeCounts.clipRejectedTriangles;
    out[18] = g_probeCounts.clipBypassedTriangles;
    out[19] = g_probeCounts.clipEdgeWork;
    out[20] = g_probeCounts.clipInputVertices;
    out[21] = g_probeCounts.clipOutputVertices;
    out[22] = g_probeCounts.clipConvexBypasses;
    out[23] = g_probeCounts.clipDecompositions;
}

/** The last staged open's counts. Benchmark only; a frame never writes it. */
es::spine::ClipStartCounts g_clipStartCounts{};

/**
 * BENCHMARK ONLY — open the instance's first clip region to `stage`
 * (es::spine::ClipStartStage), so what a 39-vertex polygon costs before a single
 * triangle is cut can be priced without a clock inside the preparation.
 */
EMSCRIPTEN_KEEPALIVE
int spine_probe_clip_start(int instanceId, int stage) {
    g_clipStartCounts = es::spine::ClipStartCounts{};
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return 0;
    const bool ran = es::spine::clipStartStage(instance, stage, &g_clipStartCounts);
    return ran ? 1 : 0;
}

/** Nine slots: five counts, then the region's bounds as four floats. */
EMSCRIPTEN_KEEPALIVE
void spine_probe_clip_start_counts(std::uint32_t* out) {
    if (!out) return;
    out[0] = g_clipStartCounts.rawVertices;
    out[1] = g_clipStartCounts.triangulationTriangles;
    out[2] = g_clipStartCounts.pieces;
    out[3] = g_clipStartCounts.effectiveEdges;
    out[4] = g_clipStartCounts.triangulatorScratch;
    std::memcpy(out + 5, &g_clipStartCounts.minX, sizeof(float));
    std::memcpy(out + 6, &g_clipStartCounts.minY, sizeof(float));
    std::memcpy(out + 7, &g_clipStartCounts.maxX, sizeof(float));
    std::memcpy(out + 8, &g_clipStartCounts.maxY, sizeof(float));
}

/**
 * What one instance's clipping costs THIS pose, in work not time, into eleven
 * u32 slots: the polygon as authored, what it decomposed into, the triangles
 * that reached the region and what became of each, and what the cut handed
 * back. Poses and extracts, because a diagnostic pays for its own answer.
 */
EMSCRIPTEN_KEEPALIVE
int spine_clipBudget(int instanceId, std::uint32_t* out) {
    if (!out) return 0;
    for (int i = 0; i < 11; ++i) out[i] = 0;
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return 0;

    es::spine::ProbeCounts counts{};
    CountingSink sink;
    if (!es::spine::renderCounted(instance, sink, g_ctx.clippingEnabled, &counts)) return 0;

    out[0] = counts.clipPolygonVertices;
    out[1] = counts.clipPolygons;
    out[2] = counts.clipPolygonEdges;
    out[3] = counts.clipCandidateTriangles;
    out[4] = counts.clipRejectedTriangles;
    out[5] = counts.clipBypassedTriangles;
    out[6] = counts.clipInputTriangles;
    out[7] = counts.clipEdgeWork;
    out[8] = counts.clipInputVertices;
    out[9] = counts.clipOutputVertices;
    out[10] = counts.clipOutputTriangles;
    return 1;
}

/** BENCHMARK ONLY — the clipper's own scratch, into six u32 slots. Zero where a
 *  backend keeps no clipper of its own. */
EMSCRIPTEN_KEEPALIVE
void spine_probe_clip_storage(std::uint32_t* out) {
    if (!out) return;
    es::spine::ClipStorage held{};
    es::spine::clipStorage(&held);
    out[0] = held.polygon;
    out[1] = held.output;
    out[2] = held.vertices;
    out[3] = held.uvs;
    out[4] = held.triangles;
    out[5] = held.scratch;
}

/**
 * BENCHMARK ONLY — the pose run to `stage` (es::spine::PoseStage). Advancing a
 * pose is not a query: this MOVES the instance forward, so a caller measuring
 * with it owns the instance's clock.
 */
EMSCRIPTEN_KEEPALIVE
int spine_probe_pose(int instanceId, float dt, int stage) {
    g_poseCounts = es::spine::PoseCounts{};
    auto* instance = g_ctx.instanceOf(instanceId);
    if (!instance) return 0;
    return es::spine::poseStage(instance, dt, stage, &g_poseCounts) ? 1 : 0;
}

/** The counts of the last {@link spine_probe_pose}, into nine u32 slots. */
EMSCRIPTEN_KEEPALIVE
void spine_probe_pose_counts(std::uint32_t* out) {
    if (!out) return;
    out[0] = g_poseCounts.tracks;
    out[1] = g_poseCounts.entries;
    out[2] = g_poseCounts.timelines;
    out[3] = g_poseCounts.bones;
    out[4] = g_poseCounts.ikConstraints;
    out[5] = g_poseCounts.transformConstraints;
    out[6] = g_poseCounts.pathConstraints;
    out[7] = g_poseCounts.physicsConstraints;
    out[8] = g_poseCounts.events;
}

/**
 * BENCHMARK ONLY — what the batch pool holds, into four u32 slots: slots ever
 * opened, slots this extraction used, and the vertex floats and indices it can
 * take without allocating again. Capacity that stops growing is what says a
 * steady scene stopped reallocating; a wall clock can only suggest it.
 */
EMSCRIPTEN_KEEPALIVE
void spine_probe_storage(std::uint32_t* out) {
    if (!out) return;
    const es::skeletal::BatchList::Capacity held = g_ctx.batches.capacity();
    out[0] = static_cast<std::uint32_t>(held.slots);
    out[1] = static_cast<std::uint32_t>(g_ctx.batches.size());
    out[2] = static_cast<std::uint32_t>(held.vertexFloats);
    out[3] = static_cast<std::uint32_t>(held.indices);
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchCount(int instanceId) {
    extractBatches(instanceId);
    return static_cast<int>(g_ctx.batches.size());
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return 0;
    return static_cast<int>(g_ctx.batches[batchIndex].vertices.size() / es::skeletal::VERTEX_FLOATS);
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

    const es::skeletal::MeshBatch& batch = g_ctx.batches[batchIndex];
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
    return g_ctx.events.count();
}

EMSCRIPTEN_KEEPALIVE
uintptr_t spine_getEventBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.events.values());
}

EMSCRIPTEN_KEEPALIVE
void spine_clearEvents() {
    g_ctx.events.clear();
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventAnimationName(int index) {
    const auto* record = g_ctx.events.strings(index);
    if (!record) return "";
    const char* name = record->animationName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventName(int index) {
    const auto* record = g_ctx.events.strings(index);
    if (!record) return "";
    const char* name = record->eventName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventStringValue(int index) {
    const auto* record = g_ctx.events.strings(index);
    if (!record) return "";
    const char* value = record->stringValue;
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

    std::string& out = g_ctx.strings.raw();
    out = "{";
    for (size_t k = 0; k < sizeof(kinds) / sizeof(kinds[0]); ++k) {
        if (k > 0) out += ',';
        out += '"';
        out += kinds[k].key;
        out += "\":[";
        const int count = es::spine::constraintCount(instance, kinds[k].kind);
        for (int i = 0; i < count; ++i) {
            if (i > 0) out += ',';
            const char* name = es::spine::constraintName(instance, kinds[k].kind, i);
            out += '"';
            out += name ? name : "";
            out += '"';
        }
        out += ']';
    }
    out += '}';
    return out.c_str();
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
    return g_ctx.events.byteLength();
}

}  // extern "C"

#ifdef __EMSCRIPTEN__
// The module is linked as an executable, so it needs an entry point; a native build
// links it into a host that has its own.
int main() {
    return 0;
}
#endif
