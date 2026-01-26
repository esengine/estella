/**
 * @file    TransformGizmo.cpp
 * @brief   Transform gizmo implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "TransformGizmo.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../renderer/RenderCommand.hpp"
#include "../../core/Log.hpp"

namespace esengine::editor {

namespace {

constexpr f32 AXIS_LENGTH = 1.0f;
constexpr f32 ARROW_HEAD_SIZE = 0.15f;
constexpr f32 HIT_THRESHOLD = 0.1f;

glm::vec4 getAxisColor(GizmoAxis axis, GizmoAxis activeAxis) {
    bool isActive = (axis == activeAxis);
    f32 brightness = isActive ? 1.0f : 0.7f;

    switch (axis) {
        case GizmoAxis::X:
            return glm::vec4(1.0f, 0.0f, 0.0f, 1.0f) * brightness;
        case GizmoAxis::Y:
            return glm::vec4(0.0f, 1.0f, 0.0f, 1.0f) * brightness;
        case GizmoAxis::Z:
            return glm::vec4(0.0f, 0.0f, 1.0f, 1.0f) * brightness;
        default:
            return glm::vec4(1.0f, 1.0f, 1.0f, 1.0f);
    }
}

}  // namespace

// =============================================================================
// Rendering
// =============================================================================

void TransformGizmo::render(const glm::mat4& view, const glm::mat4& proj,
                            Entity entity, ecs::Registry& registry) {
    if (!registry.valid(entity) || !registry.has<ecs::LocalTransform>(entity)) {
        return;
    }

    const auto& transform = registry.get<ecs::LocalTransform>(entity);
    gizmoPosition_ = transform.position;

    glm::mat4 mvp = proj * view;

    switch (mode_) {
        case GizmoMode::Translate:
            renderTranslateGizmo(mvp, gizmoPosition_);
            break;
        case GizmoMode::Rotate:
            renderRotateGizmo(mvp, gizmoPosition_);
            break;
        case GizmoMode::Scale:
            renderScaleGizmo(mvp, gizmoPosition_);
            break;
    }
}

void TransformGizmo::renderTranslateGizmo(const glm::mat4& mvp, const glm::vec3& position) {
    f32 axisLength = AXIS_LENGTH * size_;

    renderArrow(mvp, position, glm::vec3(1, 0, 0), axisLength,
                getAxisColor(GizmoAxis::X, activeAxis_));
    renderArrow(mvp, position, glm::vec3(0, 1, 0), axisLength,
                getAxisColor(GizmoAxis::Y, activeAxis_));
    renderArrow(mvp, position, glm::vec3(0, 0, 1), axisLength,
                getAxisColor(GizmoAxis::Z, activeAxis_));
}

void TransformGizmo::renderRotateGizmo(const glm::mat4& mvp, const glm::vec3& position) {
    f32 radius = AXIS_LENGTH * size_;

    renderCircle(mvp, position, glm::vec3(1, 0, 0), radius,
                 getAxisColor(GizmoAxis::X, activeAxis_));
    renderCircle(mvp, position, glm::vec3(0, 1, 0), radius,
                 getAxisColor(GizmoAxis::Y, activeAxis_));
    renderCircle(mvp, position, glm::vec3(0, 0, 1), radius,
                 getAxisColor(GizmoAxis::Z, activeAxis_));
}

void TransformGizmo::renderScaleGizmo(const glm::mat4& mvp, const glm::vec3& position) {
    f32 axisLength = AXIS_LENGTH * size_;

    renderAxis(mvp, position, position + glm::vec3(axisLength, 0, 0),
               getAxisColor(GizmoAxis::X, activeAxis_));
    renderAxis(mvp, position, position + glm::vec3(0, axisLength, 0),
               getAxisColor(GizmoAxis::Y, activeAxis_));
    renderAxis(mvp, position, position + glm::vec3(0, 0, axisLength),
               getAxisColor(GizmoAxis::Z, activeAxis_));
}

void TransformGizmo::renderAxis(const glm::mat4& mvp, const glm::vec3& start,
                                const glm::vec3& end, const glm::vec4& color) {
}

void TransformGizmo::renderArrow(const glm::mat4& mvp, const glm::vec3& start,
                                 const glm::vec3& dir, f32 length, const glm::vec4& color) {
    glm::vec3 end = start + dir * length;
    renderAxis(mvp, start, end, color);
}

void TransformGizmo::renderCircle(const glm::mat4& mvp, const glm::vec3& center,
                                  const glm::vec3& normal, f32 radius, const glm::vec4& color) {
}

// =============================================================================
// Interaction
// =============================================================================

GizmoAxis TransformGizmo::hitTest(const glm::vec3& rayOrigin, const glm::vec3& rayDir) const {
    if (mode_ != GizmoMode::Translate) {
        return GizmoAxis::None;
    }

    f32 axisLength = AXIS_LENGTH * size_;
    f32 minDist = std::numeric_limits<f32>::max();
    GizmoAxis closestAxis = GizmoAxis::None;

    f32 distX = rayAxisDistance(rayOrigin, rayDir, gizmoPosition_, glm::vec3(1, 0, 0));
    if (distX < HIT_THRESHOLD && distX < minDist) {
        minDist = distX;
        closestAxis = GizmoAxis::X;
    }

    f32 distY = rayAxisDistance(rayOrigin, rayDir, gizmoPosition_, glm::vec3(0, 1, 0));
    if (distY < HIT_THRESHOLD && distY < minDist) {
        minDist = distY;
        closestAxis = GizmoAxis::Y;
    }

    f32 distZ = rayAxisDistance(rayOrigin, rayDir, gizmoPosition_, glm::vec3(0, 0, 1));
    if (distZ < HIT_THRESHOLD && distZ < minDist) {
        minDist = distZ;
        closestAxis = GizmoAxis::Z;
    }

    return closestAxis;
}

void TransformGizmo::startDrag(GizmoAxis axis, const glm::vec3& hitPoint) {
    activeAxis_ = axis;
    dragging_ = true;
    dragStartPoint_ = hitPoint;
}

glm::vec3 TransformGizmo::updateDrag(const glm::vec3& rayOrigin, const glm::vec3& rayDir) {
    if (!dragging_ || activeAxis_ == GizmoAxis::None) {
        return glm::vec3(0.0f);
    }

    glm::vec3 axisDir(0.0f);
    switch (activeAxis_) {
        case GizmoAxis::X: axisDir = glm::vec3(1, 0, 0); break;
        case GizmoAxis::Y: axisDir = glm::vec3(0, 1, 0); break;
        case GizmoAxis::Z: axisDir = glm::vec3(0, 0, 1); break;
        default: return glm::vec3(0.0f);
    }

    glm::vec3 planeNormal = glm::cross(axisDir, glm::cross(rayDir, axisDir));
    if (glm::length(planeNormal) < 0.001f) {
        return glm::vec3(0.0f);
    }
    planeNormal = glm::normalize(planeNormal);

    f32 denom = glm::dot(rayDir, planeNormal);
    if (std::abs(denom) < 0.001f) {
        return glm::vec3(0.0f);
    }

    f32 t = glm::dot(dragStartPoint_ - rayOrigin, planeNormal) / denom;
    glm::vec3 hitPoint = rayOrigin + rayDir * t;

    glm::vec3 delta = hitPoint - dragStartPoint_;
    f32 projection = glm::dot(delta, axisDir);

    return axisDir * projection;
}

void TransformGizmo::endDrag() {
    dragging_ = false;
    activeAxis_ = GizmoAxis::None;
}

// =============================================================================
// Private Methods
// =============================================================================

f32 TransformGizmo::rayAxisDistance(const glm::vec3& rayOrigin, const glm::vec3& rayDir,
                                    const glm::vec3& axisOrigin, const glm::vec3& axisDir) const {
    glm::vec3 w0 = rayOrigin - axisOrigin;
    f32 a = glm::dot(rayDir, rayDir);
    f32 b = glm::dot(rayDir, axisDir);
    f32 c = glm::dot(axisDir, axisDir);
    f32 d = glm::dot(rayDir, w0);
    f32 e = glm::dot(axisDir, w0);

    f32 denom = a * c - b * b;
    if (std::abs(denom) < 0.001f) {
        return std::numeric_limits<f32>::max();
    }

    f32 sc = (b * e - c * d) / denom;
    f32 tc = (a * e - b * d) / denom;

    if (tc < 0.0f || tc > AXIS_LENGTH * size_) {
        return std::numeric_limits<f32>::max();
    }

    glm::vec3 closestPointOnRay = rayOrigin + rayDir * sc;
    glm::vec3 closestPointOnAxis = axisOrigin + axisDir * tc;

    return glm::length(closestPointOnRay - closestPointOnAxis);
}

}  // namespace esengine::editor
