// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DragonBonesBindings.hpp
 * @brief   The DragonBones module's exported ABI, declared apart from its bodies.
 *
 * @details The web reaches these through embind; a native host reaches them
 *          through QuickJS wrappers EHT generates from THIS header. Declaring them
 *          here rather than inline in the entry is what makes the second path
 *          exist at all — a module whose ABI lives only in its .cpp links into the
 *          host and cannot be called from it.
 *
 *          `@heapreturn` marks an entry point that writes through a pointer the
 *          caller allocated, so the generator knows to marshal rather than return.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstddef>
#include <cstdint>

extern "C" {

// — Resources ——————————————————————————————————————————————————————————————
int db_loadSkeleton(uintptr_t skeletonPtr, int skeletonLen, uintptr_t atlasPtr, int atlasLen);
const char* db_getLastError();
void db_unloadSkeleton(int handle);
/** `["armatureA","armatureB"]` — a DragonBones file names more than one. */
const char* db_getArmatures(int handle);
const char* db_getAtlasImageName(int handle);
void db_setAtlasTexture(int handle, uint32_t textureId);

// — Instances ——————————————————————————————————————————————————————————————
int db_createInstance(int skeletonHandle, const char* armatureName);
void db_destroyInstance(int instanceId);

// — Animation ——————————————————————————————————————————————————————————————
/** `playTimes`: -1 keeps what the data says, 0 loops, n plays n times. */
int db_playAnimation(int instanceId, const char* name, int playTimes);
/** Where Spine would set a mix duration: DragonBones fades at the moment of play. */
int db_fadeInAnimation(int instanceId, const char* name, float fadeSeconds, int playTimes);
void db_stopAnimation(int instanceId, const char* name);
void db_setTimeScale(int instanceId, float scale);
void db_update(int instanceId, float dt);
const char* db_getAnimations(int instanceId);

// — Geometry readback ——————————————————————————————————————————————————————
int db_getMeshBatchCount(int instanceId);
int db_getMeshBatchVertexCount(int instanceId, int batchIndex);
int db_getMeshBatchIndexCount(int instanceId, int batchIndex);
/** @heapreturn outVerticesPtr, outIndicesPtr, outTextureIdPtr, outBlendModePtr */
void db_getMeshBatchData(int instanceId, int batchIndex, uintptr_t outVerticesPtr, uintptr_t outIndicesPtr,
                         uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr);
/** @heapreturn outXPtr, outYPtr, outWPtr, outHPtr */
void db_getBounds(int instanceId, uintptr_t outXPtr, uintptr_t outYPtr, uintptr_t outWPtr, uintptr_t outHPtr);
/** The DragonBones data format this runtime reads, for the SDK's version gate. */
int db_runtimeVersion();

}  // extern "C"
