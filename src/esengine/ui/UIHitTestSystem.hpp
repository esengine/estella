// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UIHitTestSystem.hpp
 * @brief   Pure geometric helpers used by UISystem hit-test
 * @details State and update entry point moved to UISystem (UISystem.hpp).
 *          This header only exposes the reusable inline math helpers.
 */
#pragma once

#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIMask.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace esengine::ecs {

inline f32 quaternionToAngle2D(f32 rz, f32 rw) {
    return 2.0f * std::atan2(rz, rw);
}

inline bool pointInOBB(
    f32 px, f32 py,
    f32 worldX, f32 worldY,
    f32 worldW, f32 worldH,
    f32 pivotX, f32 pivotY,
    f32 rotationZ, f32 rotationW
) {
    f32 angle = quaternionToAngle2D(rotationZ, rotationW);
    f32 sinA = std::sin(-angle);
    f32 cosA = std::cos(-angle);

    f32 dx = px - worldX;
    f32 dy = py - worldY;
    f32 localX = dx * cosA - dy * sinA + worldX;
    f32 localY = dx * sinA + dy * cosA + worldY;

    f32 left = worldX - worldW * pivotX;
    f32 right = worldX + worldW * (1.0f - pivotX);
    f32 bottom = worldY - worldH * pivotY;
    f32 top = worldY + worldH * (1.0f - pivotY);

    return localX >= left && localX <= right && localY >= bottom && localY <= top;
}

/**
 * A pointer, as the ray it is rather than a point on one plane. Orthographically
 * every plane the ray crosses gives the same x/y, so the flat case is this one's
 * degenerate form; under perspective they differ, and a point cannot serve.
 */
struct PickRay {
    glm::vec3 origin{0.0f, 0.0f, 0.0f};
    glm::vec3 dir{0.0f, 0.0f, -1.0f};
};

/**
 * Where @p ray crosses the plane z = @p planeZ, and how far along the ray that
 * is. False when the two are parallel: a plane seen exactly edge-on is a plane
 * the pointer never reaches, and answering with a position would invent one.
 */
inline bool rayHitsPlaneZ(const PickRay& ray, f32 planeZ, f32& outX, f32& outY, f32& outT) {
    if (std::abs(ray.dir.z) <= 1e-9f) return false;
    const f32 t = (planeZ - ray.origin.z) / ray.dir.z;
    if (t < 0.0f) return false;  // behind the viewer
    outX = ray.origin.x + ray.dir.x * t;
    outY = ray.origin.y + ray.dir.y * t;
    outT = t;
    return true;
}

/**
 * @p ray against a box in an entity's own frame — a slab test, after folding the
 * entity's rotation and translation out of the ray.
 *
 * @details Scale folds into the BOX, not out of the ray: zero would divide by
 *          zero and negative flips rather than shrinks, hence min/max after it.
 */
inline bool rayHitsOBB(const PickRay& ray,
                       const glm::vec3& centre, const glm::quat& rotation,
                       const glm::vec3& scale,
                       const glm::vec3& localMin, const glm::vec3& localMax,
                       f32& outT) {
    const glm::quat inverse = glm::conjugate(glm::normalize(rotation));
    const glm::vec3 origin = inverse * (ray.origin - centre);
    const glm::vec3 dir = inverse * ray.dir;

    const glm::vec3 a = localMin * scale;
    const glm::vec3 b = localMax * scale;
    const glm::vec3 lo = glm::min(a, b);
    const glm::vec3 hi = glm::max(a, b);

    // Not `near`/`far`: both are macros in the Windows headers the native host
    // pulls in, and a slab test that stops compiling on one platform is worse
    // than two duller names.
    f32 enter = 0.0f;
    f32 exit = std::numeric_limits<f32>::max();
    for (int axis = 0; axis < 3; ++axis) {
        if (std::abs(dir[axis]) <= 1e-9f) {
            // Parallel to this pair of slabs: it can only ever be inside them.
            if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return false;
            continue;
        }
        f32 t0 = (lo[axis] - origin[axis]) / dir[axis];
        f32 t1 = (hi[axis] - origin[axis]) / dir[axis];
        if (t0 > t1) std::swap(t0, t1);
        enter = std::max(enter, t0);
        exit = std::min(exit, t1);
        if (enter > exit) return false;
    }
    outT = enter;
    return true;
}

inline bool isClippedByMask(
    Registry& registry,
    Entity entity,
    f32 worldMouseX,
    f32 worldMouseY
) {
    Entity current = entity;
    while (registry.has<Parent>(current)) {
        Entity ancestor = registry.get<Parent>(current).entity;
        if (!registry.valid(ancestor)) break;

        auto* mask = registry.tryGet<UIMask>(ancestor);
        if (mask && mask->enabled) {
            auto* t = registry.tryGet<Transform>(ancestor);
            auto* node = registry.tryGet<UINode>(ancestor);
            if (t && node) {
                t->ensureDecomposed();
                // UINode mask box is pivot-centered.
                if (!pointInOBB(
                    worldMouseX, worldMouseY,
                    t->worldPosition.x, t->worldPosition.y,
                    node->computed_size_.x * t->worldScale.x,
                    node->computed_size_.y * t->worldScale.y,
                    0.5f, 0.5f,
                    t->worldRotation.z, t->worldRotation.w
                )) {
                    return true;
                }
            }
        }
        current = ancestor;
    }
    return false;
}

}  // namespace esengine::ecs
