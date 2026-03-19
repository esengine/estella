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
#include "RenderCommand.hpp"  // for RenderCommand::getDevice()
#include "Shader.hpp"
#include "../resource/ResourceManager.hpp"
#include "../core/Log.hpp"
#include <algorithm>

#include "OpenGLHeaders.hpp"

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

    blitShader_ = resourceManager_.createShader(BLIT_VERTEX, BLIT_FRAGMENT);
    if (!blitShader_.isValid()) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create blit shader");
        return;
    }

    initialized_ = true;
}

void PostProcessPipeline::ensureFBOs() {
    if (!fboOriginalCreated_) {
        FramebufferSpec origSpec;
        origSpec.width = width_;
        origSpec.height = height_;
        origSpec.depthStencil = false;

        fboOriginal_ = Framebuffer::create(origSpec);
        if (!fboOriginal_) {
            ES_LOG_ERROR("PostProcessPipeline: Failed to create original FBO");
            return;
        }
        fboOriginalCreated_ = true;
    }

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
    screenPasses_.clear();

    auto* device = RenderCommand::getDevice();
    if (screen_quad_vbo_ != 0 && device) {
        device->deleteBuffer(screen_quad_vbo_);
        screen_quad_vbo_ = 0;
    }
    if (screen_quad_vao_ != 0 && device) {
        device->deleteVertexArray(screen_quad_vao_);
        screen_quad_vao_ = 0;
    }

    fboA_.reset();
    fboB_.reset();
    fboOriginal_.reset();
    screenFBO_.reset();
    fbosCreated_ = false;
    fboOriginalCreated_ = false;
    screenCaptureActive_ = false;
    screenFBOCreated_ = false;
    sceneTexture_ = 0;

    if (blitShader_.isValid()) {
        resourceManager_.releaseShader(blitShader_);
    }

    initialized_ = false;
    ES_LOG_INFO("PostProcessPipeline shutdown");
}

void PostProcessPipeline::resize(u32 width, u32 height) {
    if (!initialized_) return;
    if (width == width_ && height == height_) return;

    width_ = width;
    height_ = height;

    if (fboOriginalCreated_) {
        fboOriginal_.reset();
        fboOriginalCreated_ = false;
    }

    if (fbosCreated_) {
        fboA_.reset();
        fboB_.reset();
        fbosCreated_ = false;
    }

    ensureFBOs();

    if (screenFBOCreated_) {
        screenFBO_.reset();
        screenFBOCreated_ = false;
        ensureScreenFBO();
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

void PostProcessPipeline::ensureScreenQuad() {
    if (screen_quad_vao_ != 0) return;

    auto* device = RenderCommand::getDevice();

    f32 vertices[] = {
        -1.0f, -1.0f,  0.0f, 0.0f,
         3.0f, -1.0f,  2.0f, 0.0f,
        -1.0f,  3.0f,  0.0f, 2.0f,
    };

    constexpr i32 STRIDE = 4 * static_cast<i32>(sizeof(f32));

    u32 vao = device->createVertexArray();
    device->bindVertexArray(vao);

    u32 vbo = device->createBuffer();
    device->bindVertexBuffer(vbo);
    device->bufferData(GL_ARRAY_BUFFER, vertices, static_cast<u32>(sizeof(vertices)), false);

    device->enableVertexAttrib(0);
    device->vertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE, 0);
    device->enableVertexAttrib(1);
    device->vertexAttribPointer(1, 2, GL_FLOAT, false, STRIDE, 2 * sizeof(f32));

    device->bindVertexArray(0);

    screen_quad_vao_ = vao;
    screen_quad_vbo_ = vbo;
}

void PostProcessPipeline::drawScreenQuad() {
    ensureScreenQuad();
    auto* device = RenderCommand::getDevice();
    device->bindVertexArray(screen_quad_vao_);
    device->drawArrays(0, 3);
}

void PostProcessPipeline::begin() {
    if (!initialized_ || inFrame_ || bypass_) return;

    ensureFBOs();
    if (!fboOriginalCreated_) return;

    auto* device = RenderCommand::getDevice();
    fboOriginal_->bind();
    device->setViewport(0, 0, width_, height_);
    device->clear(true, true, false);

    inFrame_ = true;
    currentFBO_ = 0;
}

void PostProcessPipeline::end() {
    if (!initialized_ || !inFrame_ || bypass_) return;

    auto* device = RenderCommand::getDevice();

    u32 enabledCount = 0;
    for (const auto& pass : passes_) {
        if (pass.enabled) enabledCount++;
    }

    device->setDepthTest(false);
    device->setBlendEnabled(false);
    device->setScissorTest(false);
    device->setStencilTest(false);
    device->setColorMask(true, true, true, true);

    sceneTexture_ = fboOriginal_->getColorAttachment();
    fboOriginal_->unbind();

    if (enabledCount == 0) {
        blitToOutput(sceneTexture_);
    } else {
        u32 inputTexture = sceneTexture_;
        currentFBO_ = 0;

        device->bindTexture(1, sceneTexture_);
        device->bindTexture(0, 0);

        for (const auto& pass : passes_) {
            if (!pass.enabled) continue;

            Framebuffer* targetFBO = (currentFBO_ == 0) ? fboA_.get() : fboB_.get();
            targetFBO->bind();
            device->setViewport(0, 0, width_, height_);

            renderPass(pass, inputTexture);

            inputTexture = targetFBO->getColorAttachment();
            currentFBO_ = 1 - currentFBO_;
        }

        Framebuffer* lastFBO = (currentFBO_ == 0) ? fboA_.get() : fboB_.get();
        lastFBO->unbind();

        blitToOutput(inputTexture);
    }

    device->setBlendEnabled(true);
    device->setDepthTest(true);
    inFrame_ = false;
    output_target_fbo_ = 0;
}

void PostProcessPipeline::renderPass(const PostProcessPass& pass, u32 inputTexture) {
    Shader* shader = resourceManager_.getShader(pass.shader);
    if (!shader) return;

    auto* device = RenderCommand::getDevice();
    device->bindTexture(0, inputTexture);

    shader->bind();
    shader->setUniform("u_texture", 0);
    shader->setUniform("u_sceneTexture", 1);
    shader->setUniform("u_resolution", glm::vec2(static_cast<f32>(width_), static_cast<f32>(height_)));

    for (const auto& [name, value] : pass.floatUniforms) {
        shader->setUniform(name, value);
    }

    for (const auto& [name, value] : pass.vec4Uniforms) {
        shader->setUniform(name, value);
    }

    drawScreenQuad();
}

void PostProcessPipeline::clearPasses() {
    passes_.clear();
}

void PostProcessPipeline::setOutputTarget(u32 fboId) {
    output_target_fbo_ = fboId;
}

void PostProcessPipeline::setOutputViewport(u32 x, u32 y, u32 w, u32 h) {
    output_vp_x_ = x;
    output_vp_y_ = y;
    output_vp_w_ = w;
    output_vp_h_ = h;
}

void PostProcessPipeline::blitToOutput(u32 texture) {
    Shader* shader = resourceManager_.getShader(blitShader_);
    if (!shader) return;

    auto* device = RenderCommand::getDevice();
    device->bindFramebuffer(output_target_fbo_);

    if (output_vp_w_ > 0 && output_vp_h_ > 0) {
        device->setViewport(output_vp_x_, output_vp_y_, output_vp_w_, output_vp_h_);
    }

    device->bindTexture(0, texture);

    shader->bind();
    shader->setUniform("u_texture", 0);

    drawScreenQuad();
}

u32 PostProcessPipeline::getSourceTexture() const {
    return fboOriginal_ ? fboOriginal_->getColorAttachment() : 0;
}

u32 PostProcessPipeline::getOutputTexture() const {
    if (!fboA_ || !fboB_) return 0;
    return (currentFBO_ == 0) ? fboA_->getColorAttachment() : fboB_->getColorAttachment();
}

void PostProcessPipeline::ensureScreenFBO() {
    if (screenFBOCreated_) return;

    FramebufferSpec spec;
    spec.width = width_;
    spec.height = height_;
    spec.depthStencil = false;

    screenFBO_ = Framebuffer::create(spec);
    if (!screenFBO_) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create screen FBO");
        return;
    }

    screenFBOCreated_ = true;
}

void PostProcessPipeline::beginScreenCapture() {
    if (!initialized_ || screenCaptureActive_) return;

    ensureScreenFBO();
    if (!screenFBOCreated_) return;

    auto* device = RenderCommand::getDevice();
    screenFBO_->bind();
    device->setViewport(0, 0, width_, height_);
    device->clear(true, true, false);

    screenCaptureActive_ = true;
}

void PostProcessPipeline::endScreenCapture() {
    if (!initialized_ || !screenCaptureActive_) return;

    screenFBO_->unbind();
    screenCaptureActive_ = false;
}

void PostProcessPipeline::executeScreenPasses() {
    if (!initialized_ || !screenFBOCreated_) return;

    auto* device = RenderCommand::getDevice();

    u32 enabledCount = 0;
    for (const auto& pass : screenPasses_) {
        if (pass.enabled) enabledCount++;
    }

    if (enabledCount == 0) {
        blitToOutput(screenFBO_->getColorAttachment());
        return;
    }

    device->setDepthTest(false);
    device->setBlendEnabled(false);
    device->setScissorTest(false);
    device->setStencilTest(false);
    device->setColorMask(true, true, true, true);

    ensureFBOs();
    if (!fbosCreated_) return;

    sceneTexture_ = screenFBO_->getColorAttachment();
    screenFBO_->unbind();
    u32 inputTexture = sceneTexture_;
    u32 pingPong = 0;

    device->bindTexture(1, sceneTexture_);
    device->bindTexture(0, 0);

    for (const auto& pass : screenPasses_) {
        if (!pass.enabled) continue;

        Framebuffer* targetFBO = (pingPong == 0) ? fboA_.get() : fboB_.get();
        targetFBO->bind();
        device->setViewport(0, 0, width_, height_);

        renderPass(pass, inputTexture);

        inputTexture = targetFBO->getColorAttachment();
        pingPong = 1 - pingPong;
    }

    Framebuffer* lastFBO = (pingPong == 0) ? fboA_.get() : fboB_.get();
    lastFBO->unbind();

    device->bindFramebuffer(0);
    device->setViewport(0, 0, width_, height_);
    blitToOutput(inputTexture);

    device->setBlendEnabled(true);
    device->setDepthTest(true);
}

u32 PostProcessPipeline::addScreenPass(const std::string& name, resource::ShaderHandle shader) {
    PostProcessPass pass;
    pass.name = name;
    pass.shader = shader;
    pass.enabled = true;

    screenPasses_.push_back(pass);
    return static_cast<u32>(screenPasses_.size() - 1);
}

void PostProcessPipeline::clearScreenPasses() {
    screenPasses_.clear();
}

PostProcessPass* PostProcessPipeline::findScreenPass(const std::string& name) {
    for (auto& pass : screenPasses_) {
        if (pass.name == name) {
            return &pass;
        }
    }
    return nullptr;
}

void PostProcessPipeline::setScreenPassUniformFloat(const std::string& passName,
                                                     const std::string& uniform, f32 value) {
    if (auto* pass = findScreenPass(passName)) {
        pass->floatUniforms[uniform] = value;
    }
}

void PostProcessPipeline::setScreenPassUniformVec4(const std::string& passName,
                                                    const std::string& uniform,
                                                    const glm::vec4& value) {
    if (auto* pass = findScreenPass(passName)) {
        pass->vec4Uniforms[uniform] = value;
    }
}

}  // namespace esengine
