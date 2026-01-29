/**
 * @file    GameViewPanel.hpp
 * @brief   Game viewport panel showing the game camera view
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
#include "../../ecs/Registry.hpp"

namespace esengine::editor {

// =============================================================================
// GameViewPanel Class
// =============================================================================

/**
 * @brief Game viewport panel showing the active game camera view
 *
 * @details Unlike SceneViewPanel which uses an EditorCamera for free navigation,
 *          GameViewPanel renders from the perspective of the active game camera
 *          (an entity with Camera component where isActive=true).
 */
class GameViewPanel : public ui::DockPanel {
public:
    explicit GameViewPanel(ecs::Registry& registry);
    ~GameViewPanel() override = default;

    void setViewportSize(u32 width, u32 height);

    void render(ui::UIBatchRenderer& renderer) override;

private:
    void renderGameToTexture();
    void renderSceneContent(const glm::mat4& viewProj);
    void updateFramebufferSize();
    Entity findActiveCamera();

    ecs::Registry& registry_;
    Unique<Framebuffer> framebuffer_;

    u32 viewportWidth_ = 1280;
    u32 viewportHeight_ = 720;
    bool framebufferNeedsResize_ = false;
};

}  // namespace esengine::editor
