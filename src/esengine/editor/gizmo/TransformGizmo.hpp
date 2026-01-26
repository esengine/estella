/**
 * @file    TransformGizmo.hpp
 * @brief   Transform gizmo for interactive entity manipulation
 * @details Provides visual handles for translating, rotating, and scaling
 *          entities in the scene view.
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
#include "../../ecs/Registry.hpp"

namespace esengine::editor {

// =============================================================================
// Enums
// =============================================================================

/**
 * @brief Gizmo manipulation mode
 */
enum class GizmoMode : u8 {
    Translate,  ///< Move entity along axes
    Rotate,     ///< Rotate entity around axes
    Scale       ///< Scale entity along axes
};

/**
 * @brief Gizmo axis selection
 */
enum class GizmoAxis : u8 {
    None,   ///< No axis selected
    X,      ///< X axis (red)
    Y,      ///< Y axis (green)
    Z,      ///< Z axis (blue)
    XY,     ///< XY plane
    YZ,     ///< YZ plane
    XZ,     ///< XZ plane
    XYZ     ///< All axes (for uniform scale)
};

// =============================================================================
// TransformGizmo Class
// =============================================================================

/**
 * @brief Interactive gizmo for manipulating entity transforms
 *
 * @details Renders visual handles for translation, rotation, and scaling.
 *          Supports mouse-based manipulation with undo/redo integration.
 *
 * @code
 * TransformGizmo gizmo;
 * gizmo.setMode(GizmoMode::Translate);
 *
 * // In render loop
 * if (selectedEntity != INVALID_ENTITY) {
 *     gizmo.render(camera.getViewMatrix(), camera.getProjectionMatrix(),
 *                  selectedEntity, registry);
 * }
 *
 * // In mouse down handler
 * glm::vec3 rayOrigin, rayDir;
 * GizmoAxis axis = gizmo.hitTest(rayOrigin, rayDir);
 * if (axis != GizmoAxis::None) {
 *     gizmo.startDrag(axis, hitPoint);
 * }
 * @endcode
 */
class TransformGizmo {
public:
    TransformGizmo() = default;
    ~TransformGizmo() = default;

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the gizmo mode
     * @param mode Manipulation mode (translate/rotate/scale)
     */
    void setMode(GizmoMode mode) { mode_ = mode; }

    /**
     * @brief Gets the current gizmo mode
     * @return Current mode
     */
    GizmoMode getMode() const { return mode_; }

    /**
     * @brief Sets the gizmo size
     * @param size Size in world units
     */
    void setSize(f32 size) { size_ = size; }

    /**
     * @brief Gets the gizmo size
     * @return Size in world units
     */
    f32 getSize() const { return size_; }

    // =========================================================================
    // Rendering
    // =========================================================================

    /**
     * @brief Renders the gizmo for the given entity
     * @param view View matrix
     * @param proj Projection matrix
     * @param entity Entity to manipulate
     * @param registry Entity registry
     */
    void render(const glm::mat4& view, const glm::mat4& proj,
                Entity entity, ecs::Registry& registry);

    // =========================================================================
    // Interaction
    // =========================================================================

    /**
     * @brief Tests if a ray hits the gizmo
     * @param rayOrigin Ray origin in world space
     * @param rayDir Ray direction (normalized)
     * @return Hit axis or GizmoAxis::None
     */
    GizmoAxis hitTest(const glm::vec3& rayOrigin, const glm::vec3& rayDir) const;

    /**
     * @brief Starts a drag operation
     * @param axis Axis to manipulate
     * @param hitPoint World position where drag started
     */
    void startDrag(GizmoAxis axis, const glm::vec3& hitPoint);

    /**
     * @brief Updates the drag operation
     * @param rayOrigin Ray origin in world space
     * @param rayDir Ray direction (normalized)
     * @return Delta transform to apply
     */
    glm::vec3 updateDrag(const glm::vec3& rayOrigin, const glm::vec3& rayDir);

    /**
     * @brief Ends the drag operation
     */
    void endDrag();

    /**
     * @brief Checks if currently dragging
     * @return True if dragging
     */
    bool isDragging() const { return dragging_; }

private:
    void renderTranslateGizmo(const glm::mat4& mvp, const glm::vec3& position);
    void renderRotateGizmo(const glm::mat4& mvp, const glm::vec3& position);
    void renderScaleGizmo(const glm::mat4& mvp, const glm::vec3& position);

    void renderAxis(const glm::mat4& mvp, const glm::vec3& start,
                   const glm::vec3& end, const glm::vec4& color);
    void renderArrow(const glm::mat4& mvp, const glm::vec3& start,
                    const glm::vec3& dir, f32 length, const glm::vec4& color);
    void renderCircle(const glm::mat4& mvp, const glm::vec3& center,
                     const glm::vec3& normal, f32 radius, const glm::vec4& color);

    f32 rayAxisDistance(const glm::vec3& rayOrigin, const glm::vec3& rayDir,
                        const glm::vec3& axisOrigin, const glm::vec3& axisDir) const;

    GizmoMode mode_ = GizmoMode::Translate;
    GizmoAxis activeAxis_ = GizmoAxis::None;
    f32 size_ = 1.0f;

    bool dragging_ = false;
    glm::vec3 dragStartPoint_{0.0f};
    glm::vec3 gizmoPosition_{0.0f};
};

}  // namespace esengine::editor
