// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineRuntime.hpp
 * @brief   What a vendored Spine runtime owes the module, and nothing more.
 *
 * @details SpineModuleEntry.cpp implements the exported ABI (SpineBindings.hpp):
 *          handle tables, batch packing, the string and event buffers the caller
 *          reads back. None of that changes with the Spine release. Everything
 *          that does — the runtime's own types, its spelling of "update the world
 *          transform", whether slot colour is a struct or four floats — lives
 *          behind this header, implemented once per vendored runtime.
 *
 *          Exactly one implementation links into a binary: the web ships a module
 *          per version (spine38 / spine41 / spine42 / spine43) and a native host
 *          compiles the one its project needs. Selection is therefore a link-time
 *          fact, not a runtime one — no vtable, no dispatch, and a backend that
 *          forgets a function fails to link rather than failing on a device.
 *
 *          Skeleton and Instance stay incomplete here on purpose: the entry layer
 *          only ever holds them by pointer, so it cannot reach into a runtime's
 *          structs and quietly grow a dependency on one release's layout.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "./SkeletalModule.hpp"

namespace es::spine {

/** A loaded skeleton: its atlas, its data, and the mix table instances share. */
struct Skeleton;

/** One posable copy of a Skeleton, with its own animation state. */
struct Instance;

void destroy(Skeleton* skeleton);
void destroy(Instance* instance);

/// Owning handles, so every error path that bails mid-construct still frees.
struct SkeletonDeleter {
    void operator()(Skeleton* p) const { destroy(p); }
};
struct InstanceDeleter {
    void operator()(Instance* p) const { destroy(p); }
};
using SkeletonPtr = std::unique_ptr<Skeleton, SkeletonDeleter>;
using InstancePtr = std::unique_ptr<Instance, InstanceDeleter>;

enum class ConstraintKind { Ik, Transform, Path };

/**
 * Constraint mix weights, always per-axis. 4.0 split the old single rotate /
 * translate / scale / shear mixes into these; a runtime that predates the split
 * folds them back on the way in and mirrors them on the way out, so the SDK sees
 * one shape whatever it loaded.
 */
struct TransformMix {
    float rotate = 0.0f, x = 0.0f, y = 0.0f;
    float scaleX = 0.0f, scaleY = 0.0f, shearY = 0.0f;
};

struct PathMix {
    float position = 0.0f, spacing = 0.0f;
    float rotate = 0.0f, x = 0.0f, y = 0.0f;
};

/**
 * Animation-state events, numbered as the SDK decodes them (SPINE_TYPE_MAP in
 * SpinePlugin.ts). The numbering is 4.x's; runtimes that number their own enum
 * differently translate onto this rather than making the SDK guess which
 * dialect it is talking to.
 */
enum class EventKind {
    Start = 0,
    Interrupt = 1,
    End = 2,
    Complete = 3,
    Dispose = 4,
    Event = 5,
};

struct Event {
    EventKind kind = EventKind::Event;
    int track = 0;
    float floatValue = 0.0f;
    int intValue = 0;
    /// Borrowed from the runtime's own data — valid until the skeleton unloads.
    const char* animation = nullptr;
    const char* name = nullptr;
    const char* stringValue = nullptr;
};

/// The module is a singleton, so its collector is process-wide rather than per instance.
using EventSink = void (*)(const Event&);

/**
 * Where a backend pours the triangles it posed. The sink batches: it decides when
 * a texture or blend change starts a new batch and when one has filled up, so that
 * policy is written once instead of once per runtime.
 *
 * `positions` and `uvs` are x,y / u,v interleaved; `indices` index into them. One
 * colour covers the emission — Spine's colour is per attachment (skeleton × slot ×
 * attachment), so a per-vertex array would carry the same value repeated.
 *
 * `blendMode` is 0 normal, 1 additive, 2 multiply, 3 screen, and 4 / 5 for the
 * premultiplied twins of the first two, which is how the engine's renderer reads it.
 */
/// The shared one (SkeletalModule.hpp): batching is not a Spine idea, and the
/// backends below name this type, so it stays spelled `es::spine::TriangleSink`.
using TriangleSink = es::skeletal::TriangleSink;

// --- resources -------------------------------------------------------------

/** Returns null and fills `error` when the atlas or the skeleton data is unreadable. */
Skeleton* loadSkeleton(const void* skeletonData, int length,
                       const char* atlasText, int atlasLength,
                       bool binary, std::string& error);

int atlasPageCount(const Skeleton* skeleton);
const char* atlasPageName(const Skeleton* skeleton, int page);
void setAtlasPageTexture(Skeleton* skeleton, int page, uint32_t texture, int width, int height);

void setDefaultMix(Skeleton* skeleton, float seconds);
void setMixDuration(Skeleton* skeleton, const char* from, const char* to, float seconds);

// --- instances -------------------------------------------------------------

Instance* createInstance(Skeleton* skeleton);
void update(Instance* instance, float dt);

bool playAnimation(Instance* instance, const char* animation, bool loop, int track);
bool addAnimation(Instance* instance, const char* animation, bool loop, float delay, int track);
/** Null or empty restores the default skin. */
void setSkin(Instance* instance, const char* skin);
void setTrackAlpha(Instance* instance, int track, float alpha);

void setEventSink(EventSink sink);
void enableEvents(Instance* instance);

// --- queries ---------------------------------------------------------------

int animationCount(const Instance* instance);
const char* animationName(const Instance* instance, int index);
int skinCount(const Instance* instance);
const char* skinName(const Instance* instance, int index);

bool bonePosition(const Instance* instance, const char* bone, float* x, float* y);
bool boneRotation(const Instance* instance, const char* bone, float* degrees);
void bounds(const Instance* instance, float* x, float* y, float* width, float* height);

int constraintCount(const Instance* instance, ConstraintKind kind);
const char* constraintName(const Instance* instance, ConstraintKind kind, int index);
bool transformMix(const Instance* instance, const char* name, TransformMix* out);
bool setTransformMix(Instance* instance, const char* name, const TransformMix& mix);
bool pathMix(const Instance* instance, const char* name, PathMix* out);
bool setPathMix(Instance* instance, const char* name, const PathMix& mix);

// --- posing ----------------------------------------------------------------

bool setAttachment(Instance* instance, const char* slot, const char* attachment);
bool setIkTarget(Instance* instance, const char* constraint, float x, float y, float mix);
bool setSlotColor(Instance* instance, const char* slot, float r, float g, float b, float a);
bool setSkeletonColor(Instance* instance, float r, float g, float b, float a);

// --- geometry --------------------------------------------------------------

/** Poses the skeleton's attachments into `sink`, applying clip regions when asked. */
void render(Instance* instance, TriangleSink& sink, bool clipping);

/** 21 / 38 / 41 / 42 / 43 — whatever `spine_runtimeVersion()` should report. */
int version();

}  // namespace es::spine
