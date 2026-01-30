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
#include "../../ecs/components/Canvas.hpp"
#include "../../core/Log.hpp"
#include "../command/TransformCommand.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

#include "../../ui/font/SystemFont.hpp"

#include <glad/glad.h>
#include <cstdio>
#include <vector>
#include <chrono>

#ifndef GL_VIEWPORT
#define GL_VIEWPORT 0x0BA2
#endif

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

SceneViewPanel::SceneViewPanel(ecs::Registry& registry, EntitySelection& selection,
                               resource::ResourceManager& resourceManager)
    : DockPanel(ui::WidgetId("scene_view_panel"), "Scene"),
      registry_(registry),
      selection_(selection),
      resourceManager_(resourceManager) {

    FramebufferSpec spec;
    spec.width = viewportWidth_;
    spec.height = viewportHeight_;
    spec.depthStencil = true;
    framebuffer_ = Framebuffer::create(spec);

    camera_.setViewportSize(static_cast<f32>(viewportWidth_), static_cast<f32>(viewportHeight_));
    camera_.setFocalPoint(glm::vec3(0.0f));
    camera_.setDistance(10.0f);

    toolbar_ = makeUnique<SceneToolbar>(ui::WidgetId("scene_toolbar"));

    connections_.add(sink(toolbar_->onViewModeChanged).connect([this](ViewMode mode) {
        setViewMode(mode);
    }));

    connections_.add(sink(toolbar_->onGridVisibilityChanged).connect([this](bool visible) {
        gridVisible_ = visible;
    }));

    connections_.add(sink(toolbar_->onGizmosVisibilityChanged).connect([this](bool visible) {
        gizmosVisible_ = visible;
    }));

    transformGizmo_ = makeUnique<TransformGizmo>(resourceManager);
    transformGizmo_->setSize(1.5f);

    connections_.add(sink(toolbar_->onGizmoModeChanged).connect([this](GizmoMode mode) {
        transformGizmo_->setMode(mode);
    }));

    connections_.add(sink(toolbar_->onStatsVisibilityChanged).connect([this](bool visible) {
        stats_visible_ = visible;
    }));

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
    f32 deltaTime = static_cast<f32>(currentTime - last_frame_time_);
    prev_frame_time_ = last_frame_time_;
    last_frame_time_ = currentTime;

    if (deltaTime > 0.0f && deltaTime < 1.0f) {
        camera_.update(deltaTime);
    }

    const ui::Rect& bounds = getBounds();

    ui::Rect toolbarBounds = {bounds.x, bounds.y, bounds.width, SceneToolbar::HEIGHT};
    viewportBounds_ = {
        bounds.x,
        bounds.y + SceneToolbar::HEIGHT,
        bounds.width,
        bounds.height - SceneToolbar::HEIGHT
    };

    u32 newWidth = static_cast<u32>(viewportBounds_.width);
    u32 newHeight = static_cast<u32>(viewportBounds_.height);

    if (newWidth != viewportWidth_ || newHeight != viewportHeight_) {
        setViewportSize(newWidth, newHeight);
    }

    if (framebufferNeedsResize_) {
        updateFramebufferSize();
    }

    if (framebuffer_) {
        renderSceneToTexture();

        renderer.drawTexturedRect(
            viewportBounds_,
            framebuffer_->getColorAttachment(),
            glm::vec4(1.0f),
            glm::vec2(0.0f, 1.0f),
            glm::vec2(1.0f, 0.0f)
        );

        renderer.flush();
        if (gizmosVisible_) {
            if (viewMode_ == ViewMode::Mode3D) {
                renderAxisGizmo();
            } else {
                renderAxisGizmo2D();
            }
        }

        if (stats_visible_) {
            renderStats(renderer);
        }
    }

    if (toolbar_) {
        toolbar_->setContext(getContext());
        toolbar_->measure(toolbarBounds.width, toolbarBounds.height);
        toolbar_->layout(toolbarBounds);
        toolbar_->render(renderer);
    }
}

bool SceneViewPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (toolbar_ && toolbar_->getBounds().contains(event.x, event.y)) {
        return toolbar_->onMouseDown(event);
    }

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

    if (event.button == ui::MouseButton::Left && !event.alt) {
        if (viewportBounds_.contains(event.x, event.y)) {
            glm::vec3 rayOrigin, rayDir;
            screenToWorldRay(event.x, event.y, rayOrigin, rayDir);

            if (gizmosVisible_ && selection_.count() > 0) {
                GizmoAxis axis = transformGizmo_->hitTest(rayOrigin, rayDir);
                if (axis != GizmoAxis::None) {
                    Entity selected = selection_.getFirst();
                    if (selected != INVALID_ENTITY && registry_.has<ecs::LocalTransform>(selected)) {
                        draggingEntity_ = selected;
                        dragStartTransform_ = registry_.get<ecs::LocalTransform>(selected);
                    }
                    transformGizmo_->startDrag(axis, rayOrigin, rayDir);
                    return true;
                }
            }

            Entity hit = pickEntity(rayOrigin, rayDir);
            if (hit != INVALID_ENTITY) {
                if (event.ctrl) {
                    selection_.toggleSelection(hit);
                } else {
                    selection_.select(hit);
                }
            } else if (!event.ctrl) {
                selection_.clear();
            }
            return true;
        }
    }

    camera_.onMouseDown(event);
    return true;
}

bool SceneViewPanel::onMouseUp(const ui::MouseButtonEvent& event) {
    if (transformGizmo_->isDragging()) {
        transformGizmo_->endDrag();

        if (commandHistory_ && draggingEntity_ != INVALID_ENTITY &&
            registry_.has<ecs::LocalTransform>(draggingEntity_)) {
            const auto& currentTransform = registry_.get<ecs::LocalTransform>(draggingEntity_);

            if (currentTransform.position != dragStartTransform_.position ||
                currentTransform.rotation != dragStartTransform_.rotation ||
                currentTransform.scale != dragStartTransform_.scale) {
                commandHistory_->execute(makeUnique<TransformCommand>(
                    registry_, draggingEntity_, dragStartTransform_, currentTransform));
            }
        }

        draggingEntity_ = INVALID_ENTITY;
    }
    camera_.onMouseUp(event);
    return true;
}

bool SceneViewPanel::onMouseMove(const ui::MouseMoveEvent& event) {
    if (toolbar_) {
        toolbar_->onMouseMove(event);
    }

    if (transformGizmo_->isDragging()) {
        glm::vec3 rayOrigin, rayDir;
        screenToWorldRay(event.x, event.y, rayOrigin, rayDir);

        glm::vec3 delta = transformGizmo_->updateDrag(rayOrigin, rayDir);

        Entity selected = selection_.getFirst();
        if (selected != INVALID_ENTITY && registry_.has<ecs::LocalTransform>(selected)) {
            auto& transform = registry_.get<ecs::LocalTransform>(selected);

            switch (transformGizmo_->getMode()) {
                case GizmoMode::Translate:
                    transform.position = dragStartTransform_.position + delta;
                    break;
                case GizmoMode::Scale:
                    transform.scale = dragStartTransform_.scale + delta;
                    break;
                case GizmoMode::Rotate: {
                    f32 rotationDelta = transformGizmo_->getRotationDelta();
                    GizmoAxis axis = transformGizmo_->getActiveAxis();
                    glm::vec3 rotationAxis(0.0f);
                    if (axis == GizmoAxis::X) {
                        rotationAxis = glm::vec3(1, 0, 0);
                    } else if (axis == GizmoAxis::Y) {
                        rotationAxis = glm::vec3(0, 1, 0);
                    } else if (axis == GizmoAxis::Z) {
                        rotationAxis = glm::vec3(0, 0, 1);
                    }
                    glm::quat deltaRotation = glm::angleAxis(rotationDelta, rotationAxis);
                    transform.rotation = deltaRotation * dragStartTransform_.rotation;
                    break;
                }
            }
        }
        return true;
    }

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

    if (viewMode_ == ViewMode::Mode2D) {
        if (gridVisible_) {
            if (!grid2DInitialized_) {
                initGrid2DData();
            }
            renderGrid2D(viewProj);
        }
        if (gizmosVisible_) {
            renderCanvasGizmo(viewProj);
        }
    } else {
        if (gridVisible_) {
            if (!gridInitialized_) {
                initGridData();
            }
            renderGrid(viewProj);
        }
    }
    renderSprites(viewProj);

    if (gizmosVisible_ && selection_.count() > 0) {
        renderSelectionBox(viewProj);

        Entity selected = selection_.getFirst();
        if (selected != INVALID_ENTITY) {
            transformGizmo_->render(view, proj, selected, registry_);
        }
    }
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

    gridShaderHandle_ = resourceManager_.loadEngineShader("grid");

    gridInitialized_ = true;
    ES_LOG_DEBUG("Grid initialized with {} vertices", gridVertexCount_);
}

void SceneViewPanel::renderGrid(const glm::mat4& viewProj) {
    Shader* gridShader = resourceManager_.getShader(gridShaderHandle_);
    if (!gridVAO_ || !gridShader) return;

    gridShader->bind();
    gridShader->setUniform("u_viewProj", viewProj);
    gridShader->setUniform("u_color", glm::vec4(0.3f, 0.3f, 0.3f, 1.0f));

    gridVAO_->bind();
    glDrawArrays(GL_LINES, 0, static_cast<GLsizei>(gridVertexCount_));
}

void SceneViewPanel::initGrid2DData() {
    std::vector<f32> vertices;

    constexpr f32 gridSize = 100.0f;
    constexpr f32 gridStep = 1.0f;

    for (f32 x = -gridSize; x <= gridSize; x += gridStep) {
        vertices.push_back(x);
        vertices.push_back(-gridSize);
        vertices.push_back(0.0f);

        vertices.push_back(x);
        vertices.push_back(gridSize);
        vertices.push_back(0.0f);
    }

    for (f32 y = -gridSize; y <= gridSize; y += gridStep) {
        vertices.push_back(-gridSize);
        vertices.push_back(y);
        vertices.push_back(0.0f);

        vertices.push_back(gridSize);
        vertices.push_back(y);
        vertices.push_back(0.0f);
    }

    grid2DVertexCount_ = static_cast<u32>(vertices.size() / 3);

    grid2DVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
    vbo->setLayout({
        { ShaderDataType::Float3, "a_position" }
    });

    grid2DVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

    if (!gridShaderHandle_.isValid()) {
        gridShaderHandle_ = resourceManager_.loadEngineShader("grid");
    }

    grid2DInitialized_ = true;
    ES_LOG_DEBUG("2D Grid initialized with {} vertices", grid2DVertexCount_);
}

void SceneViewPanel::renderGrid2D(const glm::mat4& viewProj) {
    Shader* gridShader = resourceManager_.getShader(gridShaderHandle_);
    if (!grid2DVAO_ || !gridShader) return;

    gridShader->bind();
    gridShader->setUniform("u_viewProj", viewProj);
    gridShader->setUniform("u_color", glm::vec4(0.3f, 0.3f, 0.3f, 1.0f));

    grid2DVAO_->bind();
    glDrawArrays(GL_LINES, 0, static_cast<GLsizei>(grid2DVertexCount_));
}

void SceneViewPanel::renderSprites(const glm::mat4& viewProj) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    RenderContext& renderCtx = ctx->getRenderContext();

    // Lazy initialize RenderPipeline
    if (!renderPipeline_) {
        renderPipeline_ = makeUnique<RenderPipeline>(renderCtx, resourceManager_);
    }

    // Use RenderPipeline for sprite rendering
    renderPipeline_->begin(viewProj);
    renderPipeline_->submit(registry_);
    renderPipeline_->end();
}

void SceneViewPanel::renderSelectionBox(const glm::mat4& viewProj) {
    Shader* shader = resourceManager_.getShader(resourceManager_.loadEngineShader("gizmo"));
    if (!shader) return;

    glDisable(GL_DEPTH_TEST);

    const auto& selectedEntities = selection_.getSelected();
    for (Entity entity : selectedEntities) {
        if (!registry_.valid(entity) || !registry_.has<ecs::LocalTransform>(entity)) {
            continue;
        }

        const auto& transform = registry_.get<ecs::LocalTransform>(entity);

        glm::vec3 halfSize(0.5f);
        if (registry_.has<ecs::Sprite>(entity)) {
            const auto& sprite = registry_.get<ecs::Sprite>(entity);
            halfSize = glm::vec3(sprite.size.x * 0.5f * transform.scale.x, sprite.size.y * 0.5f * transform.scale.y, 0.01f);
        }

        glm::mat4 model = glm::translate(glm::mat4(1.0f), transform.position);
        model *= glm::mat4_cast(transform.rotation);

        glm::vec4 color(1.0f, 0.6f, 0.0f, 1.0f);

        glm::vec3 corners[8] = {
            glm::vec3(-halfSize.x, -halfSize.y, -halfSize.z),
            glm::vec3( halfSize.x, -halfSize.y, -halfSize.z),
            glm::vec3( halfSize.x,  halfSize.y, -halfSize.z),
            glm::vec3(-halfSize.x,  halfSize.y, -halfSize.z),
            glm::vec3(-halfSize.x, -halfSize.y,  halfSize.z),
            glm::vec3( halfSize.x, -halfSize.y,  halfSize.z),
            glm::vec3( halfSize.x,  halfSize.y,  halfSize.z),
            glm::vec3(-halfSize.x,  halfSize.y,  halfSize.z)
        };

        std::vector<f32> vertices;
        auto addLine = [&](i32 a, i32 b) {
            vertices.insert(vertices.end(), {corners[a].x, corners[a].y, corners[a].z, color.r, color.g, color.b, color.a});
            vertices.insert(vertices.end(), {corners[b].x, corners[b].y, corners[b].z, color.r, color.g, color.b, color.a});
        };

        // Bottom face
        addLine(0, 1); addLine(1, 2); addLine(2, 3); addLine(3, 0);
        // Top face
        addLine(4, 5); addLine(5, 6); addLine(6, 7); addLine(7, 4);
        // Vertical edges
        addLine(0, 4); addLine(1, 5); addLine(2, 6); addLine(3, 7);

        Unique<VertexArray> vao = VertexArray::create();
        auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
        vbo->setLayout({
            { ShaderDataType::Float3, "a_position" },
            { ShaderDataType::Float4, "a_color" }
        });
        vao->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

        shader->bind();
        shader->setUniform("u_viewProj", viewProj);
        shader->setUniform("u_model", model);

        vao->bind();
        glDrawArrays(GL_LINES, 0, 24);
        vao->unbind();
    }

    glEnable(GL_DEPTH_TEST);
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

    axisShaderHandle_ = resourceManager_.loadEngineShader("axis");

    axisInitialized_ = true;
}

void SceneViewPanel::renderAxisGizmo() {
    if (!axisInitialized_) {
        initAxisGizmoData();
    }

    Shader* axisShader = resourceManager_.getShader(axisShaderHandle_);
    if (!axisVAO_ || !axisShader) return;

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

    axisShader->bind();
    axisShader->setUniform("u_viewProj", viewProj);

    axisVAO_->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(axisVertexCount_));
    axisVAO_->unbind();
    axisShader->unbind();

    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
    glDisable(GL_DEPTH_TEST);
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

    if (transformGizmo_) {
        transformGizmo_->set2DMode(mode == ViewMode::Mode2D);
    }

    if (mode == ViewMode::Mode2D) {
        camera_.animateTo(0.0f, 0.0f);
        camera_.setOrbitEnabled(false);
    } else {
        camera_.animateTo(0.5f, 0.5f);
        camera_.setOrbitEnabled(true);
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

    Shader* axisShader = resourceManager_.getShader(axisShaderHandle_);
    if (!axis2DVAO_ || !axisShader) return;

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

    glDisable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    glm::mat4 proj = glm::ortho(-1.2f, 1.2f, -1.2f, 1.2f, -1.0f, 1.0f);

    axisShader->bind();
    axisShader->setUniform("u_viewProj", proj);

    axis2DVAO_->bind();
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(axis2DVertexCount_));
    axis2DVAO_->unbind();
    axisShader->unbind();

    glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
}

i32 SceneViewPanel::hitTestAxisGizmo2D(f32 x, f32 y) {
    (void)x;
    (void)y;
    return -1;
}

Entity SceneViewPanel::findCanvas() {
    auto view = registry_.view<ecs::Canvas>();
    for (auto entity : view) {
        return entity;
    }
    return INVALID_ENTITY;
}

void SceneViewPanel::initCanvasGizmoData() {
    std::vector<f32> vertices;

    // Simple rectangle (4 corners, 8 vertices for lines)
    // We'll draw as GL_LINES so we need pairs
    // Bottom: (-1,-1) to (1,-1)
    // Right:  (1,-1) to (1,1)
    // Top:    (1,1) to (-1,1)
    // Left:   (-1,1) to (-1,-1)
    f32 rect[] = {
        -1.0f, -1.0f, 0.0f,   1.0f, -1.0f, 0.0f,
         1.0f, -1.0f, 0.0f,   1.0f,  1.0f, 0.0f,
         1.0f,  1.0f, 0.0f,  -1.0f,  1.0f, 0.0f,
        -1.0f,  1.0f, 0.0f,  -1.0f, -1.0f, 0.0f
    };

    for (f32 v : rect) {
        vertices.push_back(v);
    }

    canvasGizmoVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices.data(), static_cast<u32>(vertices.size() * sizeof(f32)));
    vbo->setLayout({
        { ShaderDataType::Float3, "a_position" }
    });

    canvasGizmoVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));

    canvasGizmoInitialized_ = true;
}

void SceneViewPanel::renderCanvasGizmo(const glm::mat4& viewProj) {
    Entity canvasEntity = findCanvas();
    if (canvasEntity == INVALID_ENTITY) return;

    auto* canvas = registry_.tryGet<ecs::Canvas>(canvasEntity);
    if (!canvas) return;

    if (!canvasGizmoInitialized_) {
        initCanvasGizmoData();
    }

    Shader* gridShader = resourceManager_.getShader(gridShaderHandle_);
    if (!canvasGizmoVAO_ || !gridShader) return;

    glm::vec2 worldSize = canvas->getWorldSize();
    f32 halfWidth = worldSize.x * 0.5f;
    f32 halfHeight = worldSize.y * 0.5f;

    glm::mat4 model = glm::scale(glm::mat4(1.0f), glm::vec3(halfWidth, halfHeight, 1.0f));
    glm::mat4 mvp = viewProj * model;

    gridShader->bind();
    gridShader->setUniform("u_viewProj", mvp);
    gridShader->setUniform("u_color", glm::vec4(0.4f, 0.8f, 1.0f, 0.8f));

    canvasGizmoVAO_->bind();
    glDrawArrays(GL_LINES, 0, 8);
}

void SceneViewPanel::renderStats(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* font = ctx->getDefaultMSDFFont();
#else
    ui::SystemFont* font = ctx->getDefaultSystemFont();
#endif
    if (!font) return;

    RenderPipeline::Stats stats{};
    if (renderPipeline_) {
        stats = renderPipeline_->getStats();
    }

    f64 frameDelta = last_frame_time_ - prev_frame_time_;
    f32 fps = (frameDelta > 0.001) ? 1.0f / static_cast<f32>(frameDelta) : 0.0f;
    f32 frameMs = static_cast<f32>(frameDelta * 1000.0);

    constexpr f32 padding = 10.0f;
    constexpr f32 lineHeight = 16.0f;
    constexpr f32 fontSize = 11.0f;
    constexpr f32 panelWidth = 160.0f;
    constexpr f32 panelHeight = 180.0f;
    constexpr f32 sectionGap = 6.0f;

    ui::Rect panelBounds = {
        viewportBounds_.x + padding,
        viewportBounds_.y + viewportBounds_.height - panelHeight - padding,
        panelWidth,
        panelHeight
    };

    constexpr glm::vec4 bgColor{0.08f, 0.08f, 0.10f, 0.92f};
    constexpr glm::vec4 headerColor{0.4f, 0.7f, 1.0f, 1.0f};
    constexpr glm::vec4 valueColor{0.9f, 0.9f, 0.9f, 1.0f};
    constexpr glm::vec4 labelColor{0.6f, 0.6f, 0.6f, 1.0f};

    renderer.drawRoundedRect(panelBounds, bgColor, ui::CornerRadii::all(6.0f));

    f32 y = panelBounds.y + padding;
    f32 x = panelBounds.x + padding;
    char buffer[64];

    renderer.drawText("Rendering", glm::vec2(x, y), *font, fontSize, headerColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "FPS: %.1f (%.2fms)", fps, frameMs);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, valueColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Draw Calls: %u", stats.draw_calls);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, valueColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Tris: %u  Verts: %u", stats.triangles, stats.vertices);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, valueColor);
    y += lineHeight + sectionGap;

    renderer.drawText("Batching", glm::vec2(x, y), *font, fontSize, headerColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Batches: %u", stats.batch_count);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, valueColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Tex Switches: %u", stats.texture_switches);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, labelColor);
    y += lineHeight + sectionGap;

    renderer.drawText("Scene", glm::vec2(x, y), *font, fontSize, headerColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Sprites: %u", stats.total_items);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, valueColor);
    y += lineHeight;

    snprintf(buffer, sizeof(buffer), "Visible: %u  Culled: %u", stats.visible_items, stats.culled_items);
    renderer.drawText(buffer, glm::vec2(x, y), *font, fontSize, labelColor);
}

// =============================================================================
// Ray Picking
// =============================================================================

void SceneViewPanel::screenToWorldRay(f32 screenX, f32 screenY,
                                       glm::vec3& rayOrigin, glm::vec3& rayDir) {
    f32 localX = screenX - viewportBounds_.x;
    f32 localY = screenY - viewportBounds_.y;

    f32 ndcX = (localX / viewportBounds_.width) * 2.0f - 1.0f;
    f32 ndcY = 1.0f - (localY / viewportBounds_.height) * 2.0f;

    glm::mat4 view = camera_.getViewMatrix();
    glm::mat4 proj = camera_.getProjectionMatrix();
    glm::mat4 invViewProj = glm::inverse(proj * view);

    glm::vec4 nearPoint = invViewProj * glm::vec4(ndcX, ndcY, -1.0f, 1.0f);
    glm::vec4 farPoint = invViewProj * glm::vec4(ndcX, ndcY, 1.0f, 1.0f);

    nearPoint /= nearPoint.w;
    farPoint /= farPoint.w;

    rayOrigin = glm::vec3(nearPoint);
    rayDir = glm::normalize(glm::vec3(farPoint - nearPoint));
}

bool SceneViewPanel::rayIntersectsAABB(const glm::vec3& rayOrigin, const glm::vec3& rayDir,
                                        const glm::vec3& boxMin, const glm::vec3& boxMax, f32& t) {
    glm::vec3 invDir = 1.0f / rayDir;

    glm::vec3 t1 = (boxMin - rayOrigin) * invDir;
    glm::vec3 t2 = (boxMax - rayOrigin) * invDir;

    glm::vec3 tMin = glm::min(t1, t2);
    glm::vec3 tMax = glm::max(t1, t2);

    f32 tNear = glm::max(glm::max(tMin.x, tMin.y), tMin.z);
    f32 tFar = glm::min(glm::min(tMax.x, tMax.y), tMax.z);

    if (tNear > tFar || tFar < 0.0f) {
        return false;
    }

    t = tNear >= 0.0f ? tNear : tFar;
    return true;
}

Entity SceneViewPanel::pickEntity(const glm::vec3& rayOrigin, const glm::vec3& rayDir) {
    f32 closestDist = std::numeric_limits<f32>::max();
    Entity closestEntity = INVALID_ENTITY;

    auto spriteView = registry_.view<ecs::LocalTransform, ecs::Sprite>();
    for (auto entity : spriteView) {
        const auto& transform = spriteView.get<ecs::LocalTransform>(entity);
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);

        glm::vec3 halfSize(sprite.size.x * 0.5f, sprite.size.y * 0.5f, 0.1f);
        glm::vec3 boxMin = transform.position - halfSize;
        glm::vec3 boxMax = transform.position + halfSize;

        f32 t;
        if (rayIntersectsAABB(rayOrigin, rayDir, boxMin, boxMax, t)) {
            if (t < closestDist) {
                closestDist = t;
                closestEntity = entity;
            }
        }
    }

    return closestEntity;
}

}  // namespace esengine::editor
