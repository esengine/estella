// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "PhysicsContext.hpp"

#include <cfloat>

static float raycastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context) {
    if (g_raycastBuffer.size() / RAYCAST_STRIDE >= MAX_RAYCAST_HITS) return 0.0f;

    uint32_t entityId = entityFromShape(shapeId);
    if (entityId == 0xFFFFFFFF) return 1.0f;

    pushEntityBits(g_raycastBuffer, entityId);
    g_raycastBuffer.push_back(point.x);
    g_raycastBuffer.push_back(point.y);
    g_raycastBuffer.push_back(normal.x);
    g_raycastBuffer.push_back(normal.y);
    g_raycastBuffer.push_back(fraction);

    return 1.0f;
}

static bool overlapCallback(b2ShapeId shapeId, void* context) {
    if (g_overlapBuffer.size() >= MAX_OVERLAP_HITS) return false;

    uint32_t entityId = entityFromShape(shapeId);
    if (entityId == 0xFFFFFFFF) return true;

    pushEntityBits(g_overlapBuffer, entityId);
    return true;
}

static float shapeCastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context) {
    if (g_shapeCastBuffer.size() / SHAPECAST_STRIDE >= MAX_RAYCAST_HITS) return 0.0f;

    uint32_t entityId = entityFromShape(shapeId);
    if (entityId == 0xFFFFFFFF) return 1.0f;

    pushEntityBits(g_shapeCastBuffer, entityId);
    g_shapeCastBuffer.push_back(point.x);
    g_shapeCastBuffer.push_back(point.y);
    g_shapeCastBuffer.push_back(normal.x);
    g_shapeCastBuffer.push_back(normal.y);
    g_shapeCastBuffer.push_back(fraction);

    return 1.0f;
}

// —— Kinematic character mover (Box2D v3 native: CollideMover + SolvePlanes) ——
// The generic shape cast reports a resting/touching contact as fraction 0 with a
// zero normal, which stalls a hand-rolled move-and-slide. The mover collides the
// capsule against the world into *planes* (each with a valid normal) and solves a
// depenetrating slide — the intended path for characters standing on ground.
static constexpr int MAX_MOVER_PLANES = 32;
static b2CollisionPlane g_moverPlanes[MAX_MOVER_PLANES];
static int g_moverPlaneCount = 0;
static uint32_t g_moverSelfEntity = 0xFFFFFFFF;
static float g_moverBuffer[9] = {};

static bool moverPlaneCallback(b2ShapeId shapeId, const b2PlaneResult* pr, void* context) {
    (void)context;
    if (!pr->hit) return true;
    // Never collide the mover with its own body (entity filter — robust regardless
    // of the collision-category setup).
    if (entityFromShape(shapeId) == g_moverSelfEntity) return true;
    if (g_moverPlaneCount < MAX_MOVER_PLANES) {
        g_moverPlanes[g_moverPlaneCount].plane = pr->plane;
        g_moverPlanes[g_moverPlaneCount].pushLimit = FLT_MAX;
        g_moverPlanes[g_moverPlaneCount].push = 0.0f;
        g_moverPlanes[g_moverPlaneCount].clipVelocity = true;
        g_moverPlaneCount++;
    }
    return true;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
int physics_raycast(float originX, float originY, float dirX, float dirY,
                    float maxDistance, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_raycastBuffer.clear();

    b2Vec2 origin = {originX, originY};
    b2Vec2 translation = {dirX * maxDistance, dirY * maxDistance};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_CastRay(g_ctx.worldId, origin, translation, filter, raycastCallback, nullptr);

    return static_cast<int>(g_raycastBuffer.size() / RAYCAST_STRIDE);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getRaycastBuffer() {
    return reinterpret_cast<uintptr_t>(g_raycastBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_overlapCircle(float centerX, float centerY, float radius, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_overlapBuffer.clear();

    b2Vec2 center = {centerX, centerY};
    b2ShapeProxy proxy = b2MakeProxy(&center, 1, radius);

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_OverlapShape(g_ctx.worldId, &proxy, filter, overlapCallback, nullptr);

    return static_cast<int>(g_overlapBuffer.size());
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getOverlapBuffer() {
    return reinterpret_cast<uintptr_t>(g_overlapBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_shapeCastCircle(float centerX, float centerY, float radius,
                            float translationX, float translationY, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_shapeCastBuffer.clear();

    b2Vec2 center = {centerX, centerY};
    b2ShapeProxy proxy = b2MakeProxy(&center, 1, radius);
    b2Vec2 translation = {translationX, translationY};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_CastShape(g_ctx.worldId, &proxy, translation, filter, shapeCastCallback, nullptr);

    return static_cast<int>(g_shapeCastBuffer.size() / SHAPECAST_STRIDE);
}

EMSCRIPTEN_KEEPALIVE
int physics_shapeCastBox(float centerX, float centerY, float halfW, float halfH, float angle,
                         float translationX, float translationY, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_shapeCastBuffer.clear();

    b2Polygon box = b2MakeOffsetBox(halfW, halfH, {centerX, centerY}, b2MakeRot(angle));
    b2ShapeProxy proxy = b2MakeProxy(box.vertices, box.count, box.radius);
    b2Vec2 translation = {translationX, translationY};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_CastShape(g_ctx.worldId, &proxy, translation, filter, shapeCastCallback, nullptr);

    return static_cast<int>(g_shapeCastBuffer.size() / SHAPECAST_STRIDE);
}

EMSCRIPTEN_KEEPALIVE
int physics_shapeCastCapsule(float center1X, float center1Y, float center2X, float center2Y,
                             float radius, float translationX, float translationY, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_shapeCastBuffer.clear();

    b2Vec2 centers[2] = {{center1X, center1Y}, {center2X, center2Y}};
    b2ShapeProxy proxy = b2MakeProxy(centers, 2, radius);
    b2Vec2 translation = {translationX, translationY};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_CastShape(g_ctx.worldId, &proxy, translation, filter, shapeCastCallback, nullptr);

    return static_cast<int>(g_shapeCastBuffer.size() / SHAPECAST_STRIDE);
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getShapeCastBuffer() {
    return reinterpret_cast<uintptr_t>(g_shapeCastBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
int physics_overlapAABB(float minX, float minY, float maxX, float maxY, uint32_t maskBits) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;

    g_overlapBuffer.clear();

    b2AABB aabb = {{minX, minY}, {maxX, maxY}};
    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    b2World_OverlapAABB(g_ctx.worldId, aabb, filter, overlapCallback, nullptr);

    return static_cast<int>(g_overlapBuffer.size());
}

// Move a capsule character one step. All lengths are meters (the JS wrapper scales
// px⇄m). Writes the result buffer [dx, dy, velX, velY, onFloor, onWall, onCeiling,
// floorNx, floorNy] and returns 1 on success (0 if the world is gone).
EMSCRIPTEN_KEEPALIVE
int physics_moveCharacter(float px, float py, float c1x, float c1y, float c2x, float c2y, float radius,
                          float velX, float velY, float dt, float upX, float upY, float floorCos,
                          uint32_t maskBits, uint32_t selfEntity) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;
    g_moverSelfEntity = selfEntity;

    b2Vec2 pos = {px, py};
    b2Vec2 up = {upX, upY};
    b2Vec2 target = {px + velX * dt, py + velY * dt};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    const float tolerance = 0.001f;
    for (int iteration = 0; iteration < 5; ++iteration) {
        g_moverPlaneCount = 0;
        b2Capsule mover;
        mover.center1 = {pos.x + c1x, pos.y + c1y};
        mover.center2 = {pos.x + c2x, pos.y + c2y};
        mover.radius = radius;
        b2World_CollideMover(g_ctx.worldId, &mover, filter, moverPlaneCallback, nullptr);
        b2PlaneSolverResult result = b2SolvePlanes(b2Sub(target, pos), g_moverPlanes, g_moverPlaneCount);
        pos = b2Add(pos, result.translation);
        if (b2LengthSquared(result.translation) < tolerance * tolerance) break;
    }

    b2Vec2 vel = {velX, velY};
    b2Vec2 newVel = b2ClipVector(vel, g_moverPlanes, g_moverPlaneCount);

    // Classify the final contact planes against the up axis.
    bool onFloor = false, onWall = false, onCeiling = false;
    float fnx = 0.0f, fny = 0.0f;
    for (int i = 0; i < g_moverPlaneCount; ++i) {
        b2Vec2 n = g_moverPlanes[i].plane.normal;
        float d = n.x * upX + n.y * upY;
        if (d >= floorCos) { onFloor = true; fnx = n.x; fny = n.y; }
        else if (d <= -floorCos) { onCeiling = true; }
        else { onWall = true; }
    }

    g_moverBuffer[0] = pos.x - px;
    g_moverBuffer[1] = pos.y - py;
    g_moverBuffer[2] = newVel.x;
    g_moverBuffer[3] = newVel.y;
    g_moverBuffer[4] = onFloor ? 1.0f : 0.0f;
    g_moverBuffer[5] = onWall ? 1.0f : 0.0f;
    g_moverBuffer[6] = onCeiling ? 1.0f : 0.0f;
    g_moverBuffer[7] = fnx;
    g_moverBuffer[8] = fny;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getMoveCharacterBuffer() {
    return reinterpret_cast<uintptr_t>(g_moverBuffer);
}

} // extern "C"
