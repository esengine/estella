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

#include "SpineRuntime.hpp"

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

/// Straight-alpha blend modes get their premultiplied twin when the page is PMA.
int premultiply(int blendMode, spAtlasRegion* region) {
    if (!region || !region->page || !region->page->pma) return blendMode;
    if (blendMode == 0) return 4;
    if (blendMode == 1) return 5;
    return blendMode;
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
 * Hand one attachment's triangles to the sink, clipped against the open clip
 * region when there is one. Clipping replaces the triangle set with the polygon
 * intersection, so it can only shrink the geometry, never grow it.
 */
void emit(TriangleSink& sink, bool clipping,
          float* positions, int vertexCount, float* uvs,
          unsigned short* triangles, int triangleCount,
          uint32_t texture, int blendMode, const float rgba[4]) {
    float* outPositions = positions;
    float* outUVs = uvs;
    unsigned short* outTriangles = triangles;
    int outVertices = vertexCount;
    int outTriangleCount = triangleCount;

    if (clipping && spSkeletonClipping_isClipping(g_clipper)) {
        spSkeletonClipping_clipTriangles(g_clipper, positions, vertexCount * 2,
                                         triangles, triangleCount, uvs, 2);
        outPositions = g_clipper->clippedVertices->items;
        outVertices = g_clipper->clippedVertices->size / 2;
        outUVs = g_clipper->clippedUVs->items;
        outTriangles = g_clipper->clippedTriangles->items;
        outTriangleCount = g_clipper->clippedTriangles->size;
    }

    if (outVertices == 0 || outTriangleCount == 0) return;
    sink.emit(outPositions, outUVs, outVertices, outTriangles, outTriangleCount,
              texture, blendMode, rgba);
}

}  // namespace

void render(Instance* instance, TriangleSink& sink, bool clipping) {
    if (!instance) return;
    if (!g_clipper) g_clipper = spSkeletonClipping_create();

    spSkeleton* skeleton = instance->skeleton;
    const spColor& skeletonColor = skeleton->color;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot) continue;

        spAttachment* attachment = slot->attachment;

        // A clipping attachment opens a region that runs until its end slot; it
        // draws nothing itself.
        if (attachment && attachment->type == SP_ATTACHMENT_CLIPPING) {
            if (clipping) {
                spSkeletonClipping_clipStart(g_clipper, slot,
                                             reinterpret_cast<spClippingAttachment*>(attachment));
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
                auto* region = reinterpret_cast<spRegionAttachment*>(attachment);
                const uint32_t texture = regionTexture(region);
                if (texture) {
                    g_worldVertices.resize(8);
#if ES_SPINE_VERSION < 40
                    spRegionAttachment_computeWorldVertices(region, slot->bone,
                                                            g_worldVertices.data(), 0, 2);
                    const int effectiveBlend = blendMode;
#else
                    spRegionAttachment_computeWorldVertices(region, slot,
                                                            g_worldVertices.data(), 0, 2);
                    const int effectiveBlend = premultiply(
                        blendMode, reinterpret_cast<spAtlasRegion*>(region->region));
#endif
                    const spColor& attachmentColor = region->color;
                    float rgba[4] = {
                        skeletonColor.r * slotColor.r * attachmentColor.r,
                        skeletonColor.g * slotColor.g * attachmentColor.g,
                        skeletonColor.b * slotColor.b * attachmentColor.b,
                        skeletonColor.a * slotColor.a * attachmentColor.a,
                    };
                    if (effectiveBlend >= 4) {
                        rgba[0] *= rgba[3];
                        rgba[1] *= rgba[3];
                        rgba[2] *= rgba[3];
                    }

                    static unsigned short quad[6] = {0, 1, 2, 2, 3, 0};
                    emit(sink, clipping, g_worldVertices.data(), 4, region->uvs, quad, 6,
                         texture, effectiveBlend, rgba);
                }
            } else if (attachment->type == SP_ATTACHMENT_MESH) {
                auto* mesh = reinterpret_cast<spMeshAttachment*>(attachment);
                const uint32_t texture = meshTexture(mesh);
                if (texture) {
                    const int length = SUPER(mesh)->worldVerticesLength;
                    g_worldVertices.resize(length);
                    spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0, length,
                                                            g_worldVertices.data(), 0, 2);
#if ES_SPINE_VERSION < 40
                    const int effectiveBlend = blendMode;
#else
                    const int effectiveBlend = premultiply(
                        blendMode, reinterpret_cast<spAtlasRegion*>(mesh->region));
#endif
                    const spColor& attachmentColor = mesh->color;
                    float rgba[4] = {
                        skeletonColor.r * slotColor.r * attachmentColor.r,
                        skeletonColor.g * slotColor.g * attachmentColor.g,
                        skeletonColor.b * slotColor.b * attachmentColor.b,
                        skeletonColor.a * slotColor.a * attachmentColor.a,
                    };
                    if (effectiveBlend >= 4) {
                        rgba[0] *= rgba[3];
                        rgba[1] *= rgba[3];
                        rgba[2] *= rgba[3];
                    }

                    emit(sink, clipping, g_worldVertices.data(), length / 2, mesh->uvs,
                         mesh->triangles, mesh->trianglesCount,
                         texture, effectiveBlend, rgba);
                }
            }
        }

        // Closes the region when this slot is the clip's end slot; a cheap no-op
        // otherwise, which is why every non-clip slot passes through here.
        if (clipping) spSkeletonClipping_clipEnd(g_clipper, slot);
    }

    if (clipping) spSkeletonClipping_clipEnd2(g_clipper);
}

int version() {
    return ES_SPINE_VERSION;
}

}  // namespace es::spine
