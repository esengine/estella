// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineBindings.hpp
 * @brief   The Spine runtime's entry points, declared once for both platforms.
 * @details Spine is plain C over spine-c: load a skeleton + atlas, drive animation
 *          state, and hand back mesh batches the engine's renderer submits. On the web
 *          it links as a per-version wasm side module (spine38 / spine41 / spine42,
 *          which is how one editor opens projects authored against different Spine
 *          releases); a native app compiles ONE of those runtimes into the host binary
 *          and reaches it through the QuickJS wrappers EHT generates from here — the
 *          three vendored runtimes export the same symbol names, so only one can link.
 *          `spine_runtimeVersion` is how the SDK asks which one it got.
 *
 *          Names (animations, skins, slots, constraints) cross as strings; vertex,
 *          index and event data cross as offsets into the caller's heap — wasm linear
 *          memory on the web, the host arena on a device.
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

int spine_loadSkeleton(uintptr_t skelDataPtr, int skelDataLen, const char* atlasText, int atlasLen, int isBinary);
const char* spine_getLastError();
void spine_unloadSkeleton(int handle);
int spine_getAtlasPageCount(int handle);
const char* spine_getAtlasPageTextureName(int handle, int pageIndex);
void spine_setAtlasPageTexture(int handle, int pageIndex, uint32_t textureId, int width, int height);
int spine_createInstance(int skeletonHandle);
void spine_destroyInstance(int instanceId);
int spine_playAnimation(int instanceId, const char* name, int loop, int track);
int spine_addAnimation(int instanceId, const char* name, int loop, float delay, int track);
void spine_setSkin(int instanceId, const char* name);
void spine_update(int instanceId, float dt);
const char* spine_getAnimations(int instanceId);
const char* spine_getSkins(int instanceId);
int spine_getBonePosition(int instanceId, const char* bone, uintptr_t outXPtr, uintptr_t outYPtr);
float spine_getBoneRotation(int instanceId, const char* bone);
void spine_getBounds(int instanceId, uintptr_t outXPtr, uintptr_t outYPtr, uintptr_t outWPtr, uintptr_t outHPtr);
int spine_getMeshBatchCount(int instanceId);
int spine_getMeshBatchVertexCount(int instanceId, int batchIndex);
int spine_getMeshBatchIndexCount(int instanceId, int batchIndex);
void spine_getMeshBatchData(int instanceId, int batchIndex, uintptr_t outVerticesPtr, uintptr_t outIndicesPtr, uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr);
void spine_setClippingEnabled(int enabled);
void spine_setDefaultMix(int skeletonHandle, float duration);
void spine_setMixDuration(int skeletonHandle, const char* fromAnim, const char* toAnim, float duration);
void spine_setTrackAlpha(int instanceId, int track, float alpha);
void spine_enableEvents(int instanceId);
int spine_getEventCount(int instanceId);
// @heapreturn spine_eventBufferBytes()
uintptr_t spine_getEventBuffer();
void spine_clearEvents();
const char* spine_getEventAnimationName(int index);
const char* spine_getEventName(int index);
const char* spine_getEventStringValue(int index);
int spine_setAttachment(int instanceId, const char* slotName, const char* attachmentName);
int spine_setIKTarget(int instanceId, const char* constraintName, float targetX, float targetY, float mix);
const char* spine_listConstraints(int instanceId);
const char* spine_getTransformConstraintMix(int instanceId, const char* name);
int spine_setTransformConstraintMix(int instanceId, const char* name, float rotate, float x, float y, float scaleX, float scaleY, float shearY);
const char* spine_getPathConstraintMix(int instanceId, const char* name);
int spine_setPathConstraintMix(int instanceId, const char* name, float position, float spacing, float rotate, float x, float y);
int spine_setSlotColor(int instanceId, const char* slotName, float r, float g, float b, float a);
int spine_setSkeletonColor(int instanceId, float r, float g, float b, float a);

// Which Spine runtime this build linked (38 / 41 / 42). The web ships one module per
// version and names the artifact; a native host has room for one, so it says which —
// and the SDK's acquirer answers that version's id only.
int spine_runtimeVersion();

// How many bytes the last event collection published, for the readback above. The
// buffer is the module's own vector, so only the module can say how much is live.
size_t spine_eventBufferBytes();

}  // extern "C"
