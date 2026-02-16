/**
 * @file    PostProcessPipeline.cpp
 * @brief   Post-processing effects pipeline implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "PostProcessPipeline.hpp"
#include "RenderContext.hpp"
#include "RenderCommand.hpp"
#include "Shader.hpp"
#include "../resource/ResourceManager.hpp"
#include "../core/Log.hpp"
#include <algorithm>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

namespace esengine {

static const char* BLIT_VERTEX = R"(#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
)";

static const char* BLIT_FRAGMENT = R"(#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}
)";

PostProcessPipeline::PostProcessPipeline(RenderContext& context,
                                         resource::ResourceManager& resourceManager)
    : context_(context)
    , resourceManager_(resourceManager) {
}

PostProcessPipeline::~PostProcessPipeline() {
    if (initialized_) {
        shutdown();
    }
}

void PostProcessPipeline::init(u32 width, u32 height) {
    if (initialized_) return;

    width_ = width;
    height_ = height;

    f32 quadVertices[] = {
        // position     texCoord
        -1.0f, -1.0f,   0.0f, 0.0f,
         1.0f, -1.0f,   1.0f, 0.0f,
         1.0f,  1.0f,   1.0f, 1.0f,
        -1.0f,  1.0f,   0.0f, 1.0f,
    };

    u16 quadIndices[] = { 0, 1, 2, 2, 3, 0 };

    screenQuadVAO_ = VertexArray::create();

    auto vbo = makeShared<VertexBuffer>();
    *vbo = std::move(*VertexBuffer::createRaw(quadVertices, sizeof(quadVertices)));
    vbo->setLayout({
        { ShaderDataType::Float2, "a_position" },
        { ShaderDataType::Float2, "a_texCoord" },
    });
    screenQuadVAO_->addVertexBuffer(vbo);

    auto ibo = makeShared<IndexBuffer>();
    *ibo = std::move(*IndexBuffer::create(quadIndices, 6));
    screenQuadVAO_->setIndexBuffer(ibo);

    blitShader_ = resourceManager_.createShader(BLIT_VERTEX, BLIT_FRAGMENT);
    if (!blitShader_.isValid()) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create blit shader");
        return;
    }

    initialized_ = true;
}

void PostProcessPipeline::ensureFBOs() {
    if (fbosCreated_) return;

    FramebufferSpec spec;
    spec.width = width_;
    spec.height = height_;
    spec.depthStencil = false;

    fboA_ = Framebuffer::create(spec);
    fboB_ = Framebuffer::create(spec);

    if (!fboA_ || !fboB_) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create framebuffers");
        return;
    }

    fbosCreated_ = true;
}

void PostProcessPipeline::shutdown() {
    if (!initialized_) return;

    passes_.clear();
    screenQuadVAO_.reset();
    fboA_.reset();
    fboB_.reset();
    fbosCreated_ = false;

    if (blitShader_.isValid()) {
        resourceManager_.releaseShader(blitShader_);
    }

    initialized_ = false;
    ES_LOG_INFO("PostProcessPipeline shutdown");
}

void PostProcessPipeline::resize(u32 width, u32 height) {
    if (!initialized_) return;

    width_ = width;
    height_ = height;

    if (fbosCreated_) {
        fboA_.reset();
        fboB_.reset();
        fbosCreated_ = false;
        ensureFBOs();
    }
}

u32 PostProcessPipeline::addPass(const std::string& name, resource::ShaderHandle shader) {
    PostProcessPass pass;
    pass.name = name;
    pass.shader = shader;
    pass.enabled = true;

    passes_.push_back(pass);
    return static_cast<u32>(passes_.size() - 1);
}

void PostProcessPipeline::removePass(const std::string& name) {
    auto it = std::find_if(passes_.begin(), passes_.end(),
        [&name](const PostProcessPass& p) { return p.name == name; });

    if (it != passes_.end()) {
        passes_.erase(it);
    }
}

void PostProcessPipeline::setPassEnabled(const std::string& name, bool enabled) {
    if (auto* pass = findPass(name)) {
        pass->enabled = enabled;
    }
}

bool PostProcessPipeline::isPassEnabled(const std::string& name) const {
    for (const auto& pass : passes_) {
        if (pass.name == name) {
            return pass.enabled;
        }
    }
    return false;
}

void PostProcessPipeline::setPassUniformFloat(const std::string& passName,
                                               const std::string& uniform, f32 value) {
    if (auto* pass = findPass(passName)) {
        pass->floatUniforms[uniform] = value;
    }
}

void PostProcessPipeline::setPassUniformVec4(const std::string& passName,
                                              const std::string& uniform,
                                              const glm::vec4& value) {
    if (auto* pass = findPass(passName)) {
        pass->vec4Uniforms[uniform] = value;
    }
}

const PostProcessPass* PostProcessPipeline::getPass(u32 index) const {
    if (index >= passes_.size()) return nullptr;
    return &passes_[index];
}

const PostProcessPass* PostProcessPipeline::getPass(const std::string& name) const {
    for (const auto& pass : passes_) {
        if (pass.name == name) {
            return &pass;
        }
    }
    return nullptr;
}

PostProcessPass* PostProcessPipeline::findPass(const std::string& name) {
    for (auto& pass : passes_) {
        if (pass.name == name) {
            return &pass;
        }
    }
    return nullptr;
}

void PostProcessPipeline::begin() {
    if (!initialized_ || inFrame_ || bypass_) return;

    ensureFBOs();
    if (!fbosCreated_) return;

    fboA_->bind();
    RenderCommand::setViewport(0, 0, width_, height_);
    RenderCommand::clear();

    inFrame_ = true;
    currentFBO_ = 0;
}

void PostProcessPipeline::end() {
    if (!initialized_ || !inFrame_ || bypass_) return;

    u32 enabledCount = 0;
    for (const auto& pass : passes_) {
        if (pass.enabled) enabledCount++;
    }

    if (enabledCount == 0) {
        fboA_->unbind();
        blitToScreen(fboA_->getColorAttachment());
        inFrame_ = false;
        return;
    }

    u32 inputTexture = fboA_->getColorAttachment();
    currentFBO_ = 0;

    for (const auto& pass : passes_) {
        if (!pass.enabled) continue;

        Framebuffer* targetFBO = (currentFBO_ == 0) ? fboB_.get() : fboA_.get();
        targetFBO->bind();
        RenderCommand::setViewport(0, 0, width_, height_);

        renderPass(pass, inputTexture);

        inputTexture = targetFBO->getColorAttachment();
        currentFBO_ = 1 - currentFBO_;
    }

    Framebuffer* lastFBO = (currentFBO_ == 0) ? fboA_.get() : fboB_.get();
    lastFBO->unbind();

    blitToScreen(inputTexture);
    inFrame_ = false;
}

void PostProcessPipeline::renderPass(const PostProcessPass& pass, u32 inputTexture) {
    Shader* shader = resourceManager_.getShader(pass.shader);
    if (!shader) return;

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, inputTexture);

    shader->bind();
    shader->setUniform("u_texture", 0);
    shader->setUniform("u_resolution", glm::vec2(static_cast<f32>(width_), static_cast<f32>(height_)));

    for (const auto& [name, value] : pass.floatUniforms) {
        shader->setUniform(name, value);
    }

    for (const auto& [name, value] : pass.vec4Uniforms) {
        shader->setUniform(name, value);
    }

    RenderCommand::setDepthTest(false);
    RenderCommand::setBlending(false);

    RenderCommand::drawIndexed(*screenQuadVAO_, 6);

    RenderCommand::setBlending(true);
}

void PostProcessPipeline::blitToScreen(u32 texture) {
    Shader* shader = resourceManager_.getShader(blitShader_);
    if (!shader) return;

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, texture);

    shader->bind();
    shader->setUniform("u_texture", 0);

    RenderCommand::setDepthTest(false);
    RenderCommand::setBlending(false);

    RenderCommand::drawIndexed(*screenQuadVAO_, 6);

    RenderCommand::setBlending(true);
}

u32 PostProcessPipeline::getSourceTexture() const {
    return fboA_ ? fboA_->getColorAttachment() : 0;
}

u32 PostProcessPipeline::getOutputTexture() const {
    if (!fboA_ || !fboB_) return 0;
    return (currentFBO_ == 0) ? fboA_->getColorAttachment() : fboB_->getColorAttachment();
}

}  // namespace esengine
