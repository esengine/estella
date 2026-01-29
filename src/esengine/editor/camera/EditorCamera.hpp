/**
 * @file    EditorCamera.hpp
 * @brief   Editor camera with orbit, pan, and zoom controls
 * @details Provides intuitive camera controls for 3D scene editing including
 *          mouse orbit, pan, and scroll wheel zoom.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"
#include "../../ui/events/UIEvent.hpp"

namespace esengine::editor {

// =============================================================================
// EditorCamera Class
// =============================================================================

/**
 * @brief 3D camera for scene editing
 *
 * @details Implements orbit camera controls common in 3D editors:
 *          - Alt+LMB: Orbit around focal point
 *          - Alt+MMB / MMB: Pan camera
 *          - Scroll wheel: Zoom in/out
 *
 * @code
 * EditorCamera camera;
 * camera.setViewportSize(800, 600);
 * camera.setFocalPoint(glm::vec3(0.0f));
 * camera.setDistance(10.0f);
 *
 * // Handle mouse events
 * camera.onMouseDown(mouseEvent);
 * camera.onMouseMove(mouseEvent);
 * camera.onMouseScroll(scrollEvent);
 *
 * // Get matrices for rendering
 * glm::mat4 view = camera.getViewMatrix();
 * glm::mat4 proj = camera.getProjectionMatrix();
 * @endcode
 */
class EditorCamera {
public:
    EditorCamera();
    ~EditorCamera() = default;

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the viewport dimensions
     * @param width Viewport width in pixels
     * @param height Viewport height in pixels
     */
    void setViewportSize(f32 width, f32 height);

    /**
     * @brief Sets the camera focal point
     * @param point World position to orbit around
     */
    void setFocalPoint(const glm::vec3& point);

    /**
     * @brief Sets the distance from focal point
     * @param distance Distance in world units
     */
    void setDistance(f32 distance);

    /**
     * @brief Sets the field of view
     * @param fov Field of view in degrees
     */
    void setFieldOfView(f32 fov);

    /**
     * @brief Sets near and far clip planes
     * @param near Near plane distance
     * @param far Far plane distance
     */
    void setClipPlanes(f32 near, f32 far);

    // =========================================================================
    // Input Handling
    // =========================================================================

    /**
     * @brief Handles mouse button down events
     * @param event Mouse button event
     * @return True if event was handled
     */
    bool onMouseDown(const ui::MouseButtonEvent& event);

    /**
     * @brief Handles mouse button up events
     * @param event Mouse button event
     * @return True if event was handled
     */
    bool onMouseUp(const ui::MouseButtonEvent& event);

    /**
     * @brief Handles mouse move events
     * @param event Mouse move event
     * @return True if event was handled
     */
    bool onMouseMove(const ui::MouseMoveEvent& event);

    /**
     * @brief Handles mouse scroll events
     * @param event Mouse scroll event
     * @return True if event was handled
     */
    bool onMouseScroll(const ui::ScrollEvent& event);

    // =========================================================================
    // Matrix Access
    // =========================================================================

    /** @brief Gets the view matrix */
    glm::mat4 getViewMatrix() const;

    /** @brief Gets the projection matrix */
    glm::mat4 getProjectionMatrix() const;

    /** @brief Gets the view-projection matrix */
    glm::mat4 getViewProjectionMatrix() const;

    /** @brief Gets the camera position in world space */
    glm::vec3 getPosition() const;

    /** @brief Gets the camera forward direction */
    glm::vec3 getForwardDirection() const;

    /** @brief Gets the camera up direction */
    glm::vec3 getUpDirection() const;

    /** @brief Gets the camera right direction */
    glm::vec3 getRightDirection() const;

    /** @brief Gets the focal point */
    const glm::vec3& getFocalPoint() const { return focalPoint_; }

    /** @brief Gets the distance from focal point */
    f32 getDistance() const { return distance_; }

private:
    void updateView();
    glm::quat getOrientation() const;

    void mousePan(f32 deltaX, f32 deltaY);
    void mouseRotate(f32 deltaX, f32 deltaY);
    void mouseZoom(f32 delta);

    glm::vec3 focalPoint_{0.0f};
    f32 distance_ = 10.0f;
    f32 pitch_ = 0.5f;
    f32 yaw_ = 0.0f;

    f32 fov_ = 45.0f;
    f32 aspectRatio_ = 16.0f / 9.0f;
    f32 nearClip_ = 0.1f;
    f32 farClip_ = 1000.0f;

    f32 viewportWidth_ = 1280.0f;
    f32 viewportHeight_ = 720.0f;

    glm::vec2 lastMousePos_{0.0f};
    bool isDragging_ = false;
    bool isPanning_ = false;
    bool isOrbiting_ = false;

    glm::mat4 viewMatrix_{1.0f};
};

}  // namespace esengine::editor
