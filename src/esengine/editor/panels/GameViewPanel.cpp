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
#include "../../renderer/RenderContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Camera.hpp"
#include "../../ecs/components/Canvas.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../math/Math.hpp"

#include <glad/glad.h>

#ifndef GL_VIEWPORT
#define GL_VIEWPORT 0x0BA2
#endif

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

GameViewPanel::GameViewPanel(ecs::Registry& registry, resource::ResourceManager& resourceManager)
    : DockPanel(ui::WidgetId("game_view_panel"), "Game"),
      registry_(registry),
      resourceManager_(resourceManager) {

    FramebufferSpec spec;
    spec.width = viewport_width_;
    spec.height = viewport_height_;
    spec.depthStencil = true;
    framebuffer_ = Framebuffer::create(spec);

    setMinSize(glm::vec2(200.0f, 200.0f));
}

// =============================================================================
// Configuration
// =============================================================================

void GameViewPanel::setViewportSize(u32 width, u32 height) {
    if (width == viewport_width_ && height == viewport_height_) {
        return;
    }

    viewport_width_ = width;
    viewport_height_ = height;
    framebuffer_needs_resize_ = true;
}

// =============================================================================
// Rendering
// =============================================================================

void GameViewPanel::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();

    u32 newWidth = static_cast<u32>(bounds.width);
    u32 newHeight = static_cast<u32>(bounds.height);

    if (newWidth != viewport_width_ || newHeight != viewport_height_) {
        setViewportSize(newWidth, newHeight);
    }

    if (framebuffer_needs_resize_) {
        updateFramebufferSize();
    }

    if (framebuffer_) {
        renderGameToTexture();

        renderer.drawTexturedRect(
            bounds,
            framebuffer_->getColorAttachment(),
            glm::vec4(1.0f),
            glm::vec2(0.0f, 1.0f),
            glm::vec2(1.0f, 0.0f)
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

    RenderCommand::setViewport(0, 0, viewport_width_, viewport_height_);

    Entity canvasEntity = findCanvas();
    ecs::Canvas* canvas = canvasEntity != INVALID_ENTITY
        ? registry_.tryGet<ecs::Canvas>(canvasEntity)
        : nullptr;

    glm::vec4 clearColor = canvas ? canvas->backgroundColor : glm::vec4(0.1f, 0.1f, 0.1f, 1.0f);
    RenderCommand::setClearColor(clearColor);
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

            f32 viewportAspect = static_cast<f32>(viewport_width_) / static_cast<f32>(viewport_height_);

            glm::mat4 proj;
            if (camera->projectionType == ecs::ProjectionType::Perspective) {
                f32 aspectRatio = camera->aspectRatio > 0.0f ? camera->aspectRatio : viewportAspect;
                proj = glm::perspective(
                    glm::radians(camera->fov),
                    aspectRatio,
                    camera->nearPlane,
                    camera->farPlane
                );
            } else {
                f32 orthoHeight = camera->orthoSize;
                f32 orthoWidth = orthoHeight * viewportAspect;

                if (canvas) {
                    orthoHeight = canvas->getOrthoSize();
                    f32 designAspect = canvas->getDesignAspectRatio();

                    switch (canvas->scaleMode) {
                        case ecs::CanvasScaleMode::FixedHeight:
                            orthoWidth = orthoHeight * viewportAspect;
                            break;
                        case ecs::CanvasScaleMode::FixedWidth:
                            orthoWidth = canvas->getWorldSize().x * 0.5f;
                            orthoHeight = orthoWidth / viewportAspect;
                            break;
                        case ecs::CanvasScaleMode::Expand:
                            if (viewportAspect > designAspect) {
                                orthoWidth = orthoHeight * viewportAspect;
                            } else {
                                orthoHeight = orthoWidth / viewportAspect;
                            }
                            break;
                        case ecs::CanvasScaleMode::Shrink:
                            if (viewportAspect < designAspect) {
                                orthoWidth = orthoHeight * viewportAspect;
                            } else {
                                orthoHeight = orthoWidth / viewportAspect;
                            }
                            break;
                        case ecs::CanvasScaleMode::Match: {
                            f32 logWidth = glm::log2(viewportAspect / designAspect);
                            f32 blend = canvas->matchWidthOrHeight;
                            f32 scaleFactor = glm::pow(2.0f, logWidth * (1.0f - blend));
                            orthoWidth = orthoHeight * designAspect * scaleFactor;
                            orthoHeight = orthoWidth / viewportAspect;
                            break;
                        }
                    }
                }

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
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    RenderContext& renderCtx = ctx->getRenderContext();

    if (!render_pipeline_) {
        render_pipeline_ = makeUnique<RenderPipeline>(renderCtx, resourceManager_);
    }

    render_pipeline_->begin(viewProj);
    render_pipeline_->submit(registry_);
    render_pipeline_->end();
}

void GameViewPanel::updateFramebufferSize() {
    if (viewport_width_ == 0 || viewport_height_ == 0) {
        return;
    }

    if (framebuffer_) {
        framebuffer_->resize(viewport_width_, viewport_height_);
        framebuffer_needs_resize_ = false;
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

Entity GameViewPanel::findCanvas() {
    auto view = registry_.view<ecs::Canvas>();
    for (auto entity : view) {
        return entity;
    }
    return INVALID_ENTITY;
}

}  // namespace esengine::editor
