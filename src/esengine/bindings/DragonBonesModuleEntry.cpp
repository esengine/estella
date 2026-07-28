// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DragonBonesModuleEntry.cpp
 * @brief   The DragonBones side module's exported ABI.
 *
 * @details Handles, batching, the returned-string storage and the event queue all
 *          come from SkeletalModule.hpp, which the Spine module uses for the same
 *          things. What is written here is only what DragonBones does differently,
 *          and there are three such places worth naming.
 *
 *          ONE FILE HOLDS SEVERAL ARMATURES. Spine's skeleton is the file; a
 *          DragonBones file is a project and names its armatures (mecha_2903 ships
 *          four). So creating an instance takes an armature name, and
 *          `db_getArmatures` exists at all.
 *
 *          BLENDING IS PER PLAY, NOT A TABLE. Spine mixes through a from/to matrix
 *          set on the skeleton; DragonBones fades in when you start an animation.
 *          Neither is expressible as the other, so the ABI says `fadeIn` and does
 *          not pretend to have a mix table.
 *
 *          THE ATLAS IS ONE PAGE. Spine's atlas names its pages and the caller
 *          binds each; a DragonBones atlas is one image, so the page API here is
 *          the degenerate case rather than a second shape for the SDK to learn.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include <emscripten.h>

#include <cstring>
#include <string>
#include <vector>

#include "DragonBonesAdapter.hpp"
#include "SkeletalModule.hpp"

namespace {

using dragonBones::Armature;
using dragonBones::DragonBonesData;
using dragonBones::EsArmatureProxy;
using dragonBones::EsFactory;
using dragonBones::EsSlot;
using dragonBones::EsTextureAtlasData;

/// A parsed file plus the atlas that goes with it — they load and unload together.
struct LoadedSkeleton {
    DragonBonesData* data = nullptr;
    EsTextureAtlasData* atlas = nullptr;
    std::string name;
};

struct LiveInstance {
    Armature* armature = nullptr;
    int skeletonHandle = -1;
};

struct Context {
    es::skeletal::HandleTable<LoadedSkeleton> skeletons;
    es::skeletal::HandleTable<LiveInstance> instances;

    std::vector<es::skeletal::MeshBatch> batches;
    es::skeletal::StringBuffer strings;
    es::skeletal::EventBuffer events;

    std::string lastError;

    Armature* armatureOf(int id) {
        auto* live = instances.find(id);
        return live ? live->armature : nullptr;
    }
};

Context g_ctx;

/// Names a loaded file uniquely, since the factory keys its cache by name.
std::string skeletonName(int handle) { return "es_db_" + std::to_string(handle); }

/**
 * Re-reads the posed slots into the batch list.
 *
 * Slots come back in the order the armature keeps them, which is z-order after an
 * advanceTime — so painter order is the walk order and needs no sort here.
 */
void extractBatches(int instanceId) {
    g_ctx.batches.clear();
    auto* armature = g_ctx.armatureOf(instanceId);
    if (!armature) return;

    es::skeletal::BatchCollector collector(g_ctx.batches);
    for (auto* slot : armature->getSlots()) {
        static_cast<EsSlot*>(slot)->emit(collector, 1.0f);
    }
}

}  // namespace

extern "C" {

// =============================================================================
// Resources
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int db_loadSkeleton(uintptr_t skeletonPtr, int skeletonLen, uintptr_t atlasPtr, int atlasLen) {
    g_ctx.lastError.clear();
    if (skeletonPtr == 0 || skeletonLen <= 0 || atlasPtr == 0 || atlasLen <= 0) {
        g_ctx.lastError = "empty skeleton or atlas data";
        return -1;
    }

    // Both arrive as bytes and both parsers want a C string, so they are copied
    // rather than cast: the caller's buffer carries no terminator.
    const std::string skeletonText(reinterpret_cast<const char*>(skeletonPtr),
                                   static_cast<std::size_t>(skeletonLen));
    const std::string atlasText(reinterpret_cast<const char*>(atlasPtr), static_cast<std::size_t>(atlasLen));

    const int handle = g_ctx.skeletons.add(LoadedSkeleton{});
    auto* held = g_ctx.skeletons.find(handle);
    held->name = skeletonName(handle);

    auto& factory = EsFactory::instance();
    held->data = factory.parseDragonBonesData(skeletonText.c_str(), held->name, 1.0f);
    if (held->data == nullptr) {
        g_ctx.lastError = "skeleton data could not be parsed";
        g_ctx.skeletons.erase(handle);
        return -1;
    }

    held->atlas = static_cast<EsTextureAtlasData*>(
        factory.parseTextureAtlasData(atlasText.c_str(), nullptr, held->name, 1.0f));
    if (held->atlas == nullptr) {
        g_ctx.lastError = "texture atlas data could not be parsed";
        factory.removeDragonBonesData(held->name);
        g_ctx.skeletons.erase(handle);
        return -1;
    }
    return handle;
}

EMSCRIPTEN_KEEPALIVE
const char* db_getLastError() { return g_ctx.strings.publish(g_ctx.lastError.c_str()); }

EMSCRIPTEN_KEEPALIVE
void db_unloadSkeleton(int handle) {
    auto* held = g_ctx.skeletons.find(handle);
    if (!held) return;

    // Instances hold this data; they go first, or their next update reads freed memory.
    g_ctx.instances.eraseIf([handle](LiveInstance& live) {
        if (live.skeletonHandle != handle) return false;
        if (live.armature) live.armature->dispose();
        return true;
    });

    auto& factory = EsFactory::instance();
    factory.removeTextureAtlasData(held->name);
    factory.removeDragonBonesData(held->name);
    g_ctx.skeletons.erase(handle);
}

/// `["armatureA","armatureB"]` — a DragonBones file names more than one.
EMSCRIPTEN_KEEPALIVE
const char* db_getArmatures(int handle) {
    auto* held = g_ctx.skeletons.find(handle);
    if (!held || !held->data) return g_ctx.strings.publish("[]");
    const auto& names = held->data->armatureNames;
    return g_ctx.strings.publishArray(static_cast<int>(names.size()),
                                      [&names](int i) { return names[static_cast<std::size_t>(i)].c_str(); });
}

/// The image this file's atlas expects, so the caller knows what to upload.
EMSCRIPTEN_KEEPALIVE
const char* db_getAtlasImageName(int handle) {
    auto* held = g_ctx.skeletons.find(handle);
    return g_ctx.strings.publish(held && held->atlas ? held->atlas->imagePath.c_str() : "");
}

EMSCRIPTEN_KEEPALIVE
void db_setAtlasTexture(int handle, uint32_t textureId) {
    auto* held = g_ctx.skeletons.find(handle);
    if (!held || !held->atlas) return;
    held->atlas->setTexture(textureId);

    // Slots rebuild their geometry only when DragonBones thinks the display
    // changed, and binding a texture is not something it watches. Without this an
    // instance created before the upload finished would stay empty forever — and
    // the upload finishing last is the normal order, not the unusual one.
    g_ctx.instances.eraseIf([handle](LiveInstance& live) {
        if (live.skeletonHandle == handle && live.armature) live.armature->invalidUpdate("", true);
        return false;
    });
}

// =============================================================================
// Instances
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int db_createInstance(int skeletonHandle, const char* armatureName) {
    auto* held = g_ctx.skeletons.find(skeletonHandle);
    if (!held) {
        g_ctx.lastError = "no such skeleton";
        return -1;
    }
    auto* armature = EsFactory::instance().buildArmature(armatureName ? armatureName : "", held->name);
    if (armature == nullptr) {
        g_ctx.lastError = "no such armature in this skeleton";
        return -1;
    }
    return g_ctx.instances.add(LiveInstance{armature, skeletonHandle});
}

EMSCRIPTEN_KEEPALIVE
void db_destroyInstance(int instanceId) {
    auto* live = g_ctx.instances.find(instanceId);
    if (!live) return;
    if (live->armature) live->armature->dispose();
    g_ctx.instances.erase(instanceId);
}

// =============================================================================
// Animation
// =============================================================================

/// `playTimes`: -1 keeps what the data says, 0 loops, n plays n times.
EMSCRIPTEN_KEEPALIVE
int db_playAnimation(int instanceId, const char* name, int playTimes) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (!armature) return 0;
    return armature->getAnimation()->play(name ? name : "", playTimes) != nullptr ? 1 : 0;
}

/// Where Spine would set a mix duration: DragonBones fades at the moment of play.
EMSCRIPTEN_KEEPALIVE
int db_fadeInAnimation(int instanceId, const char* name, float fadeSeconds, int playTimes) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (!armature) return 0;
    return armature->getAnimation()->fadeIn(name ? name : "", fadeSeconds, playTimes) != nullptr ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void db_stopAnimation(int instanceId, const char* name) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (armature) armature->getAnimation()->stop(name ? name : "");
}

EMSCRIPTEN_KEEPALIVE
void db_setTimeScale(int instanceId, float scale) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (armature) armature->getAnimation()->timeScale = scale;
}

EMSCRIPTEN_KEEPALIVE
void db_update(int instanceId, float dt) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (!armature) return;
    g_ctx.events.clear();
    armature->advanceTime(dt);
}

EMSCRIPTEN_KEEPALIVE
const char* db_getAnimations(int instanceId) {
    auto* armature = g_ctx.armatureOf(instanceId);
    if (!armature) return g_ctx.strings.publish("[]");
    const auto& names = armature->getAnimation()->getAnimationNames();
    return g_ctx.strings.publishArray(static_cast<int>(names.size()),
                                      [&names](int i) { return names[static_cast<std::size_t>(i)].c_str(); });
}

// =============================================================================
// Geometry readback
// =============================================================================

// Posing happens HERE, not in update: one batch list serves every instance, so it
// has to belong to whichever one is being read right now. Extracting in update
// instead leaves it holding the last instance updated — and every getter below
// would then answer for that one however carefully it was asked about another.
EMSCRIPTEN_KEEPALIVE
int db_getMeshBatchCount(int instanceId) {
    extractBatches(instanceId);
    return static_cast<int>(g_ctx.batches.size());
}

EMSCRIPTEN_KEEPALIVE
int db_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return 0;
    return static_cast<int>(g_ctx.batches[batchIndex].vertices.size() / es::skeletal::VERTEX_FLOATS);
}

EMSCRIPTEN_KEEPALIVE
int db_getMeshBatchIndexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return 0;
    return static_cast<int>(g_ctx.batches[batchIndex].indices.size());
}

EMSCRIPTEN_KEEPALIVE
void db_getMeshBatchData(int instanceId, int batchIndex, uintptr_t outVerticesPtr, uintptr_t outIndicesPtr,
                         uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.batches.size())) return;

    const es::skeletal::MeshBatch& batch = g_ctx.batches[batchIndex];
    std::memcpy(reinterpret_cast<float*>(outVerticesPtr), batch.vertices.data(),
                batch.vertices.size() * sizeof(float));
    std::memcpy(reinterpret_cast<uint16_t*>(outIndicesPtr), batch.indices.data(),
                batch.indices.size() * sizeof(uint16_t));
    *reinterpret_cast<uint32_t*>(outTextureIdPtr) = batch.texture;
    *reinterpret_cast<int32_t*>(outBlendModePtr) = batch.blendMode;
}

EMSCRIPTEN_KEEPALIVE
void db_getBounds(int instanceId, uintptr_t outXPtr, uintptr_t outYPtr, uintptr_t outWPtr, uintptr_t outHPtr) {
    // Derived from the posed batches rather than asked of the runtime: DragonBones
    // reports an armature's authored bounds, which is not where it currently is.
    extractBatches(instanceId);
    float minX = 0.0f, minY = 0.0f, maxX = 0.0f, maxY = 0.0f;
    bool any = false;
    for (const auto& batch : g_ctx.batches) {
        for (std::size_t i = 0; i < batch.vertices.size(); i += es::skeletal::VERTEX_FLOATS) {
            const float x = batch.vertices[i];
            const float y = batch.vertices[i + 1];
            if (!any) {
                minX = maxX = x;
                minY = maxY = y;
                any = true;
                continue;
            }
            minX = x < minX ? x : minX;
            maxX = x > maxX ? x : maxX;
            minY = y < minY ? y : minY;
            maxY = y > maxY ? y : maxY;
        }
    }
    *reinterpret_cast<float*>(outXPtr) = minX;
    *reinterpret_cast<float*>(outYPtr) = minY;
    *reinterpret_cast<float*>(outWPtr) = maxX - minX;
    *reinterpret_cast<float*>(outHPtr) = maxY - minY;
}

/// 5 — the DragonBones data format this runtime reads, for the SDK's version gate.
EMSCRIPTEN_KEEPALIVE
int db_runtimeVersion() { return 5; }

}  // extern "C"
