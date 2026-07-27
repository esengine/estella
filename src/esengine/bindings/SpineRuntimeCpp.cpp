// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineRuntimeCpp.cpp
 * @brief   The SpineRuntime backend for spine-cpp, which 4.3 made the only runtime.
 *
 * @details 4.3 retired the hand-written C runtime and regenerated spine-c as a
 *          wrapper over the C++ one. Binding the wrapper would buy nothing here —
 *          this TU is already C++ — so it binds spine-cpp directly.
 *
 *          The release also brought `SkeletonRenderer`, which walks the draw order,
 *          poses every attachment and applies clip regions. That is the whole of what
 *          the spine-c backend does by hand, so `render()` below is a translation of
 *          its RenderCommand list rather than a second copy of the traversal.
 *
 *          4.3 also moved a bone's world transform and a slot's colour onto pose
 *          objects, and reordered EventType so Dispose precedes Complete. The seam's
 *          normalized EventKind is why that reordering stops here instead of reaching
 *          the SDK.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "SpineRuntime.hpp"

#include <spine/spine.h>
#include <spine/SkeletonRenderer.h>

#include <vector>

#ifndef ES_SPINE_VERSION
#error "ES_SPINE_VERSION must name the vendored spine-cpp release (43)."
#endif

namespace sp = ::spine;

// spine-cpp asks its host for the allocator it should use, the way spine-c asks for
// its file and texture hooks. The default one is malloc/free, which is what the
// module wants: on the web its heap is the wasm heap, and on a device the host's
// allocator already routes through the engine's arena.
sp::SpineExtension* spine::getDefaultExtension() {
    return new sp::DefaultSpineExtension();
}

namespace es::spine {

namespace {

/**
 * Atlas pages are uploaded by the SDK, not by us: it reads the page names back,
 * loads the images and registers texture ids through setAtlasPageTexture. So the
 * loader spine-cpp insists on exists and does nothing.
 */
class UnloadedTextures : public sp::TextureLoader {
public:
    void load(sp::AtlasPage& page, const sp::String& path) override {
        (void)page;
        (void)path;
    }
    void unload(void* texture) override { (void)texture; }
};

EventSink g_eventSink = nullptr;

/// Reused across instances and frames: one render() consumes its commands at once.
sp::SkeletonRenderer g_renderer;

int blendModeOf(sp::BlendMode mode) {
    switch (mode) {
        case sp::BlendMode_Additive: return 1;
        case sp::BlendMode_Multiply: return 2;
        case sp::BlendMode_Screen: return 3;
        default: return 0;
    }
}

const char* cstr(const sp::String& text) {
    return text.buffer();
}

}  // namespace

// =============================================================================
// Resources
// =============================================================================

struct Skeleton {
    UnloadedTextures loader;
    sp::Atlas* atlas = nullptr;
    sp::SkeletonData* data = nullptr;
    sp::AnimationStateData* stateData = nullptr;

    /// Texture ids whose atlas page is premultiplied, so render() can pick the
    /// premultiplied blend modes. The renderer hands back a texture, not a page.
    std::vector<void*> premultiplied;

    Skeleton() = default;
    Skeleton(const Skeleton&) = delete;
    Skeleton& operator=(const Skeleton&) = delete;

    // The atlas unloads its pages through the loader, so it goes first.
    ~Skeleton() {
        delete stateData;
        delete data;
        delete atlas;
    }

    bool isPremultiplied(void* texture) const {
        for (void* t : premultiplied) {
            if (t == texture) return true;
        }
        return false;
    }
};

struct Instance {
    Skeleton* owner = nullptr;
    sp::Skeleton* skeleton = nullptr;
    sp::AnimationState* state = nullptr;

    Instance() = default;
    Instance(const Instance&) = delete;
    Instance& operator=(const Instance&) = delete;

    ~Instance() {
        delete state;
        delete skeleton;
    }
};

void destroy(Skeleton* skeleton) { delete skeleton; }
void destroy(Instance* instance) { delete instance; }

Skeleton* loadSkeleton(const void* skeletonData, int length,
                       const char* atlasText, int atlasLength,
                       bool binary, std::string& error) {
    auto skeleton = std::make_unique<Skeleton>();

    skeleton->atlas = new sp::Atlas(atlasText, atlasLength, "", &skeleton->loader);
    if (skeleton->atlas->getPages().size() == 0) {
        error = "Failed to create atlas (invalid atlas text or no pages)";
        return nullptr;
    }

    if (binary) {
        sp::SkeletonBinary reader(*skeleton->atlas);
        reader.setScale(1.0f);
        skeleton->data = reader.readSkeletonData(
            static_cast<const unsigned char*>(skeletonData), length);
        if (!skeleton->data) error = cstr(reader.getError());
    } else {
        sp::SkeletonJson reader(*skeleton->atlas);
        reader.setScale(1.0f);
        skeleton->data = reader.readSkeletonData(static_cast<const char*>(skeletonData));
        if (!skeleton->data) error = cstr(reader.getError());
    }

    if (!skeleton->data) return nullptr;

    skeleton->stateData = new sp::AnimationStateData(*skeleton->data);
    skeleton->stateData->setDefaultMix(0.2f);
    return skeleton.release();
}

int atlasPageCount(const Skeleton* skeleton) {
    if (!skeleton) return 0;
    return static_cast<int>(skeleton->atlas->getPages().size());
}

const char* atlasPageName(const Skeleton* skeleton, int page) {
    if (!skeleton || page < 0 || page >= atlasPageCount(skeleton)) return nullptr;
    return cstr(skeleton->atlas->getPages()[page]->name);
}

void setAtlasPageTexture(Skeleton* skeleton, int page, uint32_t texture, int width, int height) {
    if (!skeleton || page < 0 || page >= atlasPageCount(skeleton)) return;

    sp::AtlasPage* target = skeleton->atlas->getPages()[page];
    void* handle = reinterpret_cast<void*>(static_cast<uintptr_t>(texture));
    target->texture = handle;
    target->width = width;
    target->height = height;

    // Regions copied the page's texture when the atlas parsed, which was before the
    // SDK had one to give; attachments read it from the region, so refresh them.
    sp::Array<sp::AtlasRegion*>& regions = skeleton->atlas->getRegions();
    for (size_t i = 0; i < regions.size(); ++i) {
        if (regions[i]->getPage() == target) regions[i]->setRendererObject(handle);
    }

    if (target->pma && !skeleton->isPremultiplied(handle)) {
        skeleton->premultiplied.push_back(handle);
    }
}

void setDefaultMix(Skeleton* skeleton, float seconds) {
    if (skeleton) skeleton->stateData->setDefaultMix(seconds);
}

void setMixDuration(Skeleton* skeleton, const char* from, const char* to, float seconds) {
    if (!skeleton) return;
    sp::Animation* a = skeleton->data->findAnimation(from);
    sp::Animation* b = skeleton->data->findAnimation(to);
    if (a && b) skeleton->stateData->setMix(*a, *b, seconds);
}

// =============================================================================
// Instances
// =============================================================================

Instance* createInstance(Skeleton* skeleton) {
    if (!skeleton) return nullptr;

    auto instance = std::make_unique<Instance>();
    instance->owner = skeleton;
    instance->skeleton = new sp::Skeleton(*skeleton->data);
    instance->state = new sp::AnimationState(*skeleton->stateData);

    instance->skeleton->setupPose();
    instance->skeleton->updateWorldTransform(sp::Physics_Update);
    return instance.release();
}

void update(Instance* instance, float dt) {
    if (!instance) return;
    instance->state->update(dt);
    instance->state->apply(*instance->skeleton);
    instance->skeleton->update(dt);
    instance->skeleton->updateWorldTransform(sp::Physics_Update);
}

bool playAnimation(Instance* instance, const char* animation, bool loop, int track) {
    if (!instance) return false;
    // setAnimation takes a reference and asserts on a missing name, so look first.
    sp::Animation* found = instance->skeleton->getData().findAnimation(animation);
    if (!found) return false;
    instance->state->setAnimation(static_cast<size_t>(track), *found, loop);
    return true;
}

bool addAnimation(Instance* instance, const char* animation, bool loop, float delay, int track) {
    if (!instance) return false;
    sp::Animation* found = instance->skeleton->getData().findAnimation(animation);
    if (!found) return false;
    instance->state->addAnimation(static_cast<size_t>(track), *found, loop, delay);
    return true;
}

void setSkin(Instance* instance, const char* skin) {
    if (!instance) return;
    if (!skin || skin[0] == '\0') {
        instance->skeleton->setSkin(static_cast<sp::Skin*>(nullptr));
    } else {
        sp::Skin* found = instance->skeleton->getData().findSkin(skin);
        if (!found) return;
        instance->skeleton->setSkin(found);
    }
    instance->skeleton->setupPoseSlots();
}

void setTrackAlpha(Instance* instance, int track, float alpha) {
    if (!instance) return;
    sp::TrackEntry* entry = instance->state->getTrack(static_cast<size_t>(track));
    if (entry) entry->setAlpha(alpha);
}

void setEventSink(EventSink sink) {
    g_eventSink = sink;
}

namespace {

/// 4.3 numbers Dispose before Complete; the SDK reads 4.x's original order.
EventKind kindOf(sp::EventType type) {
    switch (type) {
        case sp::EventType_Start: return EventKind::Start;
        case sp::EventType_Interrupt: return EventKind::Interrupt;
        case sp::EventType_End: return EventKind::End;
        case sp::EventType_Complete: return EventKind::Complete;
        case sp::EventType_Dispose: return EventKind::Dispose;
        default: return EventKind::Event;
    }
}

void eventListener(sp::AnimationState* state, sp::EventType type,
                   sp::TrackEntry* entry, sp::Event* event, void* userData) {
    (void)state;
    (void)userData;
    if (!g_eventSink) return;

    Event out;
    out.kind = kindOf(type);
    out.track = entry ? static_cast<int>(entry->getTrackIndex()) : 0;
    if (entry) out.animation = cstr(entry->getAnimation().getName());
    if (type == sp::EventType_Event && event) {
        out.floatValue = event->getFloat();
        out.intValue = event->getInt();
        out.name = cstr(event->getData().getName());
        out.stringValue = cstr(event->getString());
    }
    g_eventSink(out);
}

}  // namespace

void enableEvents(Instance* instance) {
    if (instance) instance->state->setListener(eventListener);
}

// =============================================================================
// Queries
// =============================================================================

int animationCount(const Instance* instance) {
    if (!instance) return 0;
    return static_cast<int>(instance->skeleton->getData().getAnimations().size());
}

const char* animationName(const Instance* instance, int index) {
    if (!instance || index < 0 || index >= animationCount(instance)) return nullptr;
    return cstr(instance->skeleton->getData().getAnimations()[index]->getName());
}

int skinCount(const Instance* instance) {
    if (!instance) return 0;
    return static_cast<int>(instance->skeleton->getData().getSkins().size());
}

const char* skinName(const Instance* instance, int index) {
    if (!instance || index < 0 || index >= skinCount(instance)) return nullptr;
    return cstr(instance->skeleton->getData().getSkins()[index]->getName());
}

bool bonePosition(const Instance* instance, const char* bone, float* x, float* y) {
    if (!instance) return false;
    sp::Bone* found = instance->skeleton->findBone(bone);
    if (!found) return false;
    // The applied pose is what rendering used — constraints included.
    *x = found->getAppliedPose().getWorldX();
    *y = found->getAppliedPose().getWorldY();
    return true;
}

bool boneRotation(const Instance* instance, const char* bone, float* degrees) {
    if (!instance) return false;
    sp::Bone* found = instance->skeleton->findBone(bone);
    if (!found) return false;
    *degrees = found->getAppliedPose().getWorldRotationX();
    return true;
}

void bounds(const Instance* instance, float* x, float* y, float* width, float* height) {
    *x = *y = *width = *height = 0.0f;
    if (!instance) return;
    instance->skeleton->getBounds(*x, *y, *width, *height);
}

namespace {

bool isKind(sp::Constraint* constraint, ConstraintKind kind) {
    switch (kind) {
        case ConstraintKind::Ik: return constraint->getRTTI().isExactly(sp::IkConstraint::rtti);
        case ConstraintKind::Transform:
            return constraint->getRTTI().isExactly(sp::TransformConstraint::rtti);
        case ConstraintKind::Path: return constraint->getRTTI().isExactly(sp::PathConstraint::rtti);
    }
    return false;
}

}  // namespace

int constraintCount(const Instance* instance, ConstraintKind kind) {
    if (!instance) return 0;
    sp::Array<sp::Constraint*>& constraints = instance->skeleton->getConstraints();
    int count = 0;
    for (size_t i = 0; i < constraints.size(); ++i) {
        if (isKind(constraints[i], kind)) ++count;
    }
    return count;
}

const char* constraintName(const Instance* instance, ConstraintKind kind, int index) {
    if (!instance || index < 0) return nullptr;
    sp::Array<sp::Constraint*>& constraints = instance->skeleton->getConstraints();
    int seen = 0;
    for (size_t i = 0; i < constraints.size(); ++i) {
        if (!isKind(constraints[i], kind)) continue;
        if (seen == index) return cstr(constraints[i]->getData().getName());
        ++seen;
    }
    return nullptr;
}

bool transformMix(const Instance* instance, const char* name, TransformMix* out) {
    if (!instance) return false;
    auto* c = instance->skeleton->findConstraint<sp::TransformConstraint>(name);
    if (!c) return false;
    out->rotate = c->getPose().getMixRotate();
    out->x = c->getPose().getMixX();
    out->y = c->getPose().getMixY();
    out->scaleX = c->getPose().getMixScaleX();
    out->scaleY = c->getPose().getMixScaleY();
    out->shearY = c->getPose().getMixShearY();
    return true;
}

bool setTransformMix(Instance* instance, const char* name, const TransformMix& mix) {
    if (!instance) return false;
    auto* c = instance->skeleton->findConstraint<sp::TransformConstraint>(name);
    if (!c) return false;
    c->getPose().setMixRotate(mix.rotate);
    c->getPose().setMixX(mix.x);
    c->getPose().setMixY(mix.y);
    c->getPose().setMixScaleX(mix.scaleX);
    c->getPose().setMixScaleY(mix.scaleY);
    c->getPose().setMixShearY(mix.shearY);
    return true;
}

bool pathMix(const Instance* instance, const char* name, PathMix* out) {
    if (!instance) return false;
    auto* c = instance->skeleton->findConstraint<sp::PathConstraint>(name);
    if (!c) return false;
    out->position = c->getPose().getPosition();
    out->spacing = c->getPose().getSpacing();
    out->rotate = c->getPose().getMixRotate();
    out->x = c->getPose().getMixX();
    out->y = c->getPose().getMixY();
    return true;
}

bool setPathMix(Instance* instance, const char* name, const PathMix& mix) {
    if (!instance) return false;
    auto* c = instance->skeleton->findConstraint<sp::PathConstraint>(name);
    if (!c) return false;
    c->getPose().setPosition(mix.position);
    c->getPose().setSpacing(mix.spacing);
    c->getPose().setMixRotate(mix.rotate);
    c->getPose().setMixX(mix.x);
    c->getPose().setMixY(mix.y);
    return true;
}

// =============================================================================
// Posing
// =============================================================================

bool setAttachment(Instance* instance, const char* slot, const char* attachment) {
    if (!instance) return false;
    sp::Slot* found = instance->skeleton->findSlot(slot);
    if (!found) return false;

    if (!attachment || attachment[0] == '\0') {
        found->getPose().setAttachment(nullptr);
        return true;
    }

    sp::Attachment* wanted = instance->skeleton->getAttachment(found->getData().getIndex(), attachment);
    if (!wanted) return false;
    found->getPose().setAttachment(wanted);
    return true;
}

bool setIkTarget(Instance* instance, const char* constraint, float x, float y, float mix) {
    if (!instance) return false;
    auto* c = instance->skeleton->findConstraint<sp::IkConstraint>(constraint);
    if (!c) return false;
    c->getTarget().getPose().setX(x);
    c->getTarget().getPose().setY(y);
    c->getPose().setMix(mix);
    return true;
}

bool setSlotColor(Instance* instance, const char* slot, float r, float g, float b, float a) {
    if (!instance) return false;
    sp::Slot* found = instance->skeleton->findSlot(slot);
    if (!found) return false;
    found->getPose().getColor().set(r, g, b, a);
    return true;
}

bool setSkeletonColor(Instance* instance, float r, float g, float b, float a) {
    if (!instance) return false;
    instance->skeleton->getColor().set(r, g, b, a);
    return true;
}

// =============================================================================
// Geometry
// =============================================================================

void render(Instance* instance, TriangleSink& sink, bool clipping) {
    if (!instance) return;

    // SkeletonRenderer always clips; when the caller asked for no clipping there is
    // nothing to turn off, so the flag only matters to backends that clip by hand.
    (void)clipping;

    for (sp::RenderCommand* command = g_renderer.render(*instance->skeleton);
         command != nullptr; command = command->next) {
        if (command->numVertices <= 0 || command->numIndices <= 0) continue;

        // Every vertex of a command carries the same colour: the renderer writes one
        // colour per attachment and only merges commands whose colours already match.
        const uint32_t packed = command->colors[0];
        float rgba[4] = {
            static_cast<float>((packed >> 16) & 0xFF) / 255.0f,
            static_cast<float>((packed >> 8) & 0xFF) / 255.0f,
            static_cast<float>(packed & 0xFF) / 255.0f,
            static_cast<float>((packed >> 24) & 0xFF) / 255.0f,
        };

        int blendMode = blendModeOf(command->blendMode);
        if (instance->owner->isPremultiplied(command->texture)) {
            if (blendMode == 0 || blendMode == 1) {
                blendMode += 4;
                rgba[0] *= rgba[3];
                rgba[1] *= rgba[3];
                rgba[2] *= rgba[3];
            }
        }

        sink.emit(command->positions, command->uvs, command->numVertices,
                  command->indices, command->numIndices,
                  static_cast<uint32_t>(reinterpret_cast<uintptr_t>(command->texture)),
                  blendMode, rgba);
    }
}

int version() {
    return ES_SPINE_VERSION;
}

}  // namespace es::spine
