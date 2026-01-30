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
#include <glad/glad.h>

namespace esengine::editor {

namespace {

constexpr f32 AXIS_LENGTH = 1.0f;
constexpr f32 ARROW_HEAD_SIZE = 0.15f;
constexpr f32 HIT_THRESHOLD = 0.1f;

glm::vec4 getAxisColor(GizmoAxis axis, GizmoAxis activeAxis, GizmoAxis hoveredAxis) {
    bool isActive = (axis == activeAxis);
    bool isHovered = (axis == hoveredAxis);

    if (isActive) {
        return glm::vec4(1.0f, 1.0f, 0.0f, 1.0f);
    }

    f32 brightness = isHovered ? 1.0f : 0.85f;

    switch (axis) {
        case GizmoAxis::X:
            return glm::vec4(0.9f, 0.2f, 0.2f, 1.0f) * brightness;
        case GizmoAxis::Y:
            return glm::vec4(0.3f, 0.85f, 0.3f, 1.0f) * brightness;
        case GizmoAxis::Z:
            return glm::vec4(0.3f, 0.5f, 0.95f, 1.0f) * brightness;
        default:
            return glm::vec4(1.0f, 1.0f, 1.0f, 1.0f);
    }
}

void addVertex(std::vector<f32>& vertices, const glm::vec3& pos, const glm::vec4& color) {
    vertices.insert(vertices.end(), {pos.x, pos.y, pos.z, color.r, color.g, color.b, color.a});
}

void addCone(std::vector<f32>& vertices, const glm::vec3& base, const glm::vec3& tip,
             f32 radius, const glm::vec4& color, i32 segments = 12) {
    glm::vec3 dir = glm::normalize(tip - base);
    glm::vec3 up = glm::abs(dir.y) < 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
    glm::vec3 right = glm::normalize(glm::cross(dir, up));
    up = glm::cross(right, dir);

    for (i32 i = 0; i < segments; ++i) {
        f32 angle1 = (f32(i) / segments) * glm::two_pi<f32>();
        f32 angle2 = (f32(i + 1) / segments) * glm::two_pi<f32>();

        glm::vec3 p1 = base + (right * glm::cos(angle1) + up * glm::sin(angle1)) * radius;
        glm::vec3 p2 = base + (right * glm::cos(angle2) + up * glm::sin(angle2)) * radius;

        addVertex(vertices, tip, color);
        addVertex(vertices, p1, color);
        addVertex(vertices, p2, color);

        addVertex(vertices, base, color);
        addVertex(vertices, p2, color);
        addVertex(vertices, p1, color);
    }
}

void addCylinder(std::vector<f32>& vertices, const glm::vec3& start, const glm::vec3& end,
                 f32 radius, const glm::vec4& color, i32 segments = 8) {
    glm::vec3 dir = glm::normalize(end - start);
    glm::vec3 up = glm::abs(dir.y) < 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
    glm::vec3 right = glm::normalize(glm::cross(dir, up));
    up = glm::cross(right, dir);

    for (i32 i = 0; i < segments; ++i) {
        f32 angle1 = (f32(i) / segments) * glm::two_pi<f32>();
        f32 angle2 = (f32(i + 1) / segments) * glm::two_pi<f32>();

        glm::vec3 offset1 = (right * glm::cos(angle1) + up * glm::sin(angle1)) * radius;
        glm::vec3 offset2 = (right * glm::cos(angle2) + up * glm::sin(angle2)) * radius;

        glm::vec3 s1 = start + offset1, s2 = start + offset2;
        glm::vec3 e1 = end + offset1, e2 = end + offset2;

        addVertex(vertices, s1, color);
        addVertex(vertices, e1, color);
        addVertex(vertices, e2, color);

        addVertex(vertices, s1, color);
        addVertex(vertices, e2, color);
        addVertex(vertices, s2, color);
    }
}

void addQuad(std::vector<f32>& vertices, const glm::vec3& p0, const glm::vec3& p1,
             const glm::vec3& p2, const glm::vec3& p3, const glm::vec4& color) {
    addVertex(vertices, p0, color);
    addVertex(vertices, p1, color);
    addVertex(vertices, p2, color);
    addVertex(vertices, p0, color);
    addVertex(vertices, p2, color);
    addVertex(vertices, p3, color);
}

void addCube(std::vector<f32>& vertices, const glm::vec3& center, f32 size, const glm::vec4& color) {
    f32 h = size * 0.5f;

    glm::vec3 corners[8] = {
        center + glm::vec3(-h, -h, -h), center + glm::vec3(h, -h, -h),
        center + glm::vec3(h, h, -h), center + glm::vec3(-h, h, -h),
        center + glm::vec3(-h, -h, h), center + glm::vec3(h, -h, h),
        center + glm::vec3(h, h, h), center + glm::vec3(-h, h, h)
    };

    auto addFace = [&](i32 a, i32 b, i32 c, i32 d) {
        addVertex(vertices, corners[a], color);
        addVertex(vertices, corners[b], color);
        addVertex(vertices, corners[c], color);
        addVertex(vertices, corners[a], color);
        addVertex(vertices, corners[c], color);
        addVertex(vertices, corners[d], color);
    };

    addFace(0, 1, 2, 3);
    addFace(5, 4, 7, 6);
    addFace(4, 0, 3, 7);
    addFace(1, 5, 6, 2);
    addFace(3, 2, 6, 7);
    addFace(4, 5, 1, 0);
}

void addCircle(std::vector<f32>& vertices, const glm::vec3& center, const glm::vec3& normal,
               f32 radius, const glm::vec4& color, i32 segments = 32, f32 thickness = 0.02f) {
    glm::vec3 up = glm::abs(normal.y) < 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
    glm::vec3 right = glm::normalize(glm::cross(normal, up));
    up = glm::normalize(glm::cross(right, normal));

    for (i32 i = 0; i < segments; ++i) {
        f32 angle1 = (f32(i) / segments) * glm::two_pi<f32>();
        f32 angle2 = (f32(i + 1) / segments) * glm::two_pi<f32>();

        glm::vec3 p1 = center + (right * glm::cos(angle1) + up * glm::sin(angle1)) * radius;
        glm::vec3 p2 = center + (right * glm::cos(angle2) + up * glm::sin(angle2)) * radius;

        glm::vec3 innerP1 = center + (right * glm::cos(angle1) + up * glm::sin(angle1)) * (radius - thickness);
        glm::vec3 innerP2 = center + (right * glm::cos(angle2) + up * glm::sin(angle2)) * (radius - thickness);

        addVertex(vertices, p1, color);
        addVertex(vertices, p2, color);
        addVertex(vertices, innerP2, color);

        addVertex(vertices, p1, color);
        addVertex(vertices, innerP2, color);
        addVertex(vertices, innerP1, color);
    }
}

}  // namespace

// =============================================================================
// Constructor
// =============================================================================

TransformGizmo::TransformGizmo(resource::ResourceManager& resourceManager)
    : resourceManager_(resourceManager) {}

// =============================================================================
// Initialization
// =============================================================================

void TransformGizmo::initRenderData() {
    if (initialized_) return;

    shaderHandle_ = resourceManager_.loadEngineShader("gizmo");

    VertexLayout gizmoLayout = {
        { ShaderDataType::Float3, "a_position" },
        { ShaderDataType::Float4, "a_color" }
    };

    // 3D geometry
    std::vector<f32> translateVerts;
    buildTranslateGeometry(translateVerts, false);
    translateVertexCount_ = static_cast<u32>(translateVerts.size() / 7);

    translateVAO_ = VertexArray::create();
    auto translateVBO = VertexBuffer::createRaw(translateVerts.data(),
        static_cast<u32>(translateVerts.size() * sizeof(f32)));
    translateVBO->setLayout(gizmoLayout);
    translateVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(translateVBO)));

    std::vector<f32> rotateVerts;
    buildRotateGeometry(rotateVerts, false);
    rotateVertexCount_ = static_cast<u32>(rotateVerts.size() / 7);

    rotateVAO_ = VertexArray::create();
    auto rotateVBO = VertexBuffer::createRaw(rotateVerts.data(),
        static_cast<u32>(rotateVerts.size() * sizeof(f32)));
    rotateVBO->setLayout(gizmoLayout);
    rotateVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(rotateVBO)));

    std::vector<f32> scaleVerts;
    buildScaleGeometry(scaleVerts, false);
    scaleVertexCount_ = static_cast<u32>(scaleVerts.size() / 7);

    scaleVAO_ = VertexArray::create();
    auto scaleVBO = VertexBuffer::createRaw(scaleVerts.data(),
        static_cast<u32>(scaleVerts.size() * sizeof(f32)));
    scaleVBO->setLayout(gizmoLayout);
    scaleVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(scaleVBO)));

    // 2D geometry
    std::vector<f32> translate2DVerts;
    buildTranslateGeometry(translate2DVerts, true);
    translate2DVertexCount_ = static_cast<u32>(translate2DVerts.size() / 7);

    translate2DVAO_ = VertexArray::create();
    auto translate2DVBO = VertexBuffer::createRaw(translate2DVerts.data(),
        static_cast<u32>(translate2DVerts.size() * sizeof(f32)));
    translate2DVBO->setLayout(gizmoLayout);
    translate2DVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(translate2DVBO)));

    std::vector<f32> rotate2DVerts;
    buildRotateGeometry(rotate2DVerts, true);
    rotate2DVertexCount_ = static_cast<u32>(rotate2DVerts.size() / 7);

    rotate2DVAO_ = VertexArray::create();
    auto rotate2DVBO = VertexBuffer::createRaw(rotate2DVerts.data(),
        static_cast<u32>(rotate2DVerts.size() * sizeof(f32)));
    rotate2DVBO->setLayout(gizmoLayout);
    rotate2DVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(rotate2DVBO)));

    std::vector<f32> scale2DVerts;
    buildScaleGeometry(scale2DVerts, true);
    scale2DVertexCount_ = static_cast<u32>(scale2DVerts.size() / 7);

    scale2DVAO_ = VertexArray::create();
    auto scale2DVBO = VertexBuffer::createRaw(scale2DVerts.data(),
        static_cast<u32>(scale2DVerts.size() * sizeof(f32)));
    scale2DVBO->setLayout(gizmoLayout);
    scale2DVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(scale2DVBO)));

    initialized_ = true;
}

void TransformGizmo::buildTranslateGeometry(std::vector<f32>& vertices, bool is2D) {
    glm::vec4 red(0.9f, 0.2f, 0.2f, 1.0f);
    glm::vec4 green(0.3f, 0.85f, 0.3f, 1.0f);
    glm::vec4 blue(0.3f, 0.5f, 0.95f, 1.0f);
    glm::vec4 yellow(0.9f, 0.9f, 0.2f, 0.6f);
    glm::vec4 cyan(0.2f, 0.9f, 0.9f, 0.6f);
    glm::vec4 magenta(0.9f, 0.2f, 0.9f, 0.6f);

    f32 shaftLen = 0.7f;
    f32 shaftRadius = 0.02f;
    f32 coneLen = 0.25f;
    f32 coneRadius = 0.06f;
    f32 planeOffset = 0.15f;
    f32 planeSize = 0.12f;

    addCylinder(vertices, glm::vec3(0), glm::vec3(shaftLen, 0, 0), shaftRadius, red);
    addCone(vertices, glm::vec3(shaftLen, 0, 0), glm::vec3(shaftLen + coneLen, 0, 0), coneRadius, red);

    addCylinder(vertices, glm::vec3(0), glm::vec3(0, shaftLen, 0), shaftRadius, green);
    addCone(vertices, glm::vec3(0, shaftLen, 0), glm::vec3(0, shaftLen + coneLen, 0), coneRadius, green);

    if (!is2D) {
        addCylinder(vertices, glm::vec3(0), glm::vec3(0, 0, shaftLen), shaftRadius, blue);
        addCone(vertices, glm::vec3(0, 0, shaftLen), glm::vec3(0, 0, shaftLen + coneLen), coneRadius, blue);
    }

    // XY plane handle (blue tint - Z normal)
    addQuad(vertices,
        glm::vec3(planeOffset, planeOffset, 0),
        glm::vec3(planeOffset + planeSize, planeOffset, 0),
        glm::vec3(planeOffset + planeSize, planeOffset + planeSize, 0),
        glm::vec3(planeOffset, planeOffset + planeSize, 0),
        blue * glm::vec4(1.0f, 1.0f, 1.0f, 0.5f));

    if (!is2D) {
        // YZ plane handle (red tint - X normal)
        addQuad(vertices,
            glm::vec3(0, planeOffset, planeOffset),
            glm::vec3(0, planeOffset + planeSize, planeOffset),
            glm::vec3(0, planeOffset + planeSize, planeOffset + planeSize),
            glm::vec3(0, planeOffset, planeOffset + planeSize),
            red * glm::vec4(1.0f, 1.0f, 1.0f, 0.5f));

        // XZ plane handle (green tint - Y normal)
        addQuad(vertices,
            glm::vec3(planeOffset, 0, planeOffset),
            glm::vec3(planeOffset, 0, planeOffset + planeSize),
            glm::vec3(planeOffset + planeSize, 0, planeOffset + planeSize),
            glm::vec3(planeOffset + planeSize, 0, planeOffset),
            green * glm::vec4(1.0f, 1.0f, 1.0f, 0.5f));
    }
}

void TransformGizmo::buildRotateGeometry(std::vector<f32>& vertices, bool is2D) {
    glm::vec4 red(0.9f, 0.2f, 0.2f, 1.0f);
    glm::vec4 green(0.3f, 0.85f, 0.3f, 1.0f);
    glm::vec4 blue(0.3f, 0.5f, 0.95f, 1.0f);

    f32 radius = 0.8f;
    f32 thickness = 0.03f;

    if (!is2D) {
        addCircle(vertices, glm::vec3(0), glm::vec3(1, 0, 0), radius, red, 48, thickness);
        addCircle(vertices, glm::vec3(0), glm::vec3(0, 1, 0), radius, green, 48, thickness);
    }
    addCircle(vertices, glm::vec3(0), glm::vec3(0, 0, 1), radius, blue, 48, thickness);
}

void TransformGizmo::buildScaleGeometry(std::vector<f32>& vertices, bool is2D) {
    glm::vec4 red(0.9f, 0.2f, 0.2f, 1.0f);
    glm::vec4 green(0.3f, 0.85f, 0.3f, 1.0f);
    glm::vec4 blue(0.3f, 0.5f, 0.95f, 1.0f);

    f32 shaftLen = 0.7f;
    f32 shaftRadius = 0.02f;
    f32 cubeSize = 0.1f;

    addCylinder(vertices, glm::vec3(0), glm::vec3(shaftLen, 0, 0), shaftRadius, red);
    addCube(vertices, glm::vec3(shaftLen + cubeSize * 0.5f, 0, 0), cubeSize, red);

    addCylinder(vertices, glm::vec3(0), glm::vec3(0, shaftLen, 0), shaftRadius, green);
    addCube(vertices, glm::vec3(0, shaftLen + cubeSize * 0.5f, 0), cubeSize, green);

    if (!is2D) {
        addCylinder(vertices, glm::vec3(0), glm::vec3(0, 0, shaftLen), shaftRadius, blue);
        addCube(vertices, glm::vec3(0, 0, shaftLen + cubeSize * 0.5f), cubeSize, blue);
    }
}

// =============================================================================
// Rendering
// =============================================================================

void TransformGizmo::render(const glm::mat4& view, const glm::mat4& proj,
                            Entity entity, ecs::Registry& registry) {
    if (!registry.valid(entity) || !registry.has<ecs::LocalTransform>(entity)) {
        return;
    }

    if (!initialized_) {
        initRenderData();
    }

    const auto& transform = registry.get<ecs::LocalTransform>(entity);
    gizmoPosition_ = transform.position;

    glm::mat4 viewProj = proj * view;
    glm::mat4 model = glm::translate(glm::mat4(1.0f), gizmoPosition_);
    model = glm::scale(model, glm::vec3(size_));

    switch (mode_) {
        case GizmoMode::Translate:
            renderTranslateGizmo(viewProj, model);
            break;
        case GizmoMode::Rotate:
            renderRotateGizmo(viewProj, model);
            break;
        case GizmoMode::Scale:
            renderScaleGizmo(viewProj, model);
            break;
    }
}

void TransformGizmo::renderTranslateGizmo(const glm::mat4& viewProj, const glm::mat4& model) {
    Shader* shader = resourceManager_.getShader(shaderHandle_);
    VertexArray* vao = is2DMode_ ? translate2DVAO_.get() : translateVAO_.get();
    u32 vertexCount = is2DMode_ ? translate2DVertexCount_ : translateVertexCount_;
    if (!vao || !shader) return;

    glDisable(GL_DEPTH_TEST);

    shader->bind();
    shader->setUniform("u_viewProj", viewProj);
    shader->setUniform("u_model", model);

    vao->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexCount));
    vao->unbind();

    shader->unbind();

    glEnable(GL_DEPTH_TEST);
}

void TransformGizmo::renderRotateGizmo(const glm::mat4& viewProj, const glm::mat4& model) {
    Shader* shader = resourceManager_.getShader(shaderHandle_);
    VertexArray* vao = is2DMode_ ? rotate2DVAO_.get() : rotateVAO_.get();
    u32 vertexCount = is2DMode_ ? rotate2DVertexCount_ : rotateVertexCount_;
    if (!vao || !shader) return;

    glDisable(GL_DEPTH_TEST);

    shader->bind();
    shader->setUniform("u_viewProj", viewProj);
    shader->setUniform("u_model", model);

    vao->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexCount));
    vao->unbind();

    shader->unbind();

    glEnable(GL_DEPTH_TEST);
}

void TransformGizmo::renderScaleGizmo(const glm::mat4& viewProj, const glm::mat4& model) {
    Shader* shader = resourceManager_.getShader(shaderHandle_);
    VertexArray* vao = is2DMode_ ? scale2DVAO_.get() : scaleVAO_.get();
    u32 vertexCount = is2DMode_ ? scale2DVertexCount_ : scaleVertexCount_;
    if (!vao || !shader) return;

    glDisable(GL_DEPTH_TEST);

    shader->bind();
    shader->setUniform("u_viewProj", viewProj);
    shader->setUniform("u_model", model);

    vao->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexCount));
    vao->unbind();

    shader->unbind();

    glEnable(GL_DEPTH_TEST);
}

void TransformGizmo::renderAxis(const glm::mat4& mvp, const glm::vec3& start,
                                const glm::vec3& end, const glm::vec4& color) {
    (void)mvp;
    (void)start;
    (void)end;
    (void)color;
}

void TransformGizmo::renderArrow(const glm::mat4& mvp, const glm::vec3& start,
                                 const glm::vec3& dir, f32 length, const glm::vec4& color) {
    (void)mvp;
    (void)start;
    (void)dir;
    (void)length;
    (void)color;
}

void TransformGizmo::renderCircle(const glm::mat4& mvp, const glm::vec3& center,
                                  const glm::vec3& normal, f32 radius, const glm::vec4& color) {
    (void)mvp;
    (void)center;
    (void)normal;
    (void)radius;
    (void)color;
}

// =============================================================================
// Interaction
// =============================================================================

GizmoAxis TransformGizmo::hitTest(const glm::vec3& rayOrigin, const glm::vec3& rayDir) const {
    if (mode_ == GizmoMode::Translate) {
        constexpr f32 planeOffset = 0.15f;
        constexpr f32 planeSize = 0.12f;

        auto checkPlaneHit = [&](const glm::vec3& planeNormal, const glm::vec3& u, const glm::vec3& v,
                                 GizmoAxis axis) -> bool {
            f32 denom = glm::dot(rayDir, planeNormal);
            if (std::abs(denom) < 0.001f) return false;

            f32 t = glm::dot(gizmoPosition_ - rayOrigin, planeNormal) / denom;
            if (t < 0.0f) return false;

            glm::vec3 hitPoint = rayOrigin + rayDir * t;
            glm::vec3 localHit = (hitPoint - gizmoPosition_) / size_;

            f32 uCoord = glm::dot(localHit, u);
            f32 vCoord = glm::dot(localHit, v);

            return uCoord >= planeOffset && uCoord <= planeOffset + planeSize &&
                   vCoord >= planeOffset && vCoord <= planeOffset + planeSize;
        };

        // Check XY plane (Z normal)
        if (checkPlaneHit(glm::vec3(0, 0, 1), glm::vec3(1, 0, 0), glm::vec3(0, 1, 0), GizmoAxis::XY)) {
            return GizmoAxis::XY;
        }

        if (!is2DMode_) {
            // Check YZ plane (X normal)
            if (checkPlaneHit(glm::vec3(1, 0, 0), glm::vec3(0, 1, 0), glm::vec3(0, 0, 1), GizmoAxis::YZ)) {
                return GizmoAxis::YZ;
            }

            // Check XZ plane (Y normal)
            if (checkPlaneHit(glm::vec3(0, 1, 0), glm::vec3(1, 0, 0), glm::vec3(0, 0, 1), GizmoAxis::XZ)) {
                return GizmoAxis::XZ;
            }
        }
    }

    if (mode_ == GizmoMode::Translate || mode_ == GizmoMode::Scale) {
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

        if (!is2DMode_) {
            f32 distZ = rayAxisDistance(rayOrigin, rayDir, gizmoPosition_, glm::vec3(0, 0, 1));
            if (distZ < HIT_THRESHOLD && distZ < minDist) {
                minDist = distZ;
                closestAxis = GizmoAxis::Z;
            }
        }

        return closestAxis;
    }

    if (mode_ == GizmoMode::Rotate) {
        f32 radius = 0.8f * size_;
        f32 threshold = 0.15f * size_;
        f32 minDist = std::numeric_limits<f32>::max();
        GizmoAxis closestAxis = GizmoAxis::None;

        auto checkCircle = [&](const glm::vec3& normal, GizmoAxis axis) {
            f32 denom = glm::dot(rayDir, normal);
            if (std::abs(denom) < 0.001f) return;

            f32 t = glm::dot(gizmoPosition_ - rayOrigin, normal) / denom;
            if (t < 0.0f) return;

            glm::vec3 hitPoint = rayOrigin + rayDir * t;
            f32 distFromCenter = glm::length(hitPoint - gizmoPosition_);
            f32 distFromCircle = std::abs(distFromCenter - radius);

            if (distFromCircle < threshold && distFromCircle < minDist) {
                minDist = distFromCircle;
                closestAxis = axis;
            }
        };

        if (!is2DMode_) {
            checkCircle(glm::vec3(1, 0, 0), GizmoAxis::X);
            checkCircle(glm::vec3(0, 1, 0), GizmoAxis::Y);
        }
        checkCircle(glm::vec3(0, 0, 1), GizmoAxis::Z);

        return closestAxis;
    }

    return GizmoAxis::None;
}

void TransformGizmo::startDrag(GizmoAxis axis, const glm::vec3& rayOrigin, const glm::vec3& rayDir) {
    activeAxis_ = axis;
    dragging_ = true;
    rotationDelta_ = 0.0f;

    // Handle plane axes
    if (axis == GizmoAxis::XY || axis == GizmoAxis::XZ || axis == GizmoAxis::YZ) {
        switch (axis) {
            case GizmoAxis::XY: dragPlaneNormal_ = glm::vec3(0, 0, 1); break;
            case GizmoAxis::XZ: dragPlaneNormal_ = glm::vec3(0, 1, 0); break;
            case GizmoAxis::YZ: dragPlaneNormal_ = glm::vec3(1, 0, 0); break;
            default: break;
        }

        f32 denom = glm::dot(rayDir, dragPlaneNormal_);
        if (std::abs(denom) > 0.001f) {
            f32 t = glm::dot(gizmoPosition_ - rayOrigin, dragPlaneNormal_) / denom;
            dragStartPoint_ = rayOrigin + rayDir * t;
        } else {
            dragStartPoint_ = gizmoPosition_;
        }
        return;
    }

    glm::vec3 axisDir(0.0f);
    switch (axis) {
        case GizmoAxis::X: axisDir = glm::vec3(1, 0, 0); break;
        case GizmoAxis::Y: axisDir = glm::vec3(0, 1, 0); break;
        case GizmoAxis::Z: axisDir = glm::vec3(0, 0, 1); break;
        default: return;
    }

    if (mode_ == GizmoMode::Rotate) {
        dragPlaneNormal_ = axisDir;
        f32 denom = glm::dot(rayDir, dragPlaneNormal_);
        if (std::abs(denom) > 0.001f) {
            f32 t = glm::dot(gizmoPosition_ - rayOrigin, dragPlaneNormal_) / denom;
            glm::vec3 hitPoint = rayOrigin + rayDir * t;
            glm::vec3 toHit = hitPoint - gizmoPosition_;
            dragStartAngle_ = std::atan2(
                glm::dot(toHit, glm::cross(dragPlaneNormal_, glm::vec3(0, 1, 0))),
                glm::dot(toHit, glm::vec3(0, 1, 0))
            );
            if (axis == GizmoAxis::Y) {
                dragStartAngle_ = std::atan2(
                    glm::dot(toHit, glm::vec3(0, 0, 1)),
                    glm::dot(toHit, glm::vec3(1, 0, 0))
                );
            } else if (axis == GizmoAxis::Z) {
                dragStartAngle_ = std::atan2(
                    glm::dot(toHit, glm::vec3(0, 1, 0)),
                    glm::dot(toHit, glm::vec3(1, 0, 0))
                );
            } else {
                dragStartAngle_ = std::atan2(
                    glm::dot(toHit, glm::vec3(0, 0, 1)),
                    glm::dot(toHit, glm::vec3(0, 1, 0))
                );
            }
            dragStartPoint_ = hitPoint;
        }
    } else {
        dragPlaneNormal_ = glm::cross(axisDir, glm::cross(rayDir, axisDir));
        if (glm::length(dragPlaneNormal_) > 0.001f) {
            dragPlaneNormal_ = glm::normalize(dragPlaneNormal_);
        } else {
            dragPlaneNormal_ = glm::abs(axisDir.x) > 0.9f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
        }

        f32 denom = glm::dot(rayDir, dragPlaneNormal_);
        if (std::abs(denom) > 0.001f) {
            f32 t = glm::dot(gizmoPosition_ - rayOrigin, dragPlaneNormal_) / denom;
            dragStartPoint_ = rayOrigin + rayDir * t;
        } else {
            dragStartPoint_ = gizmoPosition_;
        }
    }
}

glm::vec3 TransformGizmo::updateDrag(const glm::vec3& rayOrigin, const glm::vec3& rayDir) {
    if (!dragging_ || activeAxis_ == GizmoAxis::None) {
        return glm::vec3(0.0f);
    }

    f32 denom = glm::dot(rayDir, dragPlaneNormal_);
    if (std::abs(denom) < 0.001f) {
        return glm::vec3(0.0f);
    }

    f32 t = glm::dot(gizmoPosition_ - rayOrigin, dragPlaneNormal_) / denom;
    glm::vec3 hitPoint = rayOrigin + rayDir * t;
    glm::vec3 delta = hitPoint - dragStartPoint_;

    // Handle plane movement
    if (activeAxis_ == GizmoAxis::XY || activeAxis_ == GizmoAxis::XZ || activeAxis_ == GizmoAxis::YZ) {
        glm::vec3 mask(0.0f);
        switch (activeAxis_) {
            case GizmoAxis::XY: mask = glm::vec3(1, 1, 0); break;
            case GizmoAxis::XZ: mask = glm::vec3(1, 0, 1); break;
            case GizmoAxis::YZ: mask = glm::vec3(0, 1, 1); break;
            default: break;
        }
        return delta * mask;
    }

    glm::vec3 axisDir(0.0f);
    switch (activeAxis_) {
        case GizmoAxis::X: axisDir = glm::vec3(1, 0, 0); break;
        case GizmoAxis::Y: axisDir = glm::vec3(0, 1, 0); break;
        case GizmoAxis::Z: axisDir = glm::vec3(0, 0, 1); break;
        default: return glm::vec3(0.0f);
    }

    if (mode_ == GizmoMode::Rotate) {
        glm::vec3 toHit = hitPoint - gizmoPosition_;
        f32 currentAngle;
        if (activeAxis_ == GizmoAxis::Y) {
            currentAngle = std::atan2(
                glm::dot(toHit, glm::vec3(0, 0, 1)),
                glm::dot(toHit, glm::vec3(1, 0, 0))
            );
        } else if (activeAxis_ == GizmoAxis::Z) {
            currentAngle = std::atan2(
                glm::dot(toHit, glm::vec3(0, 1, 0)),
                glm::dot(toHit, glm::vec3(1, 0, 0))
            );
        } else {
            currentAngle = std::atan2(
                glm::dot(toHit, glm::vec3(0, 0, 1)),
                glm::dot(toHit, glm::vec3(0, 1, 0))
            );
        }
        rotationDelta_ = currentAngle - dragStartAngle_;
        return glm::vec3(0.0f);
    }

    f32 projection = glm::dot(delta, axisDir);
    return axisDir * projection;
}

void TransformGizmo::endDrag() {
    dragging_ = false;
    activeAxis_ = GizmoAxis::None;
    rotationDelta_ = 0.0f;
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
