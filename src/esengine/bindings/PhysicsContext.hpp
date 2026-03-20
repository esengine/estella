#pragma once

#include <emscripten.h>

#include <box2d/box2d.h>

#include <unordered_map>
#include <vector>
#include <cstdint>
#include <cstring>

static constexpr int MAX_PHYSICS_STEPS_PER_FRAME = 8;
static constexpr int RAYCAST_STRIDE = 6;
static constexpr int MAX_RAYCAST_HITS = 64;
static constexpr int MAX_OVERLAP_HITS = 64;
static constexpr int SHAPECAST_STRIDE = 6;

struct PhysicsContext {
    b2WorldId worldId = b2_nullWorldId;
    float fixedTimestep = 1.0f / 60.0f;
    int subStepCount = 4;
    float accumulator = 0.0f;

    std::unordered_map<uint32_t, b2BodyId> entityToBody;
    std::unordered_map<uint32_t, std::vector<b2ShapeId>> entityToShapes;
    std::unordered_map<uint32_t, b2JointId> entityToJoint;
    std::vector<uint32_t> dynamicBodyEntities;

    std::vector<float> dynamicTransformBuffer;

    std::vector<float> collisionEnterBuffer;
    std::vector<float> collisionExitBuffer;
    std::vector<float> sensorEnterBuffer;
    std::vector<float> sensorExitBuffer;

    float velocityBuffer[2] = {};
    float gravityBuffer[2] = {};

    void reset() {
        entityToBody.clear();
        entityToShapes.clear();
        entityToJoint.clear();
        dynamicBodyEntities.clear();
        dynamicTransformBuffer.clear();
        collisionEnterBuffer.clear();
        collisionExitBuffer.clear();
        sensorEnterBuffer.clear();
        sensorExitBuffer.clear();
        accumulator = 0.0f;

        if (b2World_IsValid(worldId)) {
            b2DestroyWorld(worldId);
        }
        worldId = b2_nullWorldId;
    }
};

extern PhysicsContext g_ctx;

extern std::vector<float> g_raycastBuffer;
extern std::vector<float> g_overlapBuffer;
extern std::vector<float> g_shapeCastBuffer;
extern float g_massDataBuffer[2];

b2BodyId findValidBody(uint32_t entityId);
b2JointId findValidJoint(uint32_t entityId);
uint32_t entityFromBody(b2BodyId bodyId);
uint32_t entityFromShape(b2ShapeId shapeId);
void pushEntityBits(std::vector<float>& buf, uint32_t entityId);
