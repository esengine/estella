/**
 * @file    SceneViewPanel.hpp
 * @brief   Scene viewport panel for 3D scene editing
 * @details Renders the 3D scene to a texture using a framebuffer and displays
 *          it in a dockable panel with camera controls.
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

#include "../../ui/docking/DockPanel.hpp"
#include "../../renderer/Framebuffer.hpp"
#include "../../renderer/Buffer.hpp"
#include "../../renderer/Shader.hpp"
#include "../camera/EditorCamera.hpp"
#include "../../ecs/Registry.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../resource/ResourceManager.hpp"
#include "../core/Selection.hpp"
#include "../widgets/EditorToolbar.hpp"
#include "../widgets/SceneToolbar.hpp"
#include "../gizmo/TransformGizmo.hpp"
#include "../command/CommandHistory.hpp"
#include "../../events/Connection.hpp"

namespace esengine::editor {

// =============================================================================
// SceneViewPanel Class
// =============================================================================

/**
 * @brief 3D scene viewport for editing
 *
 * @details Renders the game scene to an off-screen framebuffer and displays
 *          the result in the panel. Provides camera controls for navigating
 *          the scene and selecting entities.
 *
 * @code
 * SceneViewPanel sceneView(registry, selection);
 * sceneView.setViewportSize(800, 600);
 * // Renders automatically in the docking system
 * @endcode
 */
class SceneViewPanel : public ui::DockPanel {
public:
    /**
     * @brief Constructs scene view panel
     * @param registry Entity registry
     * @param selection Entity selection manager
     * @param resourceManager Resource manager for texture lookup
     */
    SceneViewPanel(ecs::Registry& registry, EntitySelection& selection,
                   resource::ResourceManager& resourceManager);

    ~SceneViewPanel() override = default;

    /**
     * @brief Sets the viewport size
     * @param width Width in pixels
     * @param height Height in pixels
     */
    void setViewportSize(u32 width, u32 height);

    /**
     * @brief Gets the editor camera
     * @return Reference to the camera
     */
    EditorCamera& getCamera() { return camera_; }

    /**
     * @brief Gets the editor camera (const)
     * @return Const reference to the camera
     */
    const EditorCamera& getCamera() const { return camera_; }

    /** @brief Sets the view mode (2D or 3D) */
    void setViewMode(ViewMode mode);

    /** @brief Gets the current view mode */
    ViewMode getViewMode() const { return viewMode_; }

    /** @brief Sets the command history for undo/redo support */
    void setCommandHistory(CommandHistory* history) { commandHistory_ = history; }

    // =========================================================================
    // Widget Interface
    // =========================================================================

    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseUp(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;
    bool onScroll(const ui::ScrollEvent& event) override;

    void setViewToTop();
    void setViewToFront();
    void setViewToRight();
    void setViewToBack();
    void setViewToLeft();
    void setViewToBottom();

private:
    void renderSceneToTexture();
    void renderSceneContent();
    void renderGrid(const glm::mat4& viewProj);
    void renderGrid2D(const glm::mat4& viewProj);
    void renderSprites(const glm::mat4& viewProj);
    void renderCanvasGizmo(const glm::mat4& viewProj);
    void initGrid2DData();
    void initCanvasGizmoData();
    void renderAxisGizmo();
    void renderAxisGizmo2D();
    void updateFramebufferSize();
    void initGridData();
    void initAxisGizmoData();
    void initAxisGizmo2DData();
    i32 hitTestAxisGizmo(f32 x, f32 y);
    i32 hitTestAxisGizmo2D(f32 x, f32 y);
    Entity findCanvas();

    void screenToWorldRay(f32 screenX, f32 screenY, glm::vec3& rayOrigin, glm::vec3& rayDir);
    Entity pickEntity(const glm::vec3& rayOrigin, const glm::vec3& rayDir);
    bool rayIntersectsAABB(const glm::vec3& rayOrigin, const glm::vec3& rayDir,
                           const glm::vec3& boxMin, const glm::vec3& boxMax, f32& t);

    ecs::Registry& registry_;
    EntitySelection& selection_;
    resource::ResourceManager& resourceManager_;

    Unique<Framebuffer> framebuffer_;
    EditorCamera camera_;

    Unique<VertexArray> gridVAO_;
    Unique<VertexArray> grid2DVAO_;
    resource::ShaderHandle gridShaderHandle_;
    u32 gridVertexCount_ = 0;
    u32 grid2DVertexCount_ = 0;
    bool gridInitialized_ = false;
    bool grid2DInitialized_ = false;

    Unique<VertexArray> axisVAO_;
    resource::ShaderHandle axisShaderHandle_;
    u32 axisVertexCount_ = 0;
    bool axisInitialized_ = false;
    glm::vec2 axisGizmoCenter_{0.0f};
    f32 axisGizmoRadius_ = 50.0f;
    i32 hoveredAxis_ = -1;

    u32 viewportWidth_ = 1280;
    u32 viewportHeight_ = 720;
    bool framebufferNeedsResize_ = false;

    f64 lastFrameTime_ = 0.0;

    ViewMode viewMode_ = ViewMode::Mode3D;
    Unique<VertexArray> axis2DVAO_;
    u32 axis2DVertexCount_ = 0;
    bool axis2DInitialized_ = false;

    Unique<VertexArray> canvasGizmoVAO_;
    bool canvasGizmoInitialized_ = false;

    Unique<SceneToolbar> toolbar_;
    Unique<TransformGizmo> transformGizmo_;
    bool gridVisible_ = true;
    bool gizmosVisible_ = true;
    ui::Rect viewportBounds_;

    CommandHistory* commandHistory_ = nullptr;
    ecs::LocalTransform dragStartTransform_;
    Entity draggingEntity_ = INVALID_ENTITY;

    ConnectionHolder connections_;
};

}  // namespace esengine::editor
