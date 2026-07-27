// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineRuntime21.cpp
 * @brief   The SpineRuntime backend for spine-c 2.1, the runtime a 2015 editor exports for.
 *
 * @details 2.1 predates most of what SpineRuntimeC.cpp assumes: colour is four loose
 *          floats rather than a struct, a slot blends additively or not at all, weighted
 *          meshes are their own attachment type, triangle indices are `int`, and the
 *          event listener is handed a track index instead of the entry. Threading that
 *          through the 3.8-4.2 backend would mean an `#if` around nearly every line, so
 *          it is its own backend — which is what the seam is for.
 *
 *          What 2.1 does NOT have is as load-bearing as what it does: no clipping
 *          attachments, no transform or path constraints, and no binary skeleton
 *          reader. The first two answer empty; the third is reported as the export
 *          setting it is, because a 2.1 editor can write JSON and this runtime reads it.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "SpineRuntime.hpp"

#include <spine/spine.h>
#include <spine/extension.h>

#include <cstring>
#include <vector>

#if ES_SPINE_VERSION != 21
#error "SpineRuntime21.cpp is the spine-c 2.1 backend; build it with ES_SPINE_VERSION=21."
#endif

// =============================================================================
// spine-c Required Callbacks
// =============================================================================
//
// As in the 3.8+ backend: the SDK owns atlas pages and registers their texture ids,
// and the module never touches a filesystem.

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

struct Skeleton {
    spAtlas* atlas = nullptr;
    spSkeletonData* data = nullptr;
    spAnimationStateData* stateData = nullptr;

    Skeleton() = default;
    Skeleton(const Skeleton&) = delete;
    Skeleton& operator=(const Skeleton&) = delete;

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

std::vector<float> g_worldVertices;
/// 2.1 indexes triangles with `int`; the engine's vertex buffers are 16-bit.
std::vector<uint16_t> g_indices;

EventSink g_eventSink = nullptr;

const uint16_t QUAD_INDICES[6] = {0, 1, 2, 2, 3, 0};

spAtlasPage* pageAt(const Skeleton* skeleton, int index) {
    if (!skeleton || index < 0) return nullptr;
    spAtlasPage* page = skeleton->atlas->pages;
    for (int i = 0; i < index && page; ++i) page = page->next;
    return page;
}

/// Attachments point straight at their atlas region, whose page carries the id.
uint32_t textureOf(const void* rendererObject) {
    auto* region = reinterpret_cast<const spAtlasRegion*>(rendererObject);
    if (!region || !region->page) return 0;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(region->page->rendererObject));
}

void widenIndices(const int* triangles, int count) {
    g_indices.resize(static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        g_indices[static_cast<size_t>(i)] = static_cast<uint16_t>(triangles[i]);
    }
}

/** One slot's posed geometry, in the shared scratch buffers. */
struct Posed {
    const float* positions = nullptr;
    const float* uvs = nullptr;
    const uint16_t* indices = nullptr;
    int vertexCount = 0;
    int indexCount = 0;
    uint32_t texture = 0;
    float color[4] = {1.0f, 1.0f, 1.0f, 1.0f};
};

/**
 * Pose whatever the slot is showing. Region, mesh and weighted mesh differ in how
 * their vertices are computed and in nothing else, so both render() and bounds()
 * read them through here rather than each walking the three cases.
 */
bool pose(spSlot* slot, Posed& out) {
    spAttachment* attachment = slot->attachment;
    if (!attachment) return false;

    switch (attachment->type) {
        case SP_ATTACHMENT_REGION: {
            auto* region = reinterpret_cast<spRegionAttachment*>(attachment);
            out.texture = textureOf(region->rendererObject);
            if (!out.texture) return false;

            g_worldVertices.resize(8);
            spRegionAttachment_computeWorldVertices(region, slot->bone, g_worldVertices.data());
            out.positions = g_worldVertices.data();
            out.uvs = region->uvs;
            out.indices = QUAD_INDICES;
            out.vertexCount = 4;
            out.indexCount = 6;
            out.color[0] = region->r;
            out.color[1] = region->g;
            out.color[2] = region->b;
            out.color[3] = region->a;
            return true;
        }
        case SP_ATTACHMENT_MESH: {
            auto* mesh = reinterpret_cast<spMeshAttachment*>(attachment);
            out.texture = textureOf(mesh->rendererObject);
            if (!out.texture) return false;

            // verticesCount counts floats, not vertices.
            g_worldVertices.resize(static_cast<size_t>(mesh->verticesCount));
            spMeshAttachment_computeWorldVertices(mesh, slot, g_worldVertices.data());
            widenIndices(mesh->triangles, mesh->trianglesCount);
            out.positions = g_worldVertices.data();
            out.uvs = mesh->uvs;
            out.indices = g_indices.data();
            out.vertexCount = mesh->verticesCount / 2;
            out.indexCount = mesh->trianglesCount;
            out.color[0] = mesh->r;
            out.color[1] = mesh->g;
            out.color[2] = mesh->b;
            out.color[3] = mesh->a;
            return true;
        }
        case SP_ATTACHMENT_SKINNED_MESH: {
            // 3.x folded weighted meshes back into the mesh attachment; in 2.1 they
            // are a separate type, sized by their UVs rather than by source vertices.
            auto* mesh = reinterpret_cast<spSkinnedMeshAttachment*>(attachment);
            out.texture = textureOf(mesh->rendererObject);
            if (!out.texture) return false;

            g_worldVertices.resize(static_cast<size_t>(mesh->uvsCount));
            spSkinnedMeshAttachment_computeWorldVertices(mesh, slot, g_worldVertices.data());
            widenIndices(mesh->triangles, mesh->trianglesCount);
            out.positions = g_worldVertices.data();
            out.uvs = mesh->uvs;
            out.indices = g_indices.data();
            out.vertexCount = mesh->uvsCount / 2;
            out.indexCount = mesh->trianglesCount;
            out.color[0] = mesh->r;
            out.color[1] = mesh->g;
            out.color[2] = mesh->b;
            out.color[3] = mesh->a;
            return true;
        }
        default:
            return false;  // bounding boxes draw nothing
    }
}

EventKind kindOf(spEventType type) {
    switch (type) {
        case SP_ANIMATION_START: return EventKind::Start;
        case SP_ANIMATION_END: return EventKind::End;
        case SP_ANIMATION_COMPLETE: return EventKind::Complete;
        default: return EventKind::Event;
    }
}

/// 2.1 hands the listener a track index rather than the entry, so the animation's
/// name is looked up rather than read off one. loopCount has no counterpart in the
/// SDK's event shape, which reports a completion per loop either way.
void eventListener(spAnimationState* state, int trackIndex, spEventType type,
                   spEvent* event, int loopCount) {
    (void)loopCount;
    if (!g_eventSink) return;

    Event out;
    out.kind = kindOf(type);
    out.track = trackIndex;

    spTrackEntry* entry = spAnimationState_getCurrent(state, trackIndex);
    if (entry && entry->animation) out.animation = entry->animation->name;

    if (type == SP_ANIMATION_EVENT && event) {
        out.floatValue = event->floatValue;
        out.intValue = event->intValue;
        out.name = event->data->name;
        out.stringValue = event->stringValue;
    }
    g_eventSink(out);
}

}  // namespace

// =============================================================================
// Resources
// =============================================================================

Skeleton* loadSkeleton(const void* skeletonData, int length,
                       const char* atlasText, int atlasLength,
                       bool binary, std::string& error) {
    if (binary) {
        // Spine 2.1 could export .skel, but its C runtime shipped no reader for it —
        // so the fix is an export setting, and saying which one is the whole job here.
        error = "Spine 2.1 binary skeletons are not supported: re-export from Spine "
                "with the skeleton data format set to JSON.";
        return nullptr;
    }

    auto skeleton = std::make_unique<Skeleton>();

    skeleton->atlas = spAtlas_create(atlasText, atlasLength, "", nullptr);
    if (!skeleton->atlas || !skeleton->atlas->pages) {
        error = "Failed to create atlas (invalid atlas text or no pages)";
        return nullptr;
    }

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
    (void)length;  // the JSON reader takes a NUL-terminated string

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

    // Attachments reach the id through their region's page, so setting it here is
    // enough — 4.0's second copy on the region did not exist yet.
    p->rendererObject = reinterpret_cast<void*>(static_cast<uintptr_t>(texture));
    p->width = width;
    p->height = height;
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
    spSkeleton_updateWorldTransform(instance->skeleton);
    return instance.release();
}

void update(Instance* instance, float dt) {
    if (!instance) return;
    spAnimationState_update(instance->state, dt);
    spAnimationState_apply(instance->state, instance->skeleton);
    spSkeleton_updateWorldTransform(instance->skeleton);
}

bool playAnimation(Instance* instance, const char* animation, bool loop, int track) {
    if (!instance) return false;
    return spAnimationState_setAnimationByName(instance->state, track, animation, loop) != nullptr;
}

bool addAnimation(Instance* instance, const char* animation, bool loop, float delay, int track) {
    if (!instance) return false;
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
    // `mix` is what 2.1 applies the track with; the per-track alpha of later
    // releases is the same knob under a name it had not been given yet.
    if (entry) entry->mix = alpha;
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
    // One world rotation before 4.0 split it per axis; report it for both.
    *degrees = b->worldRotation;
    return true;
}

void bounds(const Instance* instance, float* x, float* y, float* width, float* height) {
    *x = *y = *width = *height = 0.0f;
    if (!instance) return;

    spSkeleton* skeleton = instance->skeleton;
    float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
    bool any = false;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        Posed posed;
        if (!pose(skeleton->drawOrder[i], posed)) continue;
        for (int v = 0; v < posed.vertexCount; ++v) {
            const float vx = posed.positions[v * 2];
            const float vy = posed.positions[v * 2 + 1];
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
    // Transform and path constraints arrived in 3.x; 2.1 skeletons have neither.
    if (!instance || kind != ConstraintKind::Ik) return 0;
    return instance->skeleton->ikConstraintsCount;
}

const char* constraintName(const Instance* instance, ConstraintKind kind, int index) {
    if (!instance || kind != ConstraintKind::Ik) return nullptr;
    if (index < 0 || index >= instance->skeleton->ikConstraintsCount) return nullptr;
    return instance->skeleton->ikConstraints[index]->data->name;
}

bool transformMix(const Instance*, const char*, TransformMix*) { return false; }
bool setTransformMix(Instance*, const char*, const TransformMix&) { return false; }
bool pathMix(const Instance*, const char*, PathMix*) { return false; }
bool setPathMix(Instance*, const char*, const PathMix&) { return false; }

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
    s->r = r;
    s->g = g;
    s->b = b;
    s->a = a;
    return true;
}

bool setSkeletonColor(Instance* instance, float r, float g, float b, float a) {
    if (!instance) return false;
    instance->skeleton->r = r;
    instance->skeleton->g = g;
    instance->skeleton->b = b;
    instance->skeleton->a = a;
    return true;
}

// =============================================================================
// Geometry
// =============================================================================

void render(Instance* instance, TriangleSink& sink, bool clipping) {
    // Clipping attachments are a 3.5 feature; a 2.1 skeleton has no clip region to
    // apply, so the toggle has nothing to switch off.
    (void)clipping;
    if (!instance) return;

    spSkeleton* skeleton = instance->skeleton;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot) continue;

        Posed posed;
        if (!pose(slot, posed)) continue;

        // 2.1 slots are normal or additive — multiply and screen came later, and no
        // atlas of that era declares premultiplied alpha.
        const int blendMode = slot->data->additiveBlending ? 1 : 0;

        const float rgba[4] = {
            skeleton->r * slot->r * posed.color[0],
            skeleton->g * slot->g * posed.color[1],
            skeleton->b * slot->b * posed.color[2],
            skeleton->a * slot->a * posed.color[3],
        };

        sink.emit(posed.positions, posed.uvs, posed.vertexCount,
                  posed.indices, posed.indexCount, posed.texture, blendMode, rgba);
    }
}

int version() {
    return ES_SPINE_VERSION;
}

}  // namespace es::spine
