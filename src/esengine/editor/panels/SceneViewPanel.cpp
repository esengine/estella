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
#include "../../renderer/RenderContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../core/Log.hpp"
#include <glad/glad.h>
#include <vector>

#ifndef GL_VIEWPORT
#define GL_VIEWPORT 0x0BA2
#endif

namespace {

const char* GRID_VERTEX_SHADER = R"(
    attribute vec3 a_position;

    uniform mat4 u_viewProj;

    void main() {
        gl_Position = u_viewProj * vec4(a_position, 1.0);
    }
)";

const char* GRID_FRAGMENT_SHADER = R"(
    precision mediump float;

    uniform vec4 u_color;

    void main() {
        gl_FragColor = u_color;
    }
)";

}

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
            glm::vec2(0.0f, 1.0f),
            glm::vec2(1.0f, 0.0f)
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
    if (!gridInitialized_) {
        initGridData();
    }

    glm::mat4 view = camera_.getViewMatrix();
    glm::mat4 proj = camera_.getProjectionMatrix();
    glm::mat4 viewProj = proj * view;

    renderGrid(viewProj);
    renderSprites(viewProj);
}

void SceneViewPanel::initGridData() {
    std::vector<f32> vertices;

    constexpr f32 gridSize = 100.0f;
    constexpr f32 gridStep = 1.0f;

    for (f32 x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(x);
        vertices.push_back(0.0f);
        vertices.push_back(-gridSize);

        vertices.push_back(x);
        vertices.push_back(0.0f);
        vertices.push_back(gridSize);
    }

    for (f32 z = -gridSize; z <= gridSize; z += gridStep) {
        vertices.push_back(-gridSize);
        vertices.push_back(0.0f);
        vertices.push_back(z);

        vertices.push_back(gridSize);
        vertices.push_back(0.0f);
        vertices.push_back(z);
    }

    gridVertexCount_ = static_cast<u32>(vertices.size() / 3);

    gridVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
    vbo->setLayout({
        { ShaderDataType::Float3, "a_position" }
    });

    gridVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

    gridShader_ = Shader::create(GRID_VERTEX_SHADER, GRID_FRAGMENT_SHADER);

    gridInitialized_ = true;
    ES_LOG_DEBUG("Grid initialized with {} vertices", gridVertexCount_);
}

void SceneViewPanel::renderGrid(const glm::mat4& viewProj) {
    if (!gridVAO_ || !gridShader_) return;

    gridShader_->bind();
    gridShader_->setUniform("u_viewProj", viewProj);
    gridShader_->setUniform("u_color", glm::vec4(0.3f, 0.3f, 0.3f, 1.0f));

    gridVAO_->bind();
    glDrawArrays(GL_LINES, 0, static_cast<GLsizei>(gridVertexCount_));
}

void SceneViewPanel::renderSprites(const glm::mat4& viewProj) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    RenderContext& renderCtx = ctx->getRenderContext();
    Shader* shader = renderCtx.getTextureShader();
    VertexArray* quadVAO = renderCtx.getQuadVAO();

    if (!shader || !quadVAO) return;

    auto spriteView = registry_.view<ecs::LocalTransform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& transform = spriteView.get<ecs::LocalTransform>(entity);
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);

        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, transform.position);
        model *= glm::mat4_cast(transform.rotation);
        model = glm::scale(model, glm::vec3(sprite.size * transform.scale.x, 1.0f));

        shader->bind();
        shader->setUniform("u_projection", viewProj);
        shader->setUniform("u_model", model);
        shader->setUniform("u_color", sprite.color);

        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, renderCtx.getWhiteTextureId());
        shader->setUniform("u_texture", 0);

        RenderCommand::drawIndexed(*quadVAO);
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
