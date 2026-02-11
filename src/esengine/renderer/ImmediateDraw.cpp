/**
 * @file    ImmediateDraw.cpp
 * @brief   Immediate mode 2D drawing implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ImmediateDraw.hpp"
#include "Renderer.hpp"
#include "RenderContext.hpp"
#include "../resource/ResourceManager.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <glm/gtc/constants.hpp>
#include <cmath>

namespace esengine {

struct ImmediateDraw::Impl {
    Unique<BatchRenderer2D> batcher;
    glm::mat4 viewProjection{1.0f};
};

ImmediateDraw::ImmediateDraw(RenderContext& context,
                             resource::ResourceManager& resource_manager)
    : impl_(makeUnique<Impl>())
    , context_(context)
    , resource_manager_(resource_manager) {
}

ImmediateDraw::~ImmediateDraw() {
    if (initialized_) {
        shutdown();
    }
}

void ImmediateDraw::init() {
    if (initialized_) return;

    impl_->batcher = makeUnique<BatchRenderer2D>(context_, resource_manager_);
    impl_->batcher->init();

    initialized_ = true;
    ES_LOG_INFO("ImmediateDraw initialized");
}

void ImmediateDraw::shutdown() {
    if (!initialized_) return;

    if (impl_->batcher) {
        impl_->batcher->shutdown();
        impl_->batcher.reset();
    }

    initialized_ = false;
    ES_LOG_INFO("ImmediateDraw shutdown");
}

void ImmediateDraw::begin(const glm::mat4& viewProjection) {
    if (!initialized_) return;

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_DEPTH_TEST);

    impl_->viewProjection = viewProjection;
    impl_->batcher->setProjection(viewProjection);
    impl_->batcher->beginBatch();

    primitiveCount_ = 0;
    inFrame_ = true;
}

void ImmediateDraw::end() {
    if (!initialized_ || !inFrame_) return;

    impl_->batcher->endBatch();
    inFrame_ = false;
}

void ImmediateDraw::flush() {
    if (!initialized_ || !inFrame_) return;

    impl_->batcher->flush();
}

void ImmediateDraw::line(const glm::vec2& from, const glm::vec2& to,
                         const glm::vec4& color, f32 thickness) {
    if (!inFrame_) return;

    glm::vec2 delta = to - from;
    f32 length = glm::length(delta);
    if (length < 0.0001f) return;

    glm::vec2 dir = delta / length;
    glm::vec2 center = (from + to) * 0.5f;
    glm::vec2 size(length, thickness);

    f32 angle = std::atan2(dir.y, dir.x);

    impl_->batcher->drawRotatedQuad(center, size, angle, color);
    primitiveCount_++;
}

void ImmediateDraw::polyline(std::span<const glm::vec2> vertices,
                             const glm::vec4& color, f32 thickness, bool closed) {
    if (!inFrame_ || vertices.size() < 2) return;

    for (size_t i = 0; i < vertices.size() - 1; ++i) {
        line(vertices[i], vertices[i + 1], color, thickness);
    }

    if (closed && vertices.size() > 2) {
        line(vertices.back(), vertices.front(), color, thickness);
    }
}

void ImmediateDraw::rect(const glm::vec2& position, const glm::vec2& size,
                         const glm::vec4& color, bool filled) {
    if (!inFrame_) return;

    if (filled) {
        impl_->batcher->drawQuad(position, size, color);
        primitiveCount_++;
    } else {
        rectOutline(position, size, color, 1.0f);
    }
}

void ImmediateDraw::rectOutline(const glm::vec2& position, const glm::vec2& size,
                                const glm::vec4& color, f32 thickness) {
    if (!inFrame_) return;

    f32 halfW = size.x * 0.5f;
    f32 halfH = size.y * 0.5f;

    glm::vec2 tl(position.x - halfW, position.y + halfH);
    glm::vec2 tr(position.x + halfW, position.y + halfH);
    glm::vec2 br(position.x + halfW, position.y - halfH);
    glm::vec2 bl(position.x - halfW, position.y - halfH);

    line(tl, tr, color, thickness);
    line(tr, br, color, thickness);
    line(br, bl, color, thickness);
    line(bl, tl, color, thickness);
}

void ImmediateDraw::circle(const glm::vec2& center, f32 radius,
                           const glm::vec4& color, bool filled, i32 segments) {
    if (!inFrame_ || segments < 3) return;

    if (filled) {
        for (i32 i = 0; i < segments; ++i) {
            f32 angle1 = static_cast<f32>(i) / static_cast<f32>(segments) * glm::two_pi<f32>();
            f32 angle2 = static_cast<f32>(i + 1) / static_cast<f32>(segments) * glm::two_pi<f32>();

            glm::vec2 p1 = center + glm::vec2(std::cos(angle1), std::sin(angle1)) * radius;
            glm::vec2 p2 = center + glm::vec2(std::cos(angle2), std::sin(angle2)) * radius;

            impl_->batcher->drawTriangle(center, p1, p2, color);
            primitiveCount_++;
        }
    } else {
        circleOutline(center, radius, color, 1.0f, segments);
    }
}

void ImmediateDraw::circleOutline(const glm::vec2& center, f32 radius,
                                  const glm::vec4& color, f32 thickness, i32 segments) {
    if (!inFrame_ || segments < 3) return;

    for (i32 i = 0; i < segments; ++i) {
        f32 angle1 = static_cast<f32>(i) / static_cast<f32>(segments) * glm::two_pi<f32>();
        f32 angle2 = static_cast<f32>(i + 1) / static_cast<f32>(segments) * glm::two_pi<f32>();

        glm::vec2 p1 = center + glm::vec2(std::cos(angle1), std::sin(angle1)) * radius;
        glm::vec2 p2 = center + glm::vec2(std::cos(angle2), std::sin(angle2)) * radius;

        line(p1, p2, color, thickness);
    }
}

void ImmediateDraw::polygon(std::span<const glm::vec2> vertices,
                            const glm::vec4& color) {
    if (!inFrame_ || vertices.size() < 3) return;

    for (size_t i = 1; i + 1 < vertices.size(); ++i) {
        impl_->batcher->drawTriangle(vertices[0], vertices[i], vertices[i + 1], color);
        primitiveCount_++;
    }
}

void ImmediateDraw::texture(const glm::vec2& position, const glm::vec2& size,
                            u32 textureId, const glm::vec4& tint) {
    if (!inFrame_) return;

    impl_->batcher->drawQuad(position, size, textureId, tint);
    primitiveCount_++;
}

void ImmediateDraw::textureRotated(const glm::vec2& position, const glm::vec2& size,
                                   f32 rotation, u32 textureId, const glm::vec4& tint) {
    if (!inFrame_) return;

    impl_->batcher->drawRotatedQuad(position, size, rotation, textureId, tint);
    primitiveCount_++;
}

u32 ImmediateDraw::getDrawCallCount() const {
    return impl_->batcher ? impl_->batcher->getDrawCallCount() : 0;
}

}  // namespace esengine
