/**
 * @file    SceneViewPanel.cpp
 * @brief   Scene view panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "SceneViewPanel.hpp"
#include "../../renderer/RenderCommand.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../core/Log.hpp"
#include <glad/glad.h>
#ifndef GL_VIEWPORT
#define GL_VIEWPORT 0x0BA2
#endif

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

SceneViewPanel::SceneViewPanel(ecs::Registry& registry, EntitySelection& selection)
    : DockPanel(ui::WidgetId("scene_view_panel"), "Scene"),
      registry_(registry),
      selection_(selection) {

    FramebufferSpec spec;
    spec.width = viewportWidth_;
    spec.height = viewportHeight_;
    spec.depthStencil = true;
    framebuffer_ = Framebuffer::create(spec);

    camera_.setViewportSize(static_cast<f32>(viewportWidth_), static_cast<f32>(viewportHeight_));
    camera_.setFocalPoint(glm::vec3(0.0f));
    camera_.setDistance(10.0f);

    setMinSize(glm::vec2(200.0f, 200.0f));
}

// =============================================================================
// Configuration
// =============================================================================

void SceneViewPanel::setViewportSize(u32 width, u32 height) {
    if (width == viewportWidth_ && height == viewportHeight_) {
        return;
    }

    viewportWidth_ = width;
    viewportHeight_ = height;
    framebufferNeedsResize_ = true;
}

// =============================================================================
// Widget Interface
// =============================================================================

void SceneViewPanel::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();

    u32 newWidth = static_cast<u32>(bounds.width);
    u32 newHeight = static_cast<u32>(bounds.height);

    if (newWidth != viewportWidth_ || newHeight != viewportHeight_) {
        setViewportSize(newWidth, newHeight);
    }

    if (framebufferNeedsResize_) {
        updateFramebufferSize();
    }

    if (framebuffer_) {
        renderSceneToTexture();

        renderer.drawTexturedRect(
            bounds,
            framebuffer_->getColorAttachment(),
            glm::vec4(1.0f),
            glm::vec2(0.0f, 0.0f),
            glm::vec2(1.0f, 1.0f)
        );
    }
}

bool SceneViewPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    camera_.onMouseDown(event);
    return true;
}

bool SceneViewPanel::onMouseUp(const ui::MouseButtonEvent& event) {
    camera_.onMouseUp(event);
    return true;
}

bool SceneViewPanel::onMouseMove(const ui::MouseMoveEvent& event) {
    camera_.onMouseMove(event);
    return true;
}

bool SceneViewPanel::onScroll(const ui::ScrollEvent& event) {
    camera_.onMouseScroll(event);
    return true;
}

// =============================================================================
// Private Methods
// =============================================================================

void SceneViewPanel::renderSceneToTexture() {
    if (!framebuffer_) {
        return;
    }

    // Save current viewport
    GLint savedViewport[4];
    glGetIntegerv(GL_VIEWPORT, savedViewport);

    framebuffer_->bind();

    RenderCommand::setViewport(0, 0, viewportWidth_, viewportHeight_);
    RenderCommand::setClearColor(glm::vec4(0.2f, 0.2f, 0.2f, 1.0f));
    RenderCommand::clear();

    renderSceneContent();

    framebuffer_->unbind();

    // Restore viewport
    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
}

void SceneViewPanel::renderSceneContent() {
    glm::mat4 view = camera_.getViewMatrix();
    glm::mat4 proj = camera_.getProjectionMatrix();
    glm::mat4 viewProj = proj * view;

    auto transformView = registry_.view<ecs::LocalTransform>();
    for (auto entity : transformView) {
        const auto& transform = transformView.get(entity);

        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, transform.position);
        model *= glm::mat4_cast(transform.rotation);
        model = glm::scale(model, transform.scale);

        glm::mat4 mvp = viewProj * model;
    }
}

void SceneViewPanel::updateFramebufferSize() {
    if (viewportWidth_ == 0 || viewportHeight_ == 0) {
        return;
    }

    if (framebuffer_) {
        framebuffer_->resize(viewportWidth_, viewportHeight_);
        camera_.setViewportSize(static_cast<f32>(viewportWidth_), static_cast<f32>(viewportHeight_));
        framebufferNeedsResize_ = false;
    }
}

}  // namespace esengine::editor
