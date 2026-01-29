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
#include "../core/Selection.hpp"

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
     */
    SceneViewPanel(ecs::Registry& registry, EntitySelection& selection);

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
    void renderSprites(const glm::mat4& viewProj);
    void renderAxisGizmo();
    void updateFramebufferSize();
    void initGridData();
    void initAxisGizmoData();
    i32 hitTestAxisGizmo(f32 x, f32 y);

    ecs::Registry& registry_;
    EntitySelection& selection_;

    Unique<Framebuffer> framebuffer_;
    EditorCamera camera_;

    Unique<VertexArray> gridVAO_;
    Unique<Shader> gridShader_;
    u32 gridVertexCount_ = 0;
    bool gridInitialized_ = false;

    Unique<VertexArray> axisVAO_;
    Unique<Shader> axisShader_;
    u32 axisVertexCount_ = 0;
    bool axisInitialized_ = false;
    glm::vec2 axisGizmoCenter_{0.0f};
    f32 axisGizmoRadius_ = 50.0f;
    i32 hoveredAxis_ = -1;

    u32 viewportWidth_ = 1280;
    u32 viewportHeight_ = 720;
    bool framebufferNeedsResize_ = false;

    f64 lastFrameTime_ = 0.0;
};

}  // namespace esengine::editor
