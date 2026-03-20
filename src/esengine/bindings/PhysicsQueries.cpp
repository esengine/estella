#include "PhysicsContext.hpp"

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

} // extern "C"
