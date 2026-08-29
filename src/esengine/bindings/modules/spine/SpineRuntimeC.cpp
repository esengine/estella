// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineRuntimeC.cpp
 * @brief   The SpineRuntime backend for spine-c, the pure-C runtime (3.8 - 4.2).
 *
 * @details One vendored release links at a time; ES_SPINE_VERSION says which, as an
 *          integer so the differences read as the version ranges they are ("region
 *          attachments carried their own atlas pointer before 4.0") instead of a
 *          chain of per-release macros.
 *
 *          4.3 retired this runtime — its C API was regenerated on top of spine-cpp
 *          and shares nothing with these types — so that release has its own backend
 *          rather than another branch in here.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "./SpineRuntime.hpp"

#include <spine/spine.h>
#include <spine/extension.h>

#include <cstdio>
#include <cstring>
#include <vector>

#ifndef ES_SPINE_VERSION
#error "ES_SPINE_VERSION must name the vendored spine-c release (38 / 41 / 42)."
#endif

// =============================================================================
// spine-c Required Callbacks
// =============================================================================
//
// The module never reads a file or creates a texture: the SDK loads atlas pages
// and hands their ids back through setAtlasPageTexture. spine-c still insists the
// hooks exist, so they exist and do nothing.

void _spAtlasPage_createTexture(spAtlasPage* self, const char* path) {
    (void)self;
    (void)path;
}

void _spAtlasPage_disposeTexture(spAtlasPage* self) {
    (void)self;
}

char* _spUtil_readFile(const char* path, int* length) {
    (void)path;
    *length = 0;
    return nullptr;
}

namespace es::spine {

// =============================================================================
// Resources
// =============================================================================

struct Skeleton {
    spAtlas* atlas = nullptr;
    spSkeletonData* data = nullptr;
    spAnimationStateData* stateData = nullptr;

    Skeleton() = default;
    Skeleton(const Skeleton&) = delete;
    Skeleton& operator=(const Skeleton&) = delete;

    // Reverse of construction order: stateData/data reference the atlas.
    ~Skeleton() {
        if (stateData) spAnimationStateData_dispose(stateData);
        if (data) spSkeletonData_dispose(data);
        if (atlas) spAtlas_dispose(atlas);
    }
};

struct Instance {
    spSkeleton* skeleton = nullptr;
    spAnimationState* state = nullptr;

    Instance() = default;
    Instance(const Instance&) = delete;
    Instance& operator=(const Instance&) = delete;

    ~Instance() {
        if (state) spAnimationState_dispose(state);
        if (skeleton) spSkeleton_dispose(skeleton);
    }
};

void destroy(Skeleton* skeleton) { delete skeleton; }
void destroy(Instance* instance) { delete instance; }

namespace {

/// Scratch for one attachment's world vertices — reused across attachments and frames.
std::vector<float> g_worldVertices;

/// spine's own clip machinery, created on first use and kept for the module's life.
spSkeletonClipping* g_clipper = nullptr;

EventSink g_eventSink = nullptr;

spAtlasPage* pageAt(const Skeleton* skeleton, int index) {
    if (!skeleton || index < 0) return nullptr;
    spAtlasPage* page = skeleton->atlas->pages;
    for (int i = 0; i < index && page; ++i) page = page->next;
    return page;
}

#if ES_SPINE_VERSION < 40
// Before 4.0 an attachment pointed straight at its atlas region; the texture id
// the SDK registered lives on that region's page.
uint32_t regionTexture(spRegionAttachment* attachment) {
    auto* region = reinterpret_cast<spAtlasRegion*>(attachment->rendererObject);
    if (!region || !region->page) return 0;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(region->page->rendererObject));
}

uint32_t meshTexture(spMeshAttachment* attachment) {
    auto* region = reinterpret_cast<spAtlasRegion*>(attachment->rendererObject);
    if (!region || !region->page) return 0;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(region->page->rendererObject));
}
#else
uint32_t regionTexture(spRegionAttachment* attachment) {
    if (!attachment->region) return 0;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(attachment->region->rendererObject));
}

uint32_t meshTexture(spMeshAttachment* attachment) {
    if (!attachment->region) return 0;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(attachment->region->rendererObject));
}

/// Whether an attachment's page stores premultiplied artwork — the one fact that
/// decides both its blend code and whether its tint carries its alpha
/// (SpineRuntime.hpp). Atlases before 4.0 have no `pma` flag at all.
bool pagePremultiplied(spAtlasRegion* region) {
    return region && region->page && region->page->pma;
}
#endif

int blendModeOf(spSlot* slot) {
    switch (slot->data->blendMode) {
        case SP_BLEND_MODE_ADDITIVE: return 1;
        case SP_BLEND_MODE_MULTIPLY: return 2;
        case SP_BLEND_MODE_SCREEN: return 3;
        default: return 0;
    }
}

void eventListener(spAnimationState* state, spEventType type, spTrackEntry* entry, spEvent* event) {
    (void)state;
    if (!g_eventSink) return;

    Event out;
    out.kind = static_cast<EventKind>(static_cast<int>(type));
    out.track = entry ? entry->trackIndex : 0;
    out.animation = (entry && entry->animation) ? entry->animation->name : nullptr;
    if (type == SP_ANIMATION_EVENT && event) {
        out.floatValue = event->floatValue;
        out.intValue = event->intValue;
        out.name = event->data->name;
        out.stringValue = event->stringValue;
    }
    g_eventSink(out);
}

/** BENCHMARK ONLY — what {@link poseStage} installs while it applies, so events
 *  are counted without the module's own sink being on the measurement. */
std::uint32_t g_probeEvents = 0;
void countingListener(spAnimationState*, spEventType, spTrackEntry*, spEvent*) {
    ++g_probeEvents;
}

}  // namespace

Skeleton* loadSkeleton(const void* skeletonData, int length,
                       const char* atlasText, int atlasLength,
                       bool binary, std::string& error) {
    auto skeleton = std::make_unique<Skeleton>();

    skeleton->atlas = spAtlas_create(atlasText, atlasLength, "", nullptr);
    if (!skeleton->atlas || !skeleton->atlas->pages) {
        error = "Failed to create atlas (invalid atlas text or no pages)";
        return nullptr;
    }

    if (binary) {
        spSkeletonBinary* reader = spSkeletonBinary_create(skeleton->atlas);
        if (!reader) {
            error = "Failed to create skeleton binary reader";
            return nullptr;
        }
        reader->scale = 1.0f;
        skeleton->data = spSkeletonBinary_readSkeletonData(
            reader, static_cast<const unsigned char*>(skeletonData), length);
        if (!skeleton->data && reader->error) error = reader->error;
        spSkeletonBinary_dispose(reader);
    } else {
        spSkeletonJson* reader = spSkeletonJson_create(skeleton->atlas);
        if (!reader) {
            error = "Failed to create skeleton json reader";
            return nullptr;
        }
        reader->scale = 1.0f;
        skeleton->data = spSkeletonJson_readSkeletonData(
            reader, static_cast<const char*>(skeletonData));
        if (!skeleton->data && reader->error) error = reader->error;
        spSkeletonJson_dispose(reader);
    }

    if (!skeleton->data) return nullptr;

    skeleton->stateData = spAnimationStateData_create(skeleton->data);
    skeleton->stateData->defaultMix = 0.2f;
    return skeleton.release();
}

int atlasPageCount(const Skeleton* skeleton) {
    if (!skeleton) return 0;
    int count = 0;
    for (spAtlasPage* page = skeleton->atlas->pages; page; page = page->next) ++count;
    return count;
}

const char* atlasPageName(const Skeleton* skeleton, int page) {
    spAtlasPage* p = pageAt(skeleton, page);
    return p ? p->name : nullptr;
}

void setAtlasPageTexture(Skeleton* skeleton, int page, uint32_t texture, int width, int height) {
    spAtlasPage* p = pageAt(skeleton, page);
    if (!p) return;

    void* handle = reinterpret_cast<void*>(static_cast<uintptr_t>(texture));
    p->rendererObject = handle;
    p->width = width;
    p->height = height;

#if ES_SPINE_VERSION >= 40
    // 4.0 moved the renderer object onto the region; attachments read it there.
    for (spAtlasRegion* region = skeleton->atlas->regions; region; region = region->next) {
        if (region->page == p) region->super.rendererObject = handle;
    }
#endif
}

void setDefaultMix(Skeleton* skeleton, float seconds) {
    if (skeleton && skeleton->stateData) skeleton->stateData->defaultMix = seconds;
}

void setMixDuration(Skeleton* skeleton, const char* from, const char* to, float seconds) {
    if (!skeleton || !skeleton->stateData) return;
    spAnimation* a = spSkeletonData_findAnimation(skeleton->data, from);
    spAnimation* b = spSkeletonData_findAnimation(skeleton->data, to);
    if (a && b) spAnimationStateData_setMix(skeleton->stateData, a, b, seconds);
}

// =============================================================================
// Instances
// =============================================================================

Instance* createInstance(Skeleton* skeleton) {
    if (!skeleton) return nullptr;

    auto instance = std::make_unique<Instance>();
    instance->skeleton = spSkeleton_create(skeleton->data);
    instance->state = spAnimationState_create(skeleton->stateData);
    if (!instance->skeleton || !instance->state) return nullptr;

    spSkeleton_setToSetupPose(instance->skeleton);
#if ES_SPINE_VERSION >= 42
    spSkeleton_updateWorldTransform(instance->skeleton, SP_PHYSICS_UPDATE);
#else
    spSkeleton_updateWorldTransform(instance->skeleton);
#endif
    return instance.release();
}

void update(Instance* instance, float dt) {
    if (!instance) return;
    spAnimationState_update(instance->state, dt);
    spAnimationState_apply(instance->state, instance->skeleton);
#if ES_SPINE_VERSION >= 42
    // 4.2 skeletons carry physics constraints, which advance with the clock.
    spSkeleton_update(instance->skeleton, dt);
    spSkeleton_updateWorldTransform(instance->skeleton, SP_PHYSICS_UPDATE);
#else
    spSkeleton_updateWorldTransform(instance->skeleton);
#endif
}

namespace {

/// The entries one track applies this frame: the current one and everything it
/// is still mixing out of.
void countTrack(spTrackEntry* entry, PoseCounts& counts) {
    for (; entry; entry = entry->mixingFrom) {
        ++counts.entries;
        if (!entry->animation) continue;
#if ES_SPINE_VERSION >= 41
        // 4.1 moved the timeline list into an array type; 3.8 counts them itself.
        counts.timelines += static_cast<std::uint32_t>(entry->animation->timelines->size);
#else
        counts.timelines += static_cast<std::uint32_t>(entry->animation->timelinesCount);
#endif
    }
}

}  // namespace

bool poseStage(Instance* instance, float dt, int stage, PoseCounts* counts) {
    if (!instance) return false;

    if (counts) {
        *counts = PoseCounts{};
        for (int i = 0; i < instance->state->tracksCount; ++i) {
            spTrackEntry* entry = instance->state->tracks[i];
            if (!entry) continue;
            ++counts->tracks;
            countTrack(entry, *counts);
        }
        const spSkeleton* skeleton = instance->skeleton;
        counts->bones = static_cast<std::uint32_t>(skeleton->bonesCount);
        counts->ikConstraints = static_cast<std::uint32_t>(skeleton->ikConstraintsCount);
        counts->transformConstraints = static_cast<std::uint32_t>(skeleton->transformConstraintsCount);
        counts->pathConstraints = static_cast<std::uint32_t>(skeleton->pathConstraintsCount);
#if ES_SPINE_VERSION >= 42
        counts->physicsConstraints = static_cast<std::uint32_t>(skeleton->physicsConstraintsCount);
#endif
    }

    if (stage >= POSE_ADVANCE) spAnimationState_update(instance->state, dt);
    if (stage >= POSE_APPLY) {
        spAnimationStateListener installed = instance->state->listener;
        instance->state->listener = countingListener;
        g_probeEvents = 0;
        spAnimationState_apply(instance->state, instance->skeleton);
        instance->state->listener = installed;
        if (counts) counts->events = g_probeEvents;
    }
    if (stage >= POSE_WORLD) {
#if ES_SPINE_VERSION >= 42
        spSkeleton_update(instance->skeleton, dt);
        spSkeleton_updateWorldTransform(instance->skeleton, SP_PHYSICS_UPDATE);
#else
        spSkeleton_updateWorldTransform(instance->skeleton);
#endif
    }
    return true;
}

bool playAnimation(Instance* instance, const char* animation, bool loop, int track) {
    if (!instance) return false;
    // Resolved HERE: spine-c builds a track entry around a null animation and
    // hands it back, so a non-null entry says nothing about the name — and
    // posing that entry reads address zero, which on wasm neither crashes nor draws.
    if (!spSkeletonData_findAnimation(instance->skeleton->data, animation)) return false;
    return spAnimationState_setAnimationByName(instance->state, track, animation, loop) != nullptr;
}

bool addAnimation(Instance* instance, const char* animation, bool loop, float delay, int track) {
    if (!instance) return false;
    if (!spSkeletonData_findAnimation(instance->skeleton->data, animation)) return false;
    return spAnimationState_addAnimationByName(instance->state, track, animation, loop, delay) != nullptr;
}

void setSkin(Instance* instance, const char* skin) {
    if (!instance) return;
    if (!skin || skin[0] == '\0') {
        spSkeleton_setSkin(instance->skeleton, nullptr);
    } else {
        spSkeleton_setSkinByName(instance->skeleton, skin);
    }
    spSkeleton_setSlotsToSetupPose(instance->skeleton);
}

void setTrackAlpha(Instance* instance, int track, float alpha) {
    if (!instance) return;
    spTrackEntry* entry = spAnimationState_getCurrent(instance->state, track);
    if (entry) entry->alpha = alpha;
}

void setEventSink(EventSink sink) {
    g_eventSink = sink;
}

void enableEvents(Instance* instance) {
    if (instance) instance->state->listener = eventListener;
}

// =============================================================================
// Queries
// =============================================================================

int animationCount(const Instance* instance) {
    return instance ? instance->skeleton->data->animationsCount : 0;
}

const char* animationName(const Instance* instance, int index) {
    if (!instance) return nullptr;
    spSkeletonData* data = instance->skeleton->data;
    if (index < 0 || index >= data->animationsCount) return nullptr;
    return data->animations[index]->name;
}

int skinCount(const Instance* instance) {
    return instance ? instance->skeleton->data->skinsCount : 0;
}

const char* skinName(const Instance* instance, int index) {
    if (!instance) return nullptr;
    spSkeletonData* data = instance->skeleton->data;
    if (index < 0 || index >= data->skinsCount) return nullptr;
    return data->skins[index]->name;
}

bool bonePosition(const Instance* instance, const char* bone, float* x, float* y) {
    if (!instance) return false;
    spBone* b = spSkeleton_findBone(instance->skeleton, bone);
    if (!b) return false;
    *x = b->worldX;
    *y = b->worldY;
    return true;
}

bool boneRotation(const Instance* instance, const char* bone, float* degrees) {
    if (!instance) return false;
    spBone* b = spSkeleton_findBone(instance->skeleton, bone);
    if (!b) return false;
    *degrees = spBone_getWorldRotationX(b);
    return true;
}

void bounds(const Instance* instance, float* x, float* y, float* width, float* height) {
    *x = *y = *width = *height = 0.0f;
    if (!instance) return;

    spSkeleton* skeleton = instance->skeleton;
    float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
    bool any = false;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot->attachment) continue;

        int vertexCount = 0;
        if (slot->attachment->type == SP_ATTACHMENT_REGION) {
            auto* region = reinterpret_cast<spRegionAttachment*>(slot->attachment);
            g_worldVertices.resize(8);
#if ES_SPINE_VERSION < 40
            spRegionAttachment_computeWorldVertices(region, slot->bone, g_worldVertices.data(), 0, 2);
#else
            spRegionAttachment_computeWorldVertices(region, slot, g_worldVertices.data(), 0, 2);
#endif
            vertexCount = 4;
        } else if (slot->attachment->type == SP_ATTACHMENT_MESH) {
            auto* mesh = reinterpret_cast<spMeshAttachment*>(slot->attachment);
            const int length = SUPER(mesh)->worldVerticesLength;
            g_worldVertices.resize(length);
            spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0, length,
                                                    g_worldVertices.data(), 0, 2);
            vertexCount = length / 2;
        }

        for (int j = 0; j < vertexCount; ++j) {
            const float vx = g_worldVertices[j * 2];
            const float vy = g_worldVertices[j * 2 + 1];
            if (vx < minX) minX = vx;
            if (vx > maxX) maxX = vx;
            if (vy < minY) minY = vy;
            if (vy > maxY) maxY = vy;
            any = true;
        }
    }

    if (!any) return;
    *x = minX;
    *y = minY;
    *width = maxX - minX;
    *height = maxY - minY;
}

int constraintCount(const Instance* instance, ConstraintKind kind) {
    if (!instance) return 0;
    switch (kind) {
        case ConstraintKind::Ik: return instance->skeleton->ikConstraintsCount;
        case ConstraintKind::Transform: return instance->skeleton->transformConstraintsCount;
        case ConstraintKind::Path: return instance->skeleton->pathConstraintsCount;
    }
    return 0;
}

const char* constraintName(const Instance* instance, ConstraintKind kind, int index) {
    if (!instance || index < 0 || index >= constraintCount(instance, kind)) return nullptr;
    switch (kind) {
        case ConstraintKind::Ik: return instance->skeleton->ikConstraints[index]->data->name;
        case ConstraintKind::Transform: return instance->skeleton->transformConstraints[index]->data->name;
        case ConstraintKind::Path: return instance->skeleton->pathConstraints[index]->data->name;
    }
    return nullptr;
}

bool transformMix(const Instance* instance, const char* name, TransformMix* out) {
    if (!instance) return false;
    auto* c = spSkeleton_findTransformConstraint(instance->skeleton, name);
    if (!c) return false;
#if ES_SPINE_VERSION < 40
    // One mix per channel before 4.0; report it on both axes so the SDK sees one shape.
    out->rotate = c->rotateMix;
    out->x = out->y = c->translateMix;
    out->scaleX = out->scaleY = c->scaleMix;
    out->shearY = c->shearMix;
#else
    out->rotate = c->mixRotate;
    out->x = c->mixX;
    out->y = c->mixY;
    out->scaleX = c->mixScaleX;
    out->scaleY = c->mixScaleY;
    out->shearY = c->mixShearY;
#endif
    return true;
}

bool setTransformMix(Instance* instance, const char* name, const TransformMix& mix) {
    if (!instance) return false;
    auto* c = spSkeleton_findTransformConstraint(instance->skeleton, name);
    if (!c) return false;
#if ES_SPINE_VERSION < 40
    c->rotateMix = mix.rotate;
    c->translateMix = (mix.x + mix.y) * 0.5f;
    c->scaleMix = (mix.scaleX + mix.scaleY) * 0.5f;
    c->shearMix = mix.shearY;
#else
    c->mixRotate = mix.rotate;
    c->mixX = mix.x;
    c->mixY = mix.y;
    c->mixScaleX = mix.scaleX;
    c->mixScaleY = mix.scaleY;
    c->mixShearY = mix.shearY;
#endif
    return true;
}

bool pathMix(const Instance* instance, const char* name, PathMix* out) {
    if (!instance) return false;
    auto* c = spSkeleton_findPathConstraint(instance->skeleton, name);
    if (!c) return false;
    out->position = c->position;
    out->spacing = c->spacing;
#if ES_SPINE_VERSION < 40
    out->rotate = c->rotateMix;
    out->x = out->y = c->translateMix;
#else
    out->rotate = c->mixRotate;
    out->x = c->mixX;
    out->y = c->mixY;
#endif
    return true;
}

bool setPathMix(Instance* instance, const char* name, const PathMix& mix) {
    if (!instance) return false;
    auto* c = spSkeleton_findPathConstraint(instance->skeleton, name);
    if (!c) return false;
    c->position = mix.position;
    c->spacing = mix.spacing;
#if ES_SPINE_VERSION < 40
    c->rotateMix = mix.rotate;
    c->translateMix = (mix.x + mix.y) * 0.5f;
#else
    c->mixRotate = mix.rotate;
    c->mixX = mix.x;
    c->mixY = mix.y;
#endif
    return true;
}

// =============================================================================
// Posing
// =============================================================================

bool setAttachment(Instance* instance, const char* slot, const char* attachment) {
    if (!instance) return false;
    const char* name = (attachment && attachment[0] != '\0') ? attachment : nullptr;
    return spSkeleton_setAttachment(instance->skeleton, slot, name) != 0;
}

bool setIkTarget(Instance* instance, const char* constraint, float x, float y, float mix) {
    if (!instance) return false;
    spIkConstraint* c = spSkeleton_findIkConstraint(instance->skeleton, constraint);
    if (!c) return false;
    c->target->x = x;
    c->target->y = y;
    c->mix = mix;
    return true;
}

bool setSlotColor(Instance* instance, const char* slot, float r, float g, float b, float a) {
    if (!instance) return false;
    spSlot* s = spSkeleton_findSlot(instance->skeleton, slot);
    if (!s) return false;
    s->color.r = r;
    s->color.g = g;
    s->color.b = b;
    s->color.a = a;
    return true;
}

bool setSkeletonColor(Instance* instance, float r, float g, float b, float a) {
    if (!instance) return false;
    instance->skeleton->color.r = r;
    instance->skeleton->color.g = g;
    instance->skeleton->color.b = b;
    instance->skeleton->color.a = a;
    return true;
}

// =============================================================================
// Geometry
// =============================================================================

namespace {

/**
 * What the open clip region is, for the two questions that can be answered
 * without cutting: where it is, and whether it is a single convex piece.
 *
 * Captured at clipStart because `clipEnd` clears the polygon it is read from.
 */
struct ClipRegion {
    float minX, minY, maxX, maxY;
    /// Edges across the pieces, so a charge can be priced where it is made.
    std::uint32_t edges;
    /// The decomposition came back as one piece, so "every vertex is inside it"
    /// means the whole triangle is. A concave region decomposes into several and
    /// a triangle can span two of them while being inside neither.
    bool convex;
};
ClipRegion g_clipRegion{};

void captureClipRegion() {
    const spFloatArray* polygon = g_clipper->clippingPolygon;
    g_clipRegion = ClipRegion{};
    if (!polygon || polygon->size < 2) return;
    g_clipRegion.minX = g_clipRegion.maxX = polygon->items[0];
    g_clipRegion.minY = g_clipRegion.maxY = polygon->items[1];
    for (int i = 2; i < polygon->size; i += 2) {
        const float x = polygon->items[i];
        const float y = polygon->items[i + 1];
        g_clipRegion.minX = x < g_clipRegion.minX ? x : g_clipRegion.minX;
        g_clipRegion.maxX = x > g_clipRegion.maxX ? x : g_clipRegion.maxX;
        g_clipRegion.minY = y < g_clipRegion.minY ? y : g_clipRegion.minY;
        g_clipRegion.maxY = y > g_clipRegion.maxY ? y : g_clipRegion.maxY;
    }
    g_clipRegion.convex = g_clipper->clippingPolygons
        && g_clipper->clippingPolygons->size == 1;
    if (g_clipper->clippingPolygons) {
        for (int p = 0; p < g_clipper->clippingPolygons->size; ++p) {
            g_clipRegion.edges +=
                static_cast<std::uint32_t>(g_clipper->clippingPolygons->items[p]->size / 2);
        }
    }
}

/// Bounds that cannot meet the region's: nothing of this attachment survives.
bool outsideClipBounds(const float* positions, int vertexCount) {
    float minX = positions[0], maxX = positions[0];
    float minY = positions[1], maxY = positions[1];
    for (int i = 2; i < vertexCount * 2; i += 2) {
        const float x = positions[i];
        const float y = positions[i + 1];
        minX = x < minX ? x : minX;
        maxX = x > maxX ? x : maxX;
        minY = y < minY ? y : minY;
        maxY = y > maxY ? y : maxY;
    }
    return maxX < g_clipRegion.minX || minX > g_clipRegion.maxX
        || maxY < g_clipRegion.minY || minY > g_clipRegion.maxY;
}

/**
 * Every vertex strictly inside the single convex piece, by the SAME predicate
 * the clipper uses, so a vertex on an edge falls through to the cut. One piece
 * is a cost requirement, not a correctness one: a decomposed region's pieces
 * have boundaries geometry crosses, so this test would run and fail.
 */
bool insideConvexClip(const float* positions, int vertexCount) {
    if (!g_clipRegion.convex) return false;
    const spFloatArray* polygon = g_clipper->clippingPolygons->items[0];
    const float* edges = polygon->items;
    for (int e = 0; e <= polygon->size - 4; e += 2) {
        const float deltaX = edges[e] - edges[e + 2];
        const float deltaY = edges[e + 1] - edges[e + 3];
        const float edgeX2 = edges[e + 2], edgeY2 = edges[e + 3];
        for (int i = 0; i < vertexCount * 2; i += 2) {
            if (deltaX * (positions[i + 1] - edgeY2) - deltaY * (positions[i] - edgeX2) <= 0) {
                return false;
            }
        }
    }
    return true;
}

namespace {

/**
 * spine's own `_makeClockwise`, which is static there, transcribed so the ladder
 * below can stop before it. The full depth is held to the shipped clipStart's
 * result, which is what says this stayed a transcription.
 */
void makeClockwise(spFloatArray* polygon) {
    float* vertices = polygon->items;
    const int length = polygon->size;
    float area = vertices[length - 2] * vertices[1] - vertices[0] * vertices[length - 1];
    for (int i = 0, n = length - 3; i < n; i += 2) {
        const float p1x = vertices[i], p1y = vertices[i + 1];
        const float p2x = vertices[i + 2], p2y = vertices[i + 3];
        area += p1x * p2y - p2x * p1y;
    }
    if (area < 0) return;
    for (int i = 0, lastX = length - 2, n = length >> 1; i < n; i += 2) {
        const float x = vertices[i], y = vertices[i + 1];
        const int other = lastX - i;
        vertices[i] = vertices[other];
        vertices[i + 1] = vertices[other + 1];
        vertices[other] = x;
        vertices[other + 1] = y;
    }
}

/// The first clip region in draw order — the one every fixture here has one of.
spSlot* firstClipSlot(spSkeleton* skeleton, spClippingAttachment** clip) {
    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot || !slot->attachment) continue;
        if (slot->attachment->type != SP_ATTACHMENT_CLIPPING) continue;
        *clip = reinterpret_cast<spClippingAttachment*>(slot->attachment);
        return slot;
    }
    return nullptr;
}

/// One convex piece this module owns, for the region that is its own only piece.
spArrayFloatArray* g_convexPolygons = nullptr;

/**
 * Convex beyond doubt, on THIS frame's world vertices — a deformed polygon is a
 * different shape every frame. Conservative: a false negative costs only the ear
 * clip this skips, a false positive changes what is drawn, so a cross product
 * with no trustworthy sign or directions that turn twice both decline.
 */
bool isDefinitelyConvex(const spFloatArray* polygon) {
    const int count = polygon->size / 2;
    if (count < 3) return false;
    const float* v = polygon->items;

    float minX = v[0], maxX = v[0], minY = v[1], maxY = v[1];
    for (int i = 2; i < polygon->size; i += 2) {
        minX = v[i] < minX ? v[i] : minX;
        maxX = v[i] > maxX ? v[i] : maxX;
        minY = v[i + 1] < minY ? v[i + 1] : minY;
        maxY = v[i + 1] > maxY ? v[i + 1] : maxY;
    }
    const float span = (maxX - minX) > (maxY - minY) ? (maxX - minX) : (maxY - minY);
    if (!(span > 0.0f)) return false;
    const float crossEpsilon = span * span * 1e-7f;

    int sign = 0;
    int xTurns = 0;
    int yTurns = 0;
    float previousDx = 0.0f;
    float previousDy = 0.0f;
    for (int i = 0; i < count; ++i) {
        const int a = i * 2;
        const int b = ((i + 1) % count) * 2;
        const int c = ((i + 2) % count) * 2;
        const float dx = v[b] - v[a], dy = v[b + 1] - v[a + 1];
        const float ex = v[c] - v[b], ey = v[c + 1] - v[b + 1];
        const float cross = dx * ey - dy * ex;
        if (cross > -crossEpsilon && cross < crossEpsilon) return false;
        const int turn = cross > 0.0f ? 1 : -1;
        if (sign == 0) sign = turn;
        else if (turn != sign) return false;

        // A simple convex polygon's edge directions cross each axis exactly
        // twice; a star keeps a consistent turn but crosses them four times.
        if (i > 0) {
            if ((dx < 0.0f) != (previousDx < 0.0f)) ++xTurns;
            if ((dy < 0.0f) != (previousDy < 0.0f)) ++yTurns;
        }
        previousDx = dx;
        previousDy = dy;
    }
    if ((v[0] - v[(count - 1) * 2] < 0.0f) != (previousDx < 0.0f)) ++xTurns;
    if ((v[1] - v[(count - 1) * 2 + 1] < 0.0f) != (previousDy < 0.0f)) ++yTurns;
    return xTurns <= 2 && yTurns <= 2;
}

/**
 * The polygon as the region's only piece, in the rotation the decomposition
 * would have produced: the ear clipper takes vertex 0 first, so the fan begins
 * at the LAST vertex. Starting elsewhere clips to the same area but fanned from
 * another corner — this is what keeps the output identical, not equivalent.
 */
spArrayFloatArray* asSingleConvexPiece(spFloatArray* polygon) {
    if (!g_convexPolygons) {
        g_convexPolygons = spArrayFloatArray_create(1);
        spArrayFloatArray_add(g_convexPolygons, spFloatArray_create(16));
    }
    spFloatArray* piece = g_convexPolygons->items[0];
    spFloatArray_clear(piece);
    const int last = polygon->size - 2;
    spFloatArray_addAllValues(piece, polygon->items, last, 2);
    spFloatArray_addAllValues(piece, polygon->items, 0, last);
    spFloatArray_add(piece, piece->items[0]);
    spFloatArray_add(piece, piece->items[1]);
    g_convexPolygons->size = 1;
    return g_convexPolygons;
}

/**
 * spine's `clipStart`, with the proof in front of the derivation. Everything
 * before the branch is what it does; the branch is that a polygon already known
 * convex needs neither the ear clip nor the decomposition to say so.
 */
template <bool COUNT>
int openClipRegion(spSlot* slot, spClippingAttachment* clip, ProbeCounts* counts) {
    if (g_clipper->clipAttachment) return 0;
    g_clipper->clipAttachment = clip;

    const int length = clip->super.worldVerticesLength;
    float* vertices = spFloatArray_setSize(g_clipper->clippingPolygon, length)->items;
    spVertexAttachment_computeWorldVertices(&clip->super, slot, 0, length, vertices, 0, 2);
    makeClockwise(g_clipper->clippingPolygon);

    if (isDefinitelyConvex(g_clipper->clippingPolygon)) {
        if constexpr (COUNT) counts->clipConvexBypasses++;
        g_clipper->clippingPolygons = asSingleConvexPiece(g_clipper->clippingPolygon);
        return 1;
    }

    if constexpr (COUNT) counts->clipDecompositions++;
    g_clipper->clippingPolygons = spTriangulator_decompose(
        g_clipper->triangulator, g_clipper->clippingPolygon,
        spTriangulator_triangulate(g_clipper->triangulator, g_clipper->clippingPolygon));
    for (int i = 0; i < g_clipper->clippingPolygons->size; ++i) {
        spFloatArray* piece = g_clipper->clippingPolygons->items[i];
        makeClockwise(piece);
        spFloatArray_add(piece, piece->items[0]);
        spFloatArray_add(piece, piece->items[1]);
    }
    return g_clipper->clippingPolygons->size;
}

}  // namespace

/**
 * Hand one attachment's triangles to the sink, clipped against the open clip
 * region when there is one. Clipping replaces the triangle set with the polygon
 * intersection RE-TRIANGULATED, which can hand back more vertices than it was
 * given — a triangle cut by a polygon is a polygon, and it comes back as fans.
 */
template <int STAGE, bool COUNT>
void emit(TriangleSink& sink, bool clipping,
          float* positions, int vertexCount, float* uvs,
          unsigned short* triangles, int triangleCount,
          uint32_t texture, int blendMode, const float rgba[4],
          ProbeCounts* counts) {
    float* outPositions = positions;
    float* outUVs = uvs;
    unsigned short* outTriangles = triangles;
    int outVertices = vertexCount;
    int outTriangleCount = triangleCount;

    if (STAGE >= STAGE_CLIP && clipping && spSkeletonClipping_isClipping(g_clipper)) {
        // Neither changes what is drawn. The first answers "nothing of this
        // survives" without cutting; the second answers "all of it does", and
        // keeps the attachment's own topology instead of a per-triangle rebuild.
        if constexpr (COUNT) {
            counts->clipCandidateTriangles += static_cast<std::uint32_t>(triangleCount / 3);
        }
        if (outsideClipBounds(positions, vertexCount)) {
            if constexpr (COUNT) {
                counts->clipBoundsRejects++;
                counts->clipRejectedTriangles += static_cast<std::uint32_t>(triangleCount / 3);
            }
            return;
        }
        if (insideConvexClip(positions, vertexCount)) {
            if constexpr (COUNT) {
                counts->clipInsideAccepts++;
                counts->clipBypassedTriangles += static_cast<std::uint32_t>(triangleCount / 3);
            }
        } else {
            spSkeletonClipping_clipTriangles(g_clipper, positions, vertexCount * 2,
                                             triangles, triangleCount, uvs, 2);
            outPositions = g_clipper->clippedVertices->items;
            outVertices = g_clipper->clippedVertices->size / 2;
            outUVs = g_clipper->clippedUVs->items;
            outTriangles = g_clipper->clippedTriangles->items;
            outTriangleCount = g_clipper->clippedTriangles->size;
            if constexpr (COUNT) {
                counts->clippedEmits++;
                counts->clipInputTriangles += static_cast<std::uint32_t>(triangleCount / 3);
                counts->clipOutputTriangles += static_cast<std::uint32_t>(outTriangleCount / 3);
                counts->clipInputVertices += static_cast<std::uint32_t>(vertexCount);
                counts->clipOutputVertices += static_cast<std::uint32_t>(outVertices);
                counts->clipEdgeWork +=
                    static_cast<std::uint32_t>(triangleCount / 3) * g_clipRegion.edges;
            }
        }
    }

    if (outVertices == 0 || outTriangleCount == 0) return;
    if constexpr (COUNT) {
        counts->emits++;
        counts->verticesEmitted += static_cast<std::uint32_t>(outVertices);
        counts->indicesEmitted += static_cast<std::uint32_t>(outTriangleCount);
    }
    if constexpr (STAGE < STAGE_EMIT) return;
    sink.emit(outPositions, outUVs, outVertices, outTriangles, outTriangleCount,
              texture, blendMode, rgba);
}

}  // namespace

/**
 * The walk, once. `STAGE` and `COUNT` are compile-time: the shipped `render`
 * instantiates it with the full stage and no counting, so every stage check and
 * every counter below is gone before the module is linked.
 */
template <int STAGE, bool COUNT>
void renderImpl(Instance* instance, TriangleSink& sink, bool clipping, ProbeCounts* counts) {
    if (!instance) return;
    if (!g_clipper) g_clipper = spSkeletonClipping_create();
    if constexpr (STAGE < STAGE_TRAVERSE) return;

    spSkeleton* skeleton = instance->skeleton;
    const spColor& skeletonColor = skeleton->color;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        if constexpr (COUNT) counts->slots++;
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot) continue;

        spAttachment* attachment = slot->attachment;

        // A clipping attachment opens a region that runs until its end slot; it
        // draws nothing itself.
        if (attachment && attachment->type == SP_ATTACHMENT_CLIPPING) {
            if constexpr (COUNT) counts->clipStarts++;
            if (clipping && STAGE >= STAGE_CLIP_START) {
                auto* clip = reinterpret_cast<spClippingAttachment*>(attachment);
                const int pieces = openClipRegion<COUNT>(slot, clip, counts);
                captureClipRegion();
                if constexpr (COUNT) {
                    counts->clipPolygons += static_cast<std::uint32_t>(pieces);
                    counts->clipPolygonVertices +=
                        static_cast<std::uint32_t>(clip->super.worldVerticesLength / 2);
                    for (int p = 0; p < g_clipper->clippingPolygons->size; ++p) {
                        counts->clipPolygonEdges +=
                            static_cast<std::uint32_t>(g_clipper->clippingPolygons->items[p]->size / 2);
                    }
                }
            }
            continue;
        }

        bool visible = attachment != nullptr;
#if ES_SPINE_VERSION >= 42
        if (visible && !slot->data->visible) visible = false;
#endif

        if (visible) {
            const spColor& slotColor = slot->color;
            const int blendMode = blendModeOf(slot);

            if (attachment->type == SP_ATTACHMENT_REGION) {
                if constexpr (COUNT) counts->regionAttachments++;
                // Nothing below this is what a traversal costs.
                if constexpr (STAGE < STAGE_VERTICES) continue;
                auto* region = reinterpret_cast<spRegionAttachment*>(attachment);
                g_worldVertices.resize(8);
#if ES_SPINE_VERSION < 40
                spRegionAttachment_computeWorldVertices(region, slot->bone,
                                                        g_worldVertices.data(), 0, 2);
                const bool pma = false;  // no page carries a pma flag before 4.0
#else
                // Applies the attachment's SEQUENCE, if it has one — which swaps the
                // region this attachment points at for the frame the slot is on, and
                // with it the page, the uvs and the renderer object. So everything
                // that identifies the artwork must be read AFTER this call: a
                // sequence whose frames sit on different atlas pages (an effect
                // flipbook usually does) otherwise draws the new frame's uvs against
                // the previous frame's texture, and the effect samples empty space.
                spRegionAttachment_computeWorldVertices(region, slot,
                                                        g_worldVertices.data(), 0, 2);
                const bool pma = pagePremultiplied(reinterpret_cast<spAtlasRegion*>(region->region));
#endif
                const uint32_t texture = regionTexture(region);
                if (texture) {
                    const spColor& attachmentColor = region->color;
                    float rgba[4] = {
                        skeletonColor.r * slotColor.r * attachmentColor.r,
                        skeletonColor.g * slotColor.g * attachmentColor.g,
                        skeletonColor.b * slotColor.b * attachmentColor.b,
                        skeletonColor.a * slotColor.a * attachmentColor.a,
                    };
                    premultiplyTint(rgba, pma);

                    if constexpr (COUNT) counts->verticesGenerated += 4;
                    static unsigned short quad[6] = {0, 1, 2, 2, 3, 0};
                    emit<STAGE, COUNT>(sink, clipping, g_worldVertices.data(), 4, region->uvs,
                                       quad, 6, texture, blendForPage(blendMode, pma), rgba,
                                       counts);
                }
            } else if (attachment->type == SP_ATTACHMENT_MESH) {
                if constexpr (COUNT) counts->meshAttachments++;
                if constexpr (STAGE < STAGE_VERTICES) continue;
                auto* mesh = reinterpret_cast<spMeshAttachment*>(attachment);
                const int length = SUPER(mesh)->worldVerticesLength;
                g_worldVertices.resize(length);
                // Applies this attachment's SEQUENCE — see the region branch above:
                // the texture, the region and the uvs are only settled once this has
                // run, so none of them may be read before it.
                spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0, length,
                                                        g_worldVertices.data(), 0, 2);
#if ES_SPINE_VERSION < 40
                const bool pma = false;  // no page carries a pma flag before 4.0
#else
                const bool pma = pagePremultiplied(reinterpret_cast<spAtlasRegion*>(mesh->region));
#endif
                const uint32_t texture = meshTexture(mesh);
                if (texture) {
                    const spColor& attachmentColor = mesh->color;
                    float rgba[4] = {
                        skeletonColor.r * slotColor.r * attachmentColor.r,
                        skeletonColor.g * slotColor.g * attachmentColor.g,
                        skeletonColor.b * slotColor.b * attachmentColor.b,
                        skeletonColor.a * slotColor.a * attachmentColor.a,
                    };
                    premultiplyTint(rgba, pma);

                    if constexpr (COUNT) counts->verticesGenerated += length / 2;
                    emit<STAGE, COUNT>(sink, clipping, g_worldVertices.data(), length / 2,
                                       mesh->uvs, mesh->triangles, mesh->trianglesCount,
                                       texture, blendForPage(blendMode, pma), rgba, counts);
                }
            }
        }

        // Closes the region when this slot is the clip's end slot; a cheap no-op
        // otherwise, which is why every non-clip slot passes through here.
        if (clipping && STAGE >= STAGE_CLIP_START) spSkeletonClipping_clipEnd(g_clipper, slot);
    }

    if (clipping && STAGE >= STAGE_CLIP_START) spSkeletonClipping_clipEnd2(g_clipper);
}

bool clipStorage(ClipStorage* out) {
    if (!out || !g_clipper) return false;
    out->polygon = static_cast<std::uint32_t>(g_clipper->clippingPolygon->capacity);
    out->output = static_cast<std::uint32_t>(g_clipper->clipOutput->capacity);
    out->vertices = static_cast<std::uint32_t>(g_clipper->clippedVertices->capacity);
    out->uvs = static_cast<std::uint32_t>(g_clipper->clippedUVs->capacity);
    out->triangles = static_cast<std::uint32_t>(g_clipper->clippedTriangles->capacity);
    out->scratch = static_cast<std::uint32_t>(g_clipper->scratch->capacity);
    return true;
}

void render(Instance* instance, TriangleSink& sink, bool clipping) {
    renderImpl<STAGE_EMIT, false>(instance, sink, clipping, nullptr);
}


namespace {

bool openToStage(Instance* instance, int stage, ClipStartCounts* counts) {
    spClippingAttachment* clip = nullptr;
    spSlot* slot = firstClipSlot(instance->skeleton, &clip);
    if (!slot) return false;

    const int length = clip->super.worldVerticesLength;
    counts->rawVertices = static_cast<std::uint32_t>(length / 2);
    float* vertices = spFloatArray_setSize(g_clipper->clippingPolygon, length)->items;
    if (stage < CLIP_START_WORLD) return true;

    g_clipper->clipAttachment = clip;
    spVertexAttachment_computeWorldVertices(&clip->super, slot, 0, length, vertices, 0, 2);
    if (stage < CLIP_START_WINDING) return true;

    makeClockwise(g_clipper->clippingPolygon);
    if (stage < CLIP_START_TRIANGULATE) return true;

    spShortArray* triangles =
        spTriangulator_triangulate(g_clipper->triangulator, g_clipper->clippingPolygon);
    counts->triangulationTriangles = static_cast<std::uint32_t>(triangles->size / 3);
    counts->triangulatorScratch = static_cast<std::uint32_t>(
        g_clipper->triangulator->indicesArray->capacity
        + g_clipper->triangulator->isConcaveArray->capacity
        + g_clipper->triangulator->triangles->capacity);
    if (stage < CLIP_START_DECOMPOSE) return true;

    g_clipper->clippingPolygons =
        spTriangulator_decompose(g_clipper->triangulator, g_clipper->clippingPolygon, triangles);
    counts->pieces = static_cast<std::uint32_t>(g_clipper->clippingPolygons->size);
    if (stage < CLIP_START_PIECES) return true;

    for (int i = 0; i < g_clipper->clippingPolygons->size; ++i) {
        spFloatArray* polygon = g_clipper->clippingPolygons->items[i];
        makeClockwise(polygon);
        spFloatArray_add(polygon, polygon->items[0]);
        spFloatArray_add(polygon, polygon->items[1]);
    }
    for (int i = 0; i < g_clipper->clippingPolygons->size; ++i) {
        counts->effectiveEdges +=
            static_cast<std::uint32_t>(g_clipper->clippingPolygons->items[i]->size / 2);
    }
    if (stage < CLIP_START_PUBLISH) return true;

    captureClipRegion();
    counts->minX = g_clipRegion.minX;
    counts->minY = g_clipRegion.minY;
    counts->maxX = g_clipRegion.maxX;
    counts->maxY = g_clipRegion.maxY;
    return true;
}

}  // namespace


bool clipStartStage(Instance* instance, int stage, ClipStartCounts* counts) {
    if (!instance || !counts) return false;
    *counts = ClipStartCounts{};
    if (!g_clipper) g_clipper = spSkeletonClipping_create();

    // Closed on both sides. A region left open makes the next real extraction's
    // clipStart return immediately, so the ladder would be measuring one thing
    // and poisoning another.
    spSkeletonClipping_clipEnd2(g_clipper);
    const bool opened = openToStage(instance, stage, counts);
    spSkeletonClipping_clipEnd2(g_clipper);
    return opened;
}

bool renderCounted(Instance* instance, TriangleSink& sink, bool clipping, ProbeCounts* counts) {
    if (!instance || !counts) return false;
    *counts = ProbeCounts{};
    renderImpl<STAGE_EMIT, true>(instance, sink, clipping, counts);
    return true;
}

bool renderStage(Instance* instance, TriangleSink& sink, bool clipping,
                 int stage, ProbeCounts* counts) {
    switch (stage) {
        case STAGE_SETUP:    renderImpl<STAGE_SETUP, true>(instance, sink, clipping, counts); break;
        case STAGE_TRAVERSE: renderImpl<STAGE_TRAVERSE, true>(instance, sink, clipping, counts); break;
        case STAGE_VERTICES: renderImpl<STAGE_VERTICES, true>(instance, sink, clipping, counts); break;
        case STAGE_CLIP_START: renderImpl<STAGE_CLIP_START, true>(instance, sink, clipping, counts); break;
        case STAGE_CLIP:     renderImpl<STAGE_CLIP, true>(instance, sink, clipping, counts); break;
        case STAGE_EMIT:     renderImpl<STAGE_EMIT, true>(instance, sink, clipping, counts); break;
        default: return false;
    }
    return true;
}

int version() {
    return ES_SPINE_VERSION;
}

}  // namespace es::spine
