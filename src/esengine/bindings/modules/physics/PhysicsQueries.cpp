// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./PhysicsContext.hpp"

#include <cfloat>
#include <cstring>

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
static constexpr int MAX_MOVER_HITS = 4;
// How far a one-way surface's normal must lean to the solid side for a contact to count. Above zero, so the side of a platform walked
// past is not a wall.
static constexpr float MOVER_ONE_WAY_ALIGN = 0.5f;
// Metres a mover may be sunk into a one-way surface and still stand on it: what the skin and the solver leave behind.
static constexpr float MOVER_ONE_WAY_SLOP = 0.02f;

static constexpr uint32_t MOVER_DROP_THROUGH = 1u;
static constexpr uint32_t MOVER_IGNORE_DYNAMIC = 2u;
static constexpr uint32_t MOVER_BLOCK_STEEP = 4u;
static constexpr uint32_t MOVER_WAS_ON_FLOOR = 8u;

static b2CollisionPlane g_moverPlanes[MAX_MOVER_PLANES];
static uint32_t g_moverPlaneEntity[MAX_MOVER_PLANES];
static bool g_moverPlaneSurface[MAX_MOVER_PLANES];
static int g_moverPlaneCount = 0;
static uint32_t g_moverSelfEntity = 0xFFFFFFFF;
static uint32_t g_moverFlags = 0;
// The move's own velocity and how far it could fall, against which a one-way surface is judged.
static b2Vec2 g_moverVelocity = {0.0f, 0.0f};
static float g_moverDt = 0.0f;
// The record physics_moveCharacter writes: see physics_moveCharacterBytes.
static float g_moverBuffer[11 + MAX_MOVER_HITS * 3] = {};
static uint32_t g_moverHitEntity[MAX_MOVER_HITS];
static b2Vec2 g_moverHitNormal[MAX_MOVER_HITS];
static int g_moverHitCount = 0;

/** A one-way surface answers only from its solid side, while what meets it is not rising, and not once it is already inside it. */
static bool oneWayAdmits(b2ShapeId shapeId, uint32_t entity, b2Vec2 normal, float depth) {
    const auto it = g_ctx.oneWayNormals.find(entity);
    if (it == g_ctx.oneWayNormals.end()) return true;
    if (g_moverFlags & MOVER_DROP_THROUGH) return false;
    const b2Vec2 solid = it->second.localSpace
        ? b2RotateVector(b2Body_GetRotation(b2Shape_GetBody(shapeId)), it->second.normal)
        : it->second.normal;
    if (b2Dot(normal, solid) <= MOVER_ONE_WAY_ALIGN) return false;
    const float along = b2Dot(g_moverVelocity, solid);
    // A fall lands inside a thin surface before the mover looks at it, so a step's worth of fall still counts as landing on it.
    return depth <= MOVER_ONE_WAY_SLOP - along * g_moverDt;
}

/**
 * Whether a contact's normal is the surface's own. A rounded foot on the corner of a ledge gets a leaning normal off no slope at all, and
 * a ray along it tells them apart: it lands on a face, and only a real slope's face leans.
 */
static bool normalIsSurface(b2ShapeId shapeId, const b2PlaneResult* pr) {
    b2RayCastInput ray;
    ray.origin = b2MulAdd(pr->point, 0.05f, pr->plane.normal);
    ray.translation = b2MulSV(-0.1f, pr->plane.normal);
    ray.maxFraction = 1.0f;
    const b2CastOutput hit = b2Shape_RayCast(shapeId, &ray);
    return hit.hit && b2Dot(hit.normal, pr->plane.normal) > 0.999f;
}

static bool moverPlaneCallback(b2ShapeId shapeId, const b2PlaneResult* pr, void* context) {
    (void)context;
    if (!pr->hit) return true;
    const uint32_t entity = entityFromShape(shapeId);
    // Never collide the mover with its own body (entity filter — robust regardless
    // of the collision-category setup).
    if (entity == g_moverSelfEntity) return true;
    // A trigger is walked through: it reports an overlap, and blocks nothing.
    if (b2Shape_IsSensor(shapeId)) return true;
    const bool dynamic = b2Body_GetType(b2Shape_GetBody(shapeId)) == b2_dynamicBody;
    if (dynamic && (g_moverFlags & MOVER_IGNORE_DYNAMIC)) return true;
    if (!oneWayAdmits(shapeId, entity, pr->plane.normal, pr->plane.offset)) return true;
    if (dynamic && g_moverHitCount < MAX_MOVER_HITS) {
        bool known = false;
        for (int i = 0; i < g_moverHitCount; ++i) known = known || g_moverHitEntity[i] == entity;
        if (!known) {
            g_moverHitEntity[g_moverHitCount] = entity;
            g_moverHitNormal[g_moverHitCount++] = pr->plane.normal;
        }
    }
    if (g_moverPlaneCount < MAX_MOVER_PLANES) {
        g_moverPlaneEntity[g_moverPlaneCount] = entity;
        g_moverPlaneSurface[g_moverPlaneCount] = (g_moverFlags & MOVER_BLOCK_STEEP) != 0 && normalIsSurface(shapeId, pr);
        g_moverPlanes[g_moverPlaneCount].plane = pr->plane;
        g_moverPlanes[g_moverPlaneCount].pushLimit = FLT_MAX;
        g_moverPlanes[g_moverPlaneCount].push = 0.0f;
        g_moverPlanes[g_moverPlaneCount].clipVelocity = true;
        g_moverPlaneCount++;
    }
    return true;
}

// Floor-snap down-probe: tracks the closest floor-classified hit (excluding self).
// Returns 1.0 for every hit so the cast evaluates all shapes; the closest floor is
// kept manually rather than via cast clipping (a nearer wall must not hide a floor).
static float g_snapClosest = 1.0f;
static b2Vec2 g_snapNormal = {0.0f, 0.0f};
static uint32_t g_snapEntity = 0xFFFFFFFF;
static bool g_snapHit = false;
static b2Vec2 g_snapUp = {0.0f, 1.0f};
static float g_snapFloorCos = 0.0f;

static float snapCastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context) {
    (void)point;
    (void)context;
    const uint32_t entity = entityFromShape(shapeId);
    if (entity == g_moverSelfEntity || b2Shape_IsSensor(shapeId)) return 1.0f;
    if ((g_moverFlags & MOVER_IGNORE_DYNAMIC) && b2Body_GetType(b2Shape_GetBody(shapeId)) == b2_dynamicBody) return 1.0f;
    if (!oneWayAdmits(shapeId, entity, normal, 0.0f)) return 1.0f;
    float d = normal.x * g_snapUp.x + normal.y * g_snapUp.y;
    if (d >= g_snapFloorCos && fraction < g_snapClosest) {
        g_snapClosest = fraction;
        g_snapNormal = normal;
        g_snapEntity = entity;
        g_snapHit = true;
    }
    return 1.0f;
}

// How far a cast up gets before something overhead stops it, for a mover stepping over a ledge.
static float g_headroom = 1.0f;

static float headroomCastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal, float fraction, void* context) {
    (void)point;
    (void)context;
    const uint32_t entity = entityFromShape(shapeId);
    if (entity == g_moverSelfEntity || b2Shape_IsSensor(shapeId)) return 1.0f;
    if (g_ctx.oneWayNormals.count(entity) != 0) return 1.0f;
    // It is already touching the ledge and the floor, and a cast starting in touch reports them with no normal. Only what faces down is overhead.
    if (b2Dot(normal, g_snapUp) > -0.1f) return 1.0f;
    if ((g_moverFlags & MOVER_IGNORE_DYNAMIC) && b2Body_GetType(b2Shape_GetBody(shapeId)) == b2_dynamicBody) return 1.0f;
    if (fraction < g_headroom) g_headroom = fraction;
    return 1.0f;
}

namespace {

/** The mover's capsule and the query it sweeps with, the same for every part of one move. */
struct MoverShape {
    b2Vec2 c1, c2;
    float radius;
    b2QueryFilter filter;
    int slides;
};

b2Capsule capsuleAt(const MoverShape& shape, b2Vec2 pos) {
    b2Capsule capsule;
    capsule.center1 = b2Add(pos, shape.c1);
    capsule.center2 = b2Add(pos, shape.c2);
    capsule.radius = shape.radius;
    return capsule;
}

b2ShapeProxy proxyAt(const MoverShape& shape, b2Vec2 pos, b2Vec2 points[2]) {
    points[0] = b2Add(pos, shape.c1);
    points[1] = b2Add(pos, shape.c2);
    return b2MakeProxy(points, 2, shape.radius);
}

/** A slope too steep to stand on is a wall to walk into: what is left of the move is whatever does not press into it. */
b2Vec2 withoutClimbing(b2Vec2 delta, b2Vec2 up, float floorCos) {
    for (int i = 0; i < g_moverPlaneCount; ++i) {
        const b2Vec2 n = g_moverPlanes[i].plane.normal;
        const float d = b2Dot(n, up);
        if (d <= 0.0f || d >= floorCos || !g_moverPlaneSurface[i]) continue;
        const b2Vec2 across = b2Normalize(b2Sub(n, b2MulSV(d, up)));
        const float into = b2Dot(delta, across);
        if (into < 0.0f) delta = b2Sub(delta, b2MulSV(into, across));
    }
    return delta;
}

/** Collide and slide from `pos` towards `target`, leaving the last contacts in the plane list. */
b2Vec2 solveMove(const MoverShape& shape, b2Vec2 pos, b2Vec2 target, b2Vec2 up, float floorCos) {
    const float tolerance = 0.001f;
    for (int iteration = 0; iteration < shape.slides; ++iteration) {
        g_moverPlaneCount = 0;
        b2Capsule mover = capsuleAt(shape, pos);
        b2World_CollideMover(g_ctx.worldId, &mover, shape.filter, moverPlaneCallback, nullptr);
        if (g_moverFlags & MOVER_BLOCK_STEEP) target = b2Add(pos, withoutClimbing(b2Sub(target, pos), up, floorCos));
        b2PlaneSolverResult result = b2SolvePlanes(b2Sub(target, pos), g_moverPlanes, g_moverPlaneCount);
        pos = b2Add(pos, result.translation);
        if (b2LengthSquared(result.translation) < tolerance * tolerance) break;
    }
    return pos;
}

struct StepResult { bool stepped; b2Vec2 pos; b2Vec2 normal; uint32_t floor; };

/** Over a ledge no higher than `height`: up, across what the wall took from the move, and down onto floor. Refused for anything short of that. */
StepResult stepOver(const MoverShape& shape, b2Vec2 pos, b2Vec2 left, b2Vec2 up, float floorCos, float height) {
    StepResult out{false, pos, {0.0f, 0.0f}, 0xFFFFFFFF};
    b2Vec2 points[2];
    g_headroom = 1.0f;
    b2ShapeProxy proxy = proxyAt(shape, pos, points);
    b2World_CastShape(g_ctx.worldId, &proxy, b2MulSV(height, up), shape.filter, headroomCastCallback, nullptr);
    const float rise = height * g_headroom;
    if (rise <= 0.001f) return out;

    const b2Vec2 raised = b2Add(pos, b2MulSV(rise, up));
    const b2Vec2 across = solveMove(shape, raised, b2Add(raised, left), up, floorCos);
    const float leftLength = b2Length(left);
    if (b2Dot(b2Sub(across, raised), left) <= 0.25f * leftLength * leftLength) return out;

    // A foot only just over the edge lands on the corner, whose normal leans: anything that holds it up from below will do.
    g_snapClosest = 1.0f;
    g_snapHit = false;
    g_snapFloorCos = 0.01f;
    proxy = proxyAt(shape, across, points);
    const b2Vec2 down = b2MulSV(-rise, up);
    b2World_CastShape(g_ctx.worldId, &proxy, down, shape.filter, snapCastCallback, nullptr);
    g_snapFloorCos = floorCos;
    if (!g_snapHit) return out;
    out.stepped = true;
    out.pos = b2Add(across, b2MulSV(g_snapClosest, down));
    out.normal = up;
    out.floor = g_snapEntity;
    return out;
}

}  // namespace

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

// Move a capsule character one step, in meters. `carryX/Y` moves it with what it stands on, apart from its own velocity.
// Writes [dx, dy, velX, velY, onFloor, onWall, onCeiling, floorNx, floorNy, floorEntityBits, hitCount, (entityBits, nx, ny) * 4]
// and returns 1, or 0 if the world is gone.
EMSCRIPTEN_KEEPALIVE
int physics_moveCharacter(float px, float py, float c1x, float c1y, float c2x, float c2y, float radius,
                          float velX, float velY, float dt, float upX, float upY, float floorCos,
                          uint32_t maskBits, uint32_t selfEntity,
                          float skinWidth, int maxSlides, float snapLength, int slideOnCeiling,
                          float carryX, float carryY, uint32_t flags, float stepHeight) {
    if (!b2World_IsValid(g_ctx.worldId)) return 0;
    g_moverSelfEntity = selfEntity;
    g_moverFlags = flags;
    g_moverVelocity = {velX, velY};
    g_moverDt = dt;
    g_moverHitCount = 0;

    b2Vec2 pos = {px, py};
    b2Vec2 up = {upX, upY};
    b2Vec2 start = pos;
    b2Vec2 target = {px + (velX + carryX) * dt, py + (velY + carryY) * dt};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.maskBits = static_cast<uint64_t>(maskBits);

    // skinWidth keeps the capsule a small margin off surfaces (less jitter, no
    // visual overlap) — a slightly larger collision radius does exactly that.
    MoverShape shape{{c1x, c1y}, {c2x, c2y}, radius + (skinWidth > 0.0f ? skinWidth : 0.0f), filter, maxSlides > 0 ? maxSlides : 1};

    pos = solveMove(shape, pos, target, up, floorCos);

    b2Vec2 vel = {velX, velY};
    // Clipped as it is, the speed walked into a steep slope turns into climbing it on the next move.
    if (flags & MOVER_BLOCK_STEEP) vel = withoutClimbing(vel, up, floorCos);
    b2Vec2 newVel = b2ClipVector(vel, g_moverPlanes, g_moverPlaneCount);

    // Classify the final contact planes against the up axis.
    bool onFloor = false, onWall = false, onCeiling = false;
    float fnx = 0.0f, fny = 0.0f;
    uint32_t floorEntity = 0xFFFFFFFF;
    for (int i = 0; i < g_moverPlaneCount; ++i) {
        b2Vec2 n = g_moverPlanes[i].plane.normal;
        float d = n.x * upX + n.y * upY;
        if (d >= floorCos) { onFloor = true; fnx = n.x; fny = n.y; floorEntity = g_moverPlaneEntity[i]; }
        else if (d <= -floorCos) { onCeiling = true; }
        else { onWall = true; }
    }

    // slideOnCeiling=false: a ceiling hit cancels the upward velocity instead of
    // sliding along it, so the character drops straight back down.
    if (onCeiling && slideOnCeiling == 0) {
        float vUp = newVel.x * upX + newVel.y * upY;
        if (vUp > 0.0f) { newVel.x -= vUp * upX; newVel.y -= vUp * upY; }
    }

    g_snapUp = up;
    g_snapFloorCos = floorCos;

    // A ledge low enough to step over stops a walking character only for this contact: its own walking
    // goes on, and neither a jump nor a fall steps up onto anything.
    if (stepHeight > 0.0f && onWall && (flags & MOVER_WAS_ON_FLOOR) != 0 && b2Dot(vel, up) <= 0.01f) {
        const b2Vec2 wanted = b2Sub(target, start);
        const b2Vec2 along = b2Sub(wanted, b2MulSV(b2Dot(wanted, up), up));
        const float length = b2Length(along);
        if (length > 0.0001f) {
            const b2Vec2 direction = b2MulSV(1.0f / length, along);
            const float remaining = length - b2Dot(b2Sub(pos, start), direction);
            if (remaining > 0.0001f) {
                const StepResult step = stepOver(shape, pos, b2MulSV(remaining, direction), up, floorCos, stepHeight);
                if (step.stepped) {
                    pos = step.pos;
                    onFloor = true;
                    onWall = false;
                    fnx = step.normal.x;
                    fny = step.normal.y;
                    floorEntity = step.floor;
                    newVel = vel;
                    const float vn = b2Dot(newVel, step.normal);
                    if (vn < 0.0f) newVel = b2Sub(newVel, b2MulSV(vn, step.normal));
                }
            }
        }
    }

    // Floor snap: when not rising and not already grounded, probe down up to
    // snapLength and stick to a floor within reach, so the character stays glued to
    // descending stairs/slopes instead of launching off each ledge.
    if (snapLength > 0.0f && !onFloor) {
        float vUp = newVel.x * upX + newVel.y * upY;
        if (vUp <= 0.01f) {
            g_snapClosest = 1.0f;
            g_snapHit = false;
            b2Vec2 pts[2];
            b2ShapeProxy proxy = proxyAt(shape, pos, pts);
            b2Vec2 down = {-upX * snapLength, -upY * snapLength};
            b2World_CastShape(g_ctx.worldId, &proxy, down, filter, snapCastCallback, nullptr);
            if (g_snapHit) {
                pos = b2Add(pos, {down.x * g_snapClosest, down.y * g_snapClosest});
                onFloor = true;
                fnx = g_snapNormal.x;
                fny = g_snapNormal.y;
                floorEntity = g_snapEntity;
                float vn = newVel.x * g_snapNormal.x + newVel.y * g_snapNormal.y;
                if (vn < 0.0f) { newVel.x -= vn * g_snapNormal.x; newVel.y -= vn * g_snapNormal.y; }
            }
        }
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
    std::memcpy(&g_moverBuffer[9], &floorEntity, sizeof(uint32_t));
    g_moverBuffer[10] = static_cast<float>(g_moverHitCount);
    for (int i = 0; i < g_moverHitCount; ++i) {
        std::memcpy(&g_moverBuffer[11 + i * 3], &g_moverHitEntity[i], sizeof(uint32_t));
        g_moverBuffer[12 + i * 3] = g_moverHitNormal[i].x;
        g_moverBuffer[13 + i * 3] = g_moverHitNormal[i].y;
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t physics_getMoveCharacterBuffer() {
    return reinterpret_cast<uintptr_t>(g_moverBuffer);
}

} // extern "C"
