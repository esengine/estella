/**
 * @file    EditorCamera.cpp
 * @brief   Editor camera implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EditorCamera.hpp"
#include "../../platform/Platform.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

EditorCamera::EditorCamera() {
    updateView();
}

// =============================================================================
// Configuration
// =============================================================================

void EditorCamera::setViewportSize(f32 width, f32 height) {
    viewportWidth_ = width;
    viewportHeight_ = height;
    aspectRatio_ = width / height;
}

void EditorCamera::setFocalPoint(const glm::vec3& point) {
    focalPoint_ = point;
    updateView();
}

void EditorCamera::setDistance(f32 distance) {
    distance_ = glm::clamp(distance, 0.1f, 1000.0f);
    updateView();
}

void EditorCamera::setFieldOfView(f32 fov) {
    fov_ = glm::clamp(fov, 10.0f, 120.0f);
}

void EditorCamera::setClipPlanes(f32 near, f32 far) {
    nearClip_ = near;
    farClip_ = far;
}

// =============================================================================
// Input Handling
// =============================================================================

bool EditorCamera::onMouseDown(const ui::MouseButtonEvent& event) {
    lastMousePos_ = glm::vec2(event.x, event.y);

    if (event.button == ui::MouseButton::Left && event.alt) {
        isOrbiting_ = true;
        return true;
    }

    if (event.button == ui::MouseButton::Middle ||
        (event.button == ui::MouseButton::Left && event.shift)) {
        isPanning_ = true;
        return true;
    }

    return false;
}

bool EditorCamera::onMouseUp(const ui::MouseButtonEvent& event) {
    if (event.button == ui::MouseButton::Left) {
        isOrbiting_ = false;
    }
    if (event.button == ui::MouseButton::Middle) {
        isPanning_ = false;
    }

    return isOrbiting_ || isPanning_;
}

bool EditorCamera::onMouseMove(const ui::MouseMoveEvent& event) {
    glm::vec2 mousePos(event.x, event.y);
    glm::vec2 delta = mousePos - lastMousePos_;
    lastMousePos_ = mousePos;

    if (isOrbiting_) {
        mouseRotate(delta.x, delta.y);
        return true;
    }

    if (isPanning_) {
        mousePan(delta.x, delta.y);
        return true;
    }

    return false;
}

bool EditorCamera::onMouseScroll(const ui::ScrollEvent& event) {
    mouseZoom(event.deltaY);
    return true;
}

// =============================================================================
// Matrix Access
// =============================================================================

glm::mat4 EditorCamera::getViewMatrix() const {
    return viewMatrix_;
}

glm::mat4 EditorCamera::getProjectionMatrix() const {
    return math::perspective(math::toRadians(fov_), aspectRatio_, nearClip_, farClip_);
}

glm::mat4 EditorCamera::getViewProjectionMatrix() const {
    return getProjectionMatrix() * getViewMatrix();
}

glm::vec3 EditorCamera::getPosition() const {
    return focalPoint_ - getForwardDirection() * distance_;
}

glm::vec3 EditorCamera::getForwardDirection() const {
    return glm::rotate(getOrientation(), glm::vec3(0.0f, 0.0f, -1.0f));
}

glm::vec3 EditorCamera::getUpDirection() const {
    return glm::rotate(getOrientation(), glm::vec3(0.0f, 1.0f, 0.0f));
}

glm::vec3 EditorCamera::getRightDirection() const {
    return glm::rotate(getOrientation(), glm::vec3(1.0f, 0.0f, 0.0f));
}

// =============================================================================
// Private Methods
// =============================================================================

void EditorCamera::updateView() {
    glm::vec3 position = getPosition();
    viewMatrix_ = glm::lookAt(position, focalPoint_, glm::vec3(0.0f, 1.0f, 0.0f));
}

glm::quat EditorCamera::getOrientation() const {
    return glm::quat(glm::vec3(-pitch_, -yaw_, 0.0f));
}

void EditorCamera::mousePan(f32 deltaX, f32 deltaY) {
    f32 speed = 0.001f * distance_;
    focalPoint_ += getRightDirection() * (-deltaX * speed);
    focalPoint_ += getUpDirection() * (deltaY * speed);
    updateView();
}

void EditorCamera::mouseRotate(f32 deltaX, f32 deltaY) {
    f32 yawSign = getUpDirection().y < 0.0f ? -1.0f : 1.0f;
    yaw_ += yawSign * deltaX * 0.003f;
    pitch_ += deltaY * 0.003f;

    pitch_ = glm::clamp(pitch_, -glm::half_pi<f32>() + 0.01f, glm::half_pi<f32>() - 0.01f);

    updateView();
}

void EditorCamera::mouseZoom(f32 delta) {
    distance_ -= delta * 0.5f;
    distance_ = glm::clamp(distance_, 0.1f, 1000.0f);
    updateView();
}

}  // namespace esengine::editor
