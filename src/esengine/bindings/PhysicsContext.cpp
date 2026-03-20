#include "PhysicsContext.hpp"

PhysicsContext g_ctx;

std::vector<float> g_raycastBuffer;
std::vector<float> g_overlapBuffer;
std::vector<float> g_shapeCastBuffer;
float g_massDataBuffer[2] = {};

b2JointId findValidJoint(uint32_t entityId) {
    auto it = g_ctx.entityToJoint.find(entityId);
    if (it == g_ctx.entityToJoint.end()) return b2_nullJointId;
    if (!b2Joint_IsValid(it->second)) return b2_nullJointId;
    return it->second;
}

b2BodyId findValidBody(uint32_t entityId) {
    auto it = g_ctx.entityToBody.find(entityId);
    if (it == g_ctx.entityToBody.end()) return b2_nullBodyId;
    if (!b2Body_IsValid(it->second)) return b2_nullBodyId;
    return it->second;
}

uint32_t entityFromBody(b2BodyId bodyId) {
    void* ud = b2Body_GetUserData(bodyId);
    if (!ud) return 0xFFFFFFFF;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ud));
}

uint32_t entityFromShape(b2ShapeId shapeId) {
    b2BodyId bodyId = b2Shape_GetBody(shapeId);
    return entityFromBody(bodyId);
}

void pushEntityBits(std::vector<float>& buf, uint32_t entityId) {
    float bits;
    std::memcpy(&bits, &entityId, sizeof(float));
    buf.push_back(bits);
}
