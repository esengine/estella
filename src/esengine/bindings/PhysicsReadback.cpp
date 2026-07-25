// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsReadback.cpp
 * @brief   How many bytes each readback getter published.
 * @details The module's getters hand back a pointer to memory the module owns — a
 *          vector it refills each step, a fixed array a query writes into. On the web
 *          the caller reads that memory directly out of the shared heap, so nobody
 *          had to state its length; a native host has to COPY it into the heap the
 *          SDK reads, and copying a count times an assumed stride would over-read the
 *          very frame a body was disabled (the transform buffer skips those) or a
 *          query found fewer hits than the previous one left behind.
 *
 *          So the module says. These are the `@heapreturn` expressions in
 *          PhysicsBindings.hpp, and they are the only reason a native wrapper needs
 *          no hand-written copy of its own.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "PhysicsContext.hpp"
#include "PhysicsBindings.hpp"

namespace {
size_t floatBytes(const std::vector<float>& buffer) {
    return buffer.size() * sizeof(float);
}
}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE size_t physics_dynamicBodyTransformsBytes() {
    return floatBytes(g_ctx.dynamicTransformBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_interpolatedTransformsBytes() {
    return floatBytes(g_ctx.poseInterpolated);
}

EMSCRIPTEN_KEEPALIVE size_t physics_collisionEnterBytes() {
    return floatBytes(g_ctx.collisionEnterBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_collisionExitBytes() {
    return floatBytes(g_ctx.collisionExitBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_sensorEnterBytes() {
    return floatBytes(g_ctx.sensorEnterBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_sensorExitBytes() {
    return floatBytes(g_ctx.sensorExitBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_hitEventBytes() {
    return floatBytes(g_ctx.hitEventBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_raycastBytes() {
    return floatBytes(g_raycastBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_overlapBytes() {
    return floatBytes(g_overlapBuffer);
}

EMSCRIPTEN_KEEPALIVE size_t physics_shapeCastBytes() {
    return floatBytes(g_shapeCastBuffer);
}

// The character mover writes a fixed record (position delta, ground normal, flags),
// so its whole extent is always live — see physics_moveCharacter.
EMSCRIPTEN_KEEPALIVE size_t physics_moveCharacterBytes() {
    return 9 * sizeof(float);
}

}  // extern "C"
