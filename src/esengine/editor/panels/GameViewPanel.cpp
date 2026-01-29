/**
 * @file    GameViewPanel.cpp
 * @brief   Game view panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "GameViewPanel.hpp"
#include "../../renderer/RenderCommand.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Camera.hpp"
#include "../../math/Math.hpp"

#include <glad/glad.h>

#ifndef GL_VIEWPORT
#define GL_VIEWPORT 0x0BA2
#endif

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

GameViewPanel::GameViewPanel(ecs::Registry& registry)
    : DockPanel(ui::WidgetId("game_view_panel"), "Game"),
      registry_(registry) {

    FramebufferSpec spec;
    spec.width = viewportWidth_;
    spec.height = viewportHeight_;
    spec.depthStencil = true;
    framebuffer_ = Framebuffer::create(spec);

    setMinSize(glm::vec2(200.0f, 200.0f));
}

// =============================================================================
// Configuration
// =============================================================================

void GameViewPanel::setViewportSize(u32 width, u32 height) {
    if (width == viewportWidth_ && height == viewportHeight_) {
        return;
    }

    viewportWidth_ = width;
    viewportHeight_ = height;
    framebufferNeedsResize_ = true;
}

// =============================================================================
// Rendering
// =============================================================================

void GameViewPanel::render(ui::UIBatchRenderer& renderer) {
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
        renderGameToTexture();

        renderer.drawTexturedRect(
            bounds,
            framebuffer_->getColorAttachment(),
            glm::vec4(1.0f),
            glm::vec2(0.0f, 0.0f),
            glm::vec2(1.0f, 1.0f)
        );
    }
}

void GameViewPanel::renderGameToTexture() {
    if (!framebuffer_) {
        return;
    }

    GLint savedViewport[4];
    glGetIntegerv(GL_VIEWPORT, savedViewport);

    framebuffer_->bind();

    RenderCommand::setViewport(0, 0, viewportWidth_, viewportHeight_);
    RenderCommand::setClearColor(glm::vec4(0.1f, 0.1f, 0.1f, 1.0f));
    RenderCommand::clear();

    Entity cameraEntity = findActiveCamera();
    if (cameraEntity != INVALID_ENTITY) {
        auto* transform = registry_.tryGet<ecs::LocalTransform>(cameraEntity);
        auto* camera = registry_.tryGet<ecs::Camera>(cameraEntity);

        if (transform && camera) {
            glm::mat4 view = glm::inverse(
                glm::translate(glm::mat4(1.0f), transform->position) *
                glm::mat4_cast(transform->rotation)
            );

            f32 aspectRatio = camera->aspectRatio > 0.0f
                ? camera->aspectRatio
                : static_cast<f32>(viewportWidth_) / static_cast<f32>(viewportHeight_);

            glm::mat4 proj;
            if (camera->projectionType == ecs::ProjectionType::Perspective) {
                proj = glm::perspective(
                    glm::radians(camera->fov),
                    aspectRatio,
                    camera->nearPlane,
                    camera->farPlane
                );
            } else {
                f32 orthoHeight = camera->orthoSize;
                f32 orthoWidth = orthoHeight * aspectRatio;
                proj = glm::ortho(
                    -orthoWidth, orthoWidth,
                    -orthoHeight, orthoHeight,
                    camera->nearPlane, camera->farPlane
                );
            }

            glm::mat4 viewProj = proj * view;
            renderSceneContent(viewProj);
        }
    }

    framebuffer_->unbind();

    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
}

void GameViewPanel::renderSceneContent(const glm::mat4& viewProj) {
    auto transformView = registry_.view<ecs::LocalTransform>();
    for (auto entity : transformView) {
        const auto& transform = transformView.get(entity);

        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, transform.position);
        model *= glm::mat4_cast(transform.rotation);
        model = glm::scale(model, transform.scale);

        glm::mat4 mvp = viewProj * model;
        (void)mvp;
    }
}

void GameViewPanel::updateFramebufferSize() {
    if (viewportWidth_ == 0 || viewportHeight_ == 0) {
        return;
    }

    if (framebuffer_) {
        framebuffer_->resize(viewportWidth_, viewportHeight_);
        framebufferNeedsResize_ = false;
    }
}

Entity GameViewPanel::findActiveCamera() {
    auto view = registry_.view<ecs::Camera>();

    Entity bestCamera = INVALID_ENTITY;
    i32 bestPriority = std::numeric_limits<i32>::min();

    for (auto entity : view) {
        const auto& camera = view.get(entity);
        if (camera.isActive && camera.priority > bestPriority) {
            bestCamera = entity;
            bestPriority = camera.priority;
        }
    }

    return bestCamera;
}

}  // namespace esengine::editor
