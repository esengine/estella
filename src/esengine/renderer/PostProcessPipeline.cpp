// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PostProcessPipeline.cpp
 * @brief   Post-processing effects pipeline implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "PostProcessPipeline.hpp"
#include "RenderContext.hpp"
#include "GfxDevice.hpp"
#include "Shader.hpp"
#include "../resource/ResourceManager.hpp"
#include "../core/Log.hpp"
#include <algorithm>

#include "GfxEnums.hpp"

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

PostProcessPipeline::PostProcessPipeline(GfxDevice& device,
                                         RenderContext& context,
                                         resource::ResourceManager& resourceManager)
    : device_(device)
    , context_(context)
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

        fboOriginal_ = Framebuffer::create(device_, origSpec);
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

    fboA_ = Framebuffer::create(device_, spec);
    fboB_ = Framebuffer::create(device_, spec);

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

    auto* device = &device_;
    if (screen_quad_vbo_ != BufferHandle::Invalid && device) {
        device->deleteBuffer(screen_quad_vbo_);
        screen_quad_vbo_ = BufferHandle::Invalid;
    }
    if (screen_quad_layout_ != VertexLayoutHandle::Invalid && device) {
        device->deleteVertexLayout(screen_quad_layout_);
        screen_quad_layout_ = VertexLayoutHandle::Invalid;
    }

    fboA_.reset();
    fboB_.reset();
    fboOriginal_.reset();
    screenFBO_.reset();
    fbosCreated_ = false;
    fboOriginalCreated_ = false;
    screenCaptureActive_ = false;
    screenFBOCreated_ = false;
    sceneTexture_ = TextureHandle::Invalid;

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
    if (screen_quad_layout_ != VertexLayoutHandle::Invalid) return;

    // One fullscreen triangle (position + uv), drawn non-indexed.
    f32 vertices[] = {
        -1.0f, -1.0f,  0.0f, 0.0f,
         3.0f, -1.0f,  2.0f, 0.0f,
        -1.0f,  3.0f,  0.0f, 2.0f,
    };
    screen_quad_vbo_ = device_.createBuffer(
        {GfxBufferUsage::Vertex, static_cast<u32>(sizeof(vertices)), /*dynamic=*/false}, vertices);

    VertexLayoutDesc desc;
    desc.attributeCount = 2;
    desc.strides[0] = 4 * sizeof(f32);
    desc.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
    desc.attributes[1] = {1, 2, GfxDataType::Float, false, 2 * sizeof(f32), 0};
    screen_quad_layout_ = device_.createVertexLayout(desc);
}

void PostProcessPipeline::drawScreenQuad() {
    device_.setVertexBuffer(0, screen_quad_vbo_, 0);
    device_.setIndexBuffer(BufferHandle::Invalid);
    device_.drawArrays(0, 3);
}

void PostProcessPipeline::applyPassPipeline(const Shader& shader) {
    ensureScreenQuad();
    // Fullscreen passes overwrite every pixel: no blend, no depth, no stencil.
    PipelineDesc desc{};
    desc.program = shader.handle();
    desc.vertexLayout = screen_quad_layout_;
    desc.blendEnabled = false;
    desc.depthTest = false;
    desc.depthWrite = false;
    device_.setPipeline(device_.createPipeline(desc));
}

void PostProcessPipeline::begin() {
    if (!initialized_ || inFrame_ || bypass_) return;

    ensureFBOs();
    if (!fboOriginalCreated_) return;

    device_.beginRenderPass({fboOriginal_->handle(), /*clearColor=*/true, /*clearDepth=*/true});
    device_.setViewport(0, 0, width_, height_);

    inFrame_ = true;
    currentFBO_ = 0;
}

void PostProcessPipeline::end() {
    if (!initialized_ || !inFrame_ || bypass_) return;

    auto* device = &device_;

    u32 enabledCount = 0;
    for (const auto& pass : passes_) {
        if (pass.enabled) enabledCount++;
    }

    // Blend/depth/stencil/color-mask come from the fullscreen pass pipeline;
    // scissor is dynamic state and must be dropped explicitly.
    device->invalidatePipelineCache();
    device->setScissorTest(false);

    sceneTexture_ = fboOriginal_->getColorAttachment();
    fboOriginal_->unbind();

    if (enabledCount == 0) {
        blitToOutput(sceneTexture_);
    } else {
        TextureHandle inputTexture = sceneTexture_;
        currentFBO_ = 0;

        device->bindTexture(1, sceneTexture_);
        device->bindTexture(0, TextureHandle::Invalid);

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

    device->invalidatePipelineCache();
    inFrame_ = false;
    output_target_fbo_ = FramebufferHandle::Default;
}

void PostProcessPipeline::renderPass(const PostProcessPass& pass, TextureHandle inputTexture) {
    Shader* shader = resourceManager_.getShader(pass.shader);
    if (!shader) return;

    auto* device = &device_;
    device->bindTexture(0, inputTexture);

    applyPassPipeline(*shader);
    shader->setUniform("u_texture", 0);
    // u_sceneTexture and u_resolution are engine-provided builtins that only some
    // passes use (bloom's composite taps the untouched scene; kawase/pixelate/fxaa
    // need the resolution). Supply them only where declared so passes that omit
    // them don't log a spurious "uniform not found".
    if (shader->hasUniform("u_sceneTexture")) shader->setUniform("u_sceneTexture", 1);
    if (shader->hasUniform("u_resolution")) {
        shader->setUniform("u_resolution", glm::vec2(static_cast<f32>(width_), static_cast<f32>(height_)));
    }

    // A multi-pass effect (e.g. bloom) applies its full uniform set to every one
    // of its sub-pass shaders, each of which declares only a subset — upload each
    // uniform only to the passes that actually use it.
    for (const auto& [name, value] : pass.floatUniforms) {
        if (shader->hasUniform(name)) shader->setUniform(name, value);
    }

    for (const auto& [name, value] : pass.vec4Uniforms) {
        if (shader->hasUniform(name)) shader->setUniform(name, value);
    }

    // Effect parameters live in the shader's DrawParams block (lifted at
    // creation); flush + bind them for this draw.
    shader->commitParams();

    drawScreenQuad();
}

void PostProcessPipeline::clearPasses() {
    passes_.clear();
}

void PostProcessPipeline::setOutputTarget(FramebufferHandle target) {
    output_target_fbo_ = target;
}

void PostProcessPipeline::setOutputViewport(u32 x, u32 y, u32 w, u32 h) {
    output_vp_x_ = x;
    output_vp_y_ = y;
    output_vp_w_ = w;
    output_vp_h_ = h;
}

void PostProcessPipeline::blitToOutput(TextureHandle texture) {
    Shader* shader = resourceManager_.getShader(blitShader_);
    if (!shader) return;

    auto* device = &device_;
    device->beginRenderPass({output_target_fbo_});

    if (output_vp_w_ > 0 && output_vp_h_ > 0) {
        device->setViewport(output_vp_x_, output_vp_y_, output_vp_w_, output_vp_h_);
    }

    device->bindTexture(0, texture);

    applyPassPipeline(*shader);
    shader->setUniform("u_texture", 0);
    shader->commitParams();

    drawScreenQuad();
}

u32 PostProcessPipeline::getSourceTexture() const {
    return fboOriginal_ ? static_cast<u32>(fboOriginal_->getColorAttachment()) : 0;
}

u32 PostProcessPipeline::getOutputTexture() const {
    if (!fboA_ || !fboB_) return 0;
    return static_cast<u32>((currentFBO_ == 0) ? fboA_->getColorAttachment()
                                               : fboB_->getColorAttachment());
}

void PostProcessPipeline::ensureScreenFBO() {
    if (screenFBOCreated_) return;

    FramebufferSpec spec;
    spec.width = width_;
    spec.height = height_;
    spec.depthStencil = false;

    screenFBO_ = Framebuffer::create(device_, spec);
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

    device_.beginRenderPass({screenFBO_->handle(), /*clearColor=*/true, /*clearDepth=*/true});
    device_.setViewport(0, 0, width_, height_);

    screenCaptureActive_ = true;
}

void PostProcessPipeline::endScreenCapture() {
    if (!initialized_ || !screenCaptureActive_) return;

    screenFBO_->unbind();
    screenCaptureActive_ = false;
}

void PostProcessPipeline::executeScreenPasses() {
    if (!initialized_ || !screenFBOCreated_) return;

    auto* device = &device_;

    u32 enabledCount = 0;
    for (const auto& pass : screenPasses_) {
        if (pass.enabled) enabledCount++;
    }

    if (enabledCount == 0) {
        device->invalidatePipelineCache();
        blitToOutput(screenFBO_->getColorAttachment());
        return;
    }

    device->invalidatePipelineCache();
    device->setScissorTest(false);

    ensureFBOs();
    if (!fbosCreated_) return;

    sceneTexture_ = screenFBO_->getColorAttachment();
    screenFBO_->unbind();
    TextureHandle inputTexture = sceneTexture_;
    u32 pingPong = 0;

    device->bindTexture(1, sceneTexture_);
    device->bindTexture(0, TextureHandle::Invalid);

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

    device->endRenderPass();
    device->setViewport(0, 0, width_, height_);
    blitToOutput(inputTexture);

    device->invalidatePipelineCache();
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
