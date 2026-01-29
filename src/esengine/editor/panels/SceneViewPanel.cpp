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
#include <chrono>

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

const char* AXIS_VERTEX_SHADER = R"(
    attribute vec3 a_position;
    attribute vec4 a_color;

    uniform mat4 u_viewProj;

    varying vec4 v_color;

    void main() {
        gl_Position = u_viewProj * vec4(a_position, 1.0);
        v_color = a_color;
    }
)";

const char* AXIS_FRAGMENT_SHADER = R"(
    precision mediump float;

    varying vec4 v_color;

    void main() {
        gl_FragColor = v_color;
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
    using Clock = std::chrono::steady_clock;
    static auto startTime = Clock::now();
    f64 currentTime = std::chrono::duration<f64>(Clock::now() - startTime).count();
    f32 deltaTime = static_cast<f32>(currentTime - lastFrameTime_);
    lastFrameTime_ = currentTime;

    if (deltaTime > 0.0f && deltaTime < 1.0f) {
        camera_.update(deltaTime);
    }

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

        renderer.flush();
        if (viewMode_ == ViewMode::Mode3D) {
            renderAxisGizmo();
        } else {
            renderAxisGizmo2D();
        }
    }
}

bool SceneViewPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (viewMode_ == ViewMode::Mode3D) {
        if (event.button == ui::MouseButton::Left && !event.alt && !event.ctrl && !event.shift) {
            i32 axisHit = hitTestAxisGizmo(event.x, event.y);
            if (axisHit >= 0) {
                switch (axisHit) {
                    case 0: setViewToRight(); break;
                    case 1: setViewToTop(); break;
                    case 2: setViewToFront(); break;
                    case 3: setViewToLeft(); break;
                    case 4: setViewToBottom(); break;
                    case 5: setViewToBack(); break;
                }
                return true;
            }
        }
    }

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

void SceneViewPanel::initAxisGizmoData() {
    std::vector<f32> vertices;

    auto addVertex = [&vertices](const glm::vec3& pos, const glm::vec4& color) {
        vertices.insert(vertices.end(), {pos.x, pos.y, pos.z, color.r, color.g, color.b, color.a});
    };

    auto addCone = [&](const glm::vec3& base, const glm::vec3& tip, f32 radius,
                       const glm::vec4& color, i32 segments = 16) {
        glm::vec3 dir = glm::normalize(tip - base);
        glm::vec3 up = glm::abs(dir.y) < 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
        glm::vec3 right = glm::normalize(glm::cross(dir, up));
        up = glm::cross(right, dir);

        for (i32 i = 0; i < segments; ++i) {
            f32 angle1 = (f32(i) / segments) * glm::two_pi<f32>();
            f32 angle2 = (f32(i + 1) / segments) * glm::two_pi<f32>();

            glm::vec3 p1 = base + (right * glm::cos(angle1) + up * glm::sin(angle1)) * radius;
            glm::vec3 p2 = base + (right * glm::cos(angle2) + up * glm::sin(angle2)) * radius;

            addVertex(tip, color);
            addVertex(p1, color);
            addVertex(p2, color);

            addVertex(base, color);
            addVertex(p2, color);
            addVertex(p1, color);
        }
    };

    auto addCylinder = [&](const glm::vec3& start, const glm::vec3& end, f32 radius,
                           const glm::vec4& color, i32 segments = 10) {
        glm::vec3 dir = glm::normalize(end - start);
        glm::vec3 up = glm::abs(dir.y) < 0.99f ? glm::vec3(0, 1, 0) : glm::vec3(1, 0, 0);
        glm::vec3 right = glm::normalize(glm::cross(dir, up));
        up = glm::cross(right, dir);

        for (i32 i = 0; i < segments; ++i) {
            f32 angle1 = (f32(i) / segments) * glm::two_pi<f32>();
            f32 angle2 = (f32(i + 1) / segments) * glm::two_pi<f32>();

            glm::vec3 offset1 = (right * glm::cos(angle1) + up * glm::sin(angle1)) * radius;
            glm::vec3 offset2 = (right * glm::cos(angle2) + up * glm::sin(angle2)) * radius;

            glm::vec3 s1 = start + offset1, s2 = start + offset2;
            glm::vec3 e1 = end + offset1, e2 = end + offset2;

            addVertex(s1, color);
            addVertex(e1, color);
            addVertex(e2, color);

            addVertex(s1, color);
            addVertex(e2, color);
            addVertex(s2, color);
        }
    };

    auto addSphere = [&](const glm::vec3& center, f32 radius, const glm::vec4& color,
                         i32 rings = 8, i32 sectors = 12) {
        for (i32 r = 0; r < rings; ++r) {
            f32 theta1 = (f32(r) / rings) * glm::pi<f32>();
            f32 theta2 = (f32(r + 1) / rings) * glm::pi<f32>();

            for (i32 s = 0; s < sectors; ++s) {
                f32 phi1 = (f32(s) / sectors) * glm::two_pi<f32>();
                f32 phi2 = (f32(s + 1) / sectors) * glm::two_pi<f32>();

                glm::vec3 n1(glm::sin(theta1) * glm::cos(phi1), glm::cos(theta1), glm::sin(theta1) * glm::sin(phi1));
                glm::vec3 n2(glm::sin(theta1) * glm::cos(phi2), glm::cos(theta1), glm::sin(theta1) * glm::sin(phi2));
                glm::vec3 n3(glm::sin(theta2) * glm::cos(phi2), glm::cos(theta2), glm::sin(theta2) * glm::sin(phi2));
                glm::vec3 n4(glm::sin(theta2) * glm::cos(phi1), glm::cos(theta2), glm::sin(theta2) * glm::sin(phi1));

                addVertex(center + n1 * radius, color);
                addVertex(center + n3 * radius, color);
                addVertex(center + n2 * radius, color);

                addVertex(center + n1 * radius, color);
                addVertex(center + n4 * radius, color);
                addVertex(center + n3 * radius, color);
            }
        }
    };

    glm::vec4 red(0.9f, 0.2f, 0.2f, 0.9f);
    glm::vec4 green(0.3f, 0.85f, 0.3f, 0.9f);
    glm::vec4 blue(0.3f, 0.5f, 0.95f, 0.9f);
    glm::vec4 dimRed(0.5f, 0.2f, 0.2f, 0.5f);
    glm::vec4 dimGreen(0.2f, 0.45f, 0.2f, 0.5f);
    glm::vec4 dimBlue(0.2f, 0.3f, 0.55f, 0.5f);
    glm::vec4 gray(0.45f, 0.45f, 0.5f, 0.85f);

    f32 shaftLen = 0.6f;
    f32 shaftRadius = 0.04f;
    f32 coneLen = 0.35f;
    f32 coneRadius = 0.12f;

    addCylinder(glm::vec3(0), glm::vec3(shaftLen, 0, 0), shaftRadius, red);
    addCone(glm::vec3(shaftLen, 0, 0), glm::vec3(shaftLen + coneLen, 0, 0), coneRadius, red);

    addCylinder(glm::vec3(0), glm::vec3(0, shaftLen, 0), shaftRadius, green);
    addCone(glm::vec3(0, shaftLen, 0), glm::vec3(0, shaftLen + coneLen, 0), coneRadius, green);

    addCylinder(glm::vec3(0), glm::vec3(0, 0, shaftLen), shaftRadius, blue);
    addCone(glm::vec3(0, 0, shaftLen), glm::vec3(0, 0, shaftLen + coneLen), coneRadius, blue);

    f32 backDist = 0.35f;
    f32 backRadius = 0.08f;
    addSphere(glm::vec3(-backDist, 0, 0), backRadius, dimRed);
    addSphere(glm::vec3(0, -backDist, 0), backRadius, dimGreen);
    addSphere(glm::vec3(0, 0, -backDist), backRadius, dimBlue);

    addSphere(glm::vec3(0), 0.1f, gray);

    axisVertexCount_ = static_cast<u32>(vertices.size() / 7);

    axisVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
    vbo->setLayout({
        { ShaderDataType::Float3, "a_position" },
        { ShaderDataType::Float4, "a_color" }
    });

    axisVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

    axisShader_ = Shader::create(AXIS_VERTEX_SHADER, AXIS_FRAGMENT_SHADER);

    axisInitialized_ = true;
}

void SceneViewPanel::renderAxisGizmo() {
    if (!axisInitialized_) {
        initAxisGizmoData();
    }

    if (!axisVAO_ || !axisShader_) return;

    const ui::Rect& bounds = getBounds();
    f32 gizmoSize = 60.0f;
    f32 padding = 12.0f;

    axisGizmoCenter_ = glm::vec2(
        bounds.x + bounds.width - gizmoSize - padding,
        bounds.y + gizmoSize + padding
    );

    GLint savedViewport[4];
    glGetIntegerv(GL_VIEWPORT, savedViewport);

    f32 vpX = axisGizmoCenter_.x - gizmoSize;
    f32 vpY = savedViewport[3] - axisGizmoCenter_.y - gizmoSize;
    glViewport(static_cast<GLint>(vpX), static_cast<GLint>(vpY),
               static_cast<GLsizei>(gizmoSize * 2), static_cast<GLsizei>(gizmoSize * 2));

    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glClear(GL_DEPTH_BUFFER_BIT);

    glm::mat4 rotation = glm::mat4_cast(glm::conjugate(glm::quat(glm::vec3(-camera_.getPitch(), -camera_.getYaw(), 0.0f))));
    glm::mat4 proj = glm::ortho(-1.5f, 1.5f, -1.5f, 1.5f, -10.0f, 10.0f);
    glm::mat4 viewProj = proj * rotation;

    axisShader_->bind();
    axisShader_->setUniform("u_viewProj", viewProj);

    axisVAO_->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(axisVertexCount_));

    glDisable(GL_DEPTH_TEST);
    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
}

i32 SceneViewPanel::hitTestAxisGizmo(f32 x, f32 y) {
    f32 localX = x - axisGizmoCenter_.x;
    f32 localY = y - axisGizmoCenter_.y;

    f32 dist = glm::sqrt(localX * localX + localY * localY);
    if (dist > axisGizmoRadius_ * 2.0f) return -1;

    glm::quat camOrientation = glm::quat(glm::vec3(-camera_.getPitch(), -camera_.getYaw(), 0.0f));
    glm::mat4 rotation = glm::mat4_cast(glm::conjugate(camOrientation));

    f32 posAxisDist = 0.95f;
    f32 negAxisDist = 0.35f;
    f32 scale = axisGizmoRadius_ / 1.5f;

    glm::vec3 xPos = glm::vec3(rotation * glm::vec4(posAxisDist, 0, 0, 0));
    glm::vec3 yPos = glm::vec3(rotation * glm::vec4(0, posAxisDist, 0, 0));
    glm::vec3 zPos = glm::vec3(rotation * glm::vec4(0, 0, posAxisDist, 0));
    glm::vec3 xNeg = glm::vec3(rotation * glm::vec4(-negAxisDist, 0, 0, 0));
    glm::vec3 yNeg = glm::vec3(rotation * glm::vec4(0, -negAxisDist, 0, 0));
    glm::vec3 zNeg = glm::vec3(rotation * glm::vec4(0, 0, -negAxisDist, 0));

    glm::vec2 screenXPos = glm::vec2(xPos.x, -xPos.y) * scale;
    glm::vec2 screenYPos = glm::vec2(yPos.x, -yPos.y) * scale;
    glm::vec2 screenZPos = glm::vec2(zPos.x, -zPos.y) * scale;
    glm::vec2 screenXNeg = glm::vec2(xNeg.x, -xNeg.y) * scale;
    glm::vec2 screenYNeg = glm::vec2(yNeg.x, -yNeg.y) * scale;
    glm::vec2 screenZNeg = glm::vec2(zNeg.x, -zNeg.y) * scale;

    glm::vec2 clickPos(localX, localY);
    f32 threshold = 18.0f;
    f32 smallThreshold = 12.0f;

    if (glm::length(clickPos - screenXPos) < threshold) return 0;
    if (glm::length(clickPos - screenYPos) < threshold) return 1;
    if (glm::length(clickPos - screenZPos) < threshold) return 2;

    if (glm::length(clickPos - screenXNeg) < smallThreshold) return 3;
    if (glm::length(clickPos - screenYNeg) < smallThreshold) return 4;
    if (glm::length(clickPos - screenZNeg) < smallThreshold) return 5;

    return -1;
}

void SceneViewPanel::setViewToTop() {
    camera_.animateTo(glm::half_pi<f32>() - 0.01f, 0.0f);
}

void SceneViewPanel::setViewToBottom() {
    camera_.animateTo(-glm::half_pi<f32>() + 0.01f, 0.0f);
}

void SceneViewPanel::setViewToFront() {
    camera_.animateTo(0.0f, 0.0f);
}

void SceneViewPanel::setViewToBack() {
    camera_.animateTo(0.0f, glm::pi<f32>());
}

void SceneViewPanel::setViewToRight() {
    camera_.animateTo(0.0f, -glm::half_pi<f32>());
}

void SceneViewPanel::setViewToLeft() {
    camera_.animateTo(0.0f, glm::half_pi<f32>());
}

void SceneViewPanel::setViewMode(ViewMode mode) {
    if (viewMode_ == mode) return;

    viewMode_ = mode;

    if (mode == ViewMode::Mode2D) {
        camera_.animateTo(glm::half_pi<f32>() - 0.01f, 0.0f);
    } else {
        camera_.animateTo(0.5f, 0.5f);
    }
}

void SceneViewPanel::initAxisGizmo2DData() {
    std::vector<f32> vertices;

    auto addVertex = [&vertices](const glm::vec3& pos, const glm::vec4& color) {
        vertices.insert(vertices.end(), {pos.x, pos.y, pos.z, color.r, color.g, color.b, color.a});
    };

    auto addArrow2D = [&](const glm::vec3& start, const glm::vec3& end, f32 thickness, f32 headSize,
                          const glm::vec4& color) {
        glm::vec3 dir = glm::normalize(end - start);
        glm::vec3 perp(-dir.y, dir.x, 0.0f);

        glm::vec3 shaftEnd = end - dir * headSize;

        glm::vec3 s1 = start + perp * thickness;
        glm::vec3 s2 = start - perp * thickness;
        glm::vec3 e1 = shaftEnd + perp * thickness;
        glm::vec3 e2 = shaftEnd - perp * thickness;

        addVertex(s1, color);
        addVertex(e1, color);
        addVertex(e2, color);
        addVertex(s1, color);
        addVertex(e2, color);
        addVertex(s2, color);

        glm::vec3 h1 = shaftEnd + perp * headSize * 0.5f;
        glm::vec3 h2 = shaftEnd - perp * headSize * 0.5f;

        addVertex(end, color);
        addVertex(h1, color);
        addVertex(h2, color);
    };

    glm::vec4 red(0.9f, 0.2f, 0.2f, 0.9f);
    glm::vec4 green(0.3f, 0.85f, 0.3f, 0.9f);

    f32 length = 0.8f;
    f32 thickness = 0.04f;
    f32 headSize = 0.2f;

    addArrow2D(glm::vec3(0), glm::vec3(length, 0, 0), thickness, headSize, red);
    addArrow2D(glm::vec3(0), glm::vec3(0, length, 0), thickness, headSize, green);

    axis2DVertexCount_ = static_cast<u32>(vertices.size() / 7);

    axis2DVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
    vbo->setLayout({
        { ShaderDataType::Float3, "a_position" },
        { ShaderDataType::Float4, "a_color" }
    });

    axis2DVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

    axis2DInitialized_ = true;
}

void SceneViewPanel::renderAxisGizmo2D() {
    if (!axis2DInitialized_) {
        initAxisGizmo2DData();
    }

    if (!axis2DVAO_ || !axisShader_) return;

    const ui::Rect& bounds = getBounds();
    f32 gizmoSize = 50.0f;
    f32 padding = 12.0f;

    axisGizmoCenter_ = glm::vec2(
        bounds.x + bounds.width - gizmoSize - padding,
        bounds.y + gizmoSize + padding
    );

    GLint savedViewport[4];
    glGetIntegerv(GL_VIEWPORT, savedViewport);

    f32 vpX = axisGizmoCenter_.x - gizmoSize;
    f32 vpY = savedViewport[3] - axisGizmoCenter_.y - gizmoSize;
    glViewport(static_cast<GLint>(vpX), static_cast<GLint>(vpY),
               static_cast<GLsizei>(gizmoSize * 2), static_cast<GLsizei>(gizmoSize * 2));

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    glm::mat4 proj = glm::ortho(-1.2f, 1.2f, -1.2f, 1.2f, -1.0f, 1.0f);

    axisShader_->bind();
    axisShader_->setUniform("u_viewProj", proj);

    axis2DVAO_->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(axis2DVertexCount_));

    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
}

i32 SceneViewPanel::hitTestAxisGizmo2D(f32 x, f32 y) {
    (void)x;
    (void)y;
    return -1;
}

}  // namespace esengine::editor
