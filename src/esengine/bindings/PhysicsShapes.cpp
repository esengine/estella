// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "PhysicsContext.hpp"

extern "C" {

EMSCRIPTEN_KEEPALIVE
void physics_addBoxShape(uint32_t entityId, float halfW, float halfH,
                         float offX, float offY, float radius,
                         float density, float friction, float restitution, int isSensor,
                         uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableHitEvents = true;
    shapeDef.enableSensorEvents = true; // Box2D v3: a sensor only detects a visitor whose shape also enables sensor events.
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Polygon polygon;
    if (radius > 0.0f) {
        float innerHalfW = halfW > radius ? halfW - radius : 0.0f;
        float innerHalfH = halfH > radius ? halfH - radius : 0.0f;
        polygon = b2MakeOffsetRoundedBox(innerHalfW, innerHalfH, {offX, offY}, b2MakeRot(0.0f), radius);
    } else {
        polygon = b2MakeOffsetBox(halfW, halfH, {offX, offY}, b2MakeRot(0.0f));
    }
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addCircleShape(uint32_t entityId, float radius,
                            float offX, float offY,
                            float density, float friction, float restitution, int isSensor,
                            uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableHitEvents = true;
    shapeDef.enableSensorEvents = true; // Box2D v3: a sensor only detects a visitor whose shape also enables sensor events.
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Circle circle;
    circle.center = {offX, offY};
    circle.radius = radius;

    b2ShapeId shapeId = b2CreateCircleShape(it->second, &shapeDef, &circle);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addCapsuleShape(uint32_t entityId, float radius, float halfHeight,
                             float offX, float offY,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableHitEvents = true;
    shapeDef.enableSensorEvents = true; // Box2D v3: a sensor only detects a visitor whose shape also enables sensor events.
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Capsule capsule;
    capsule.center1 = {offX, offY + halfHeight};
    capsule.center2 = {offX, offY - halfHeight};
    capsule.radius = radius;

    b2ShapeId shapeId = b2CreateCapsuleShape(it->second, &shapeDef, &capsule);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addSegmentShape(uint32_t entityId, float x1, float y1, float x2, float y2,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableHitEvents = true;
    shapeDef.enableSensorEvents = true; // Box2D v3: a sensor only detects a visitor whose shape also enables sensor events.
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2Segment segment;
    segment.point1 = {x1, y1};
    segment.point2 = {x2, y2};

    b2ShapeId shapeId = b2CreateSegmentShape(it->second, &shapeDef, &segment);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addPolygonShape(uint32_t entityId, uintptr_t verticesPtr, int vertexCount, float radius,
                             float density, float friction, float restitution, int isSensor,
                             uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (vertexCount < 3 || vertexCount > B2_MAX_POLYGON_VERTICES) return;

    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.material.friction = friction;
    shapeDef.material.restitution = restitution;
    shapeDef.isSensor = isSensor != 0;
    shapeDef.enableContactEvents = true;
    shapeDef.enableHitEvents = true;
    shapeDef.enableSensorEvents = true; // Box2D v3: a sensor only detects a visitor whose shape also enables sensor events.
    shapeDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    shapeDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    auto* floats = reinterpret_cast<float*>(verticesPtr);
    b2Vec2 points[B2_MAX_POLYGON_VERTICES];
    for (int i = 0; i < vertexCount; i++) {
        points[i] = {floats[i * 2], floats[i * 2 + 1]};
    }

    b2Hull hull = b2ComputeHull(points, vertexCount);
    if (hull.count == 0) return;

    b2Polygon polygon = (radius > 0.0f)
        ? b2MakePolygon(&hull, radius)
        : b2MakePolygon(&hull, 0.0f);
    b2ShapeId shapeId = b2CreatePolygonShape(it->second, &shapeDef, &polygon);
    g_ctx.entityToShapes[entityId].push_back(shapeId);
}

EMSCRIPTEN_KEEPALIVE
void physics_addChainShape(uint32_t entityId, uintptr_t pointsPtr, int pointCount, int isLoop,
                           float friction, float restitution,
                           uint32_t categoryBits, uint32_t maskBits) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return;
    if (pointCount < 4) return;

    auto* floats = reinterpret_cast<float*>(pointsPtr);
    std::vector<b2Vec2> points(pointCount);
    for (int i = 0; i < pointCount; i++) {
        points[i] = {floats[i * 2], floats[i * 2 + 1]};
    }

    b2SurfaceMaterial material = b2DefaultSurfaceMaterial();
    material.friction = friction;
    material.restitution = restitution;

    b2ChainDef chainDef = b2DefaultChainDef();
    chainDef.points = points.data();
    chainDef.count = pointCount;
    chainDef.isLoop = isLoop != 0;
    chainDef.materials = &material;
    chainDef.materialCount = 1;
    chainDef.filter.categoryBits = static_cast<uint64_t>(categoryBits);
    chainDef.filter.maskBits = static_cast<uint64_t>(maskBits);

    b2CreateChain(it->second, &chainDef);
}

// Destroy all of an entity's shapes while KEEPING the body, so the reconciler can
// rebuild colliders in place (velocity, pose, contacts-elsewhere, and joints are
// preserved — far cheaper and less disruptive than destroying the whole body).
// Chain shapes (b2CreateChain) aren't tracked in entityToShapes and so aren't
// cleared here; chains are static level geometry and aren't runtime-rebuilt.
EMSCRIPTEN_KEEPALIVE
void physics_clearShapes(uint32_t entityId) {
    auto it = g_ctx.entityToShapes.find(entityId);
    if (it == g_ctx.entityToShapes.end()) return;
    for (b2ShapeId shapeId : it->second) {
        if (b2Shape_IsValid(shapeId)) {
            b2DestroyShape(shapeId, false); // mass is recomputed when shapes are re-added
        }
    }
    it->second.clear();
}

} // extern "C"
