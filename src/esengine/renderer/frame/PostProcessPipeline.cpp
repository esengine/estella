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

#include "./PostProcessPipeline.hpp"
#include "./RenderContext.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../store/MaterialConstants.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../resource/ResourceManager.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"
#include <algorithm>
#include <cstring>

#include "../rhi/GfxEnums.hpp"

namespace esengine {

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

    // The pass-through copy, authored as blit.esshader (WGSL twin included).
    // No loose non-sampler uniforms, so the DrawParams rewrite has nothing to
    // lift; u_texture seeds via setUniform (GLSL-only, guarded there).
    const auto target = resourceManager_.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BLIT);
    blitShader_ = resourceManager_.createShader(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", {}, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", {}, target),
        /*rewriteLoose=*/false,
        resourceManager_.preferredShaderLanguage());
    if (!blitShader_.isValid()) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create blit shader");
        return;
    }

    initialized_ = true;
}

GfxPixelFormat PostProcessPipeline::interFormat() const {
    if (!linear_output_) return GfxPixelFormat::RGBA8;
    // Linear mode is HDR when float targets are renderable: half-float
    // intermediates let light accumulation exceed 1.0, so bloom's bright-pass
    // and tonemap see real over-range energy instead of values crushed at the
    // 8-bit store. Without the capability (WebGL2 sans EXT_color_buffer_float),
    // sRGB-encoded 8-bit keeps the linear pipeline correct at LDR precision.
    return device_.supportsFloatTargets() ? GfxPixelFormat::RGBA16F
                                          : GfxPixelFormat::SRGB8_ALPHA8;
}

void PostProcessPipeline::ensureFBOs() {
    const GfxPixelFormat interFmt = interFormat();
    if (!fboOriginalCreated_) {
        FramebufferSpec origSpec;
        origSpec.width = width_;
        origSpec.height = height_;
        origSpec.depthStencil = false;
        origSpec.colorFormat = interFmt;
        // Bilinear intermediates: fullscreen passes sample at texel centers
        // (where LINEAR == NEAREST), but Kawase blur deliberately samples at
        // half-texel offsets — with NEAREST those land ON texel boundaries,
        // whose rounding is backend-dependent (GL vs Dawn diverged visibly).
        // LINEAR makes the tap a well-defined 2x2 average — the actual Kawase
        // algorithm — identical on every backend.
        origSpec.linearFilter = true;

        fboOriginal_ = Framebuffer::create(device_, origSpec);
        if (!fboOriginal_) {
            ES_LOG_ERROR("PostProcessPipeline: Failed to create original FBO");
            return;
        }
        fboOriginalCreated_ = true;
        if (linear_output_) {
            ES_LOG_INFO("PostProcess intermediates: {}",
                        interFmt == GfxPixelFormat::RGBA16F ? "RGBA16F (HDR)"
                                                            : "SRGB8_ALPHA8 (LDR linear)");
        }
    }

    if (fbosCreated_) return;

    FramebufferSpec spec;
    spec.width = width_;
    spec.height = height_;
    spec.depthStencil = false;
    spec.colorFormat = interFmt;
    spec.linearFilter = true;  // see origSpec above — the blur chain needs bilinear taps

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

    for (auto& pass : passes_) releasePassResources(pass);
    for (auto& pass : screenPasses_) releasePassResources(pass);
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

void PostProcessPipeline::releasePassResources(PostProcessPass& pass) {
    if (pass.paramUbo != BufferHandle::Invalid) {
        device_.deleteBuffer(pass.paramUbo);
        pass.paramUbo = BufferHandle::Invalid;
    }
}

void PostProcessPipeline::removePass(const std::string& name) {
    auto it = std::find_if(passes_.begin(), passes_.end(),
        [&name](const PostProcessPass& p) { return p.name == name; });

    if (it != passes_.end()) {
        releasePassResources(*it);
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
        pass->paramDirty = true;
    }
}

void PostProcessPipeline::setPassTexture(const std::string& passName,
                                          const std::string& uniform, u32 glTextureId) {
    auto* pass = findPass(passName);
    if (!pass) return;
    for (auto& [name, id] : pass->textureUniforms) {
        if (name == uniform) { id = glTextureId; return; }
    }
    pass->textureUniforms.emplace_back(uniform, glTextureId);
}

void PostProcessPipeline::setPassUniformVec4(const std::string& passName,
                                              const std::string& uniform,
                                              const glm::vec4& value) {
    if (auto* pass = findPass(passName)) {
        pass->vec4Uniforms[uniform] = value;
        pass->paramDirty = true;
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

FramebufferHandle PostProcessPipeline::currentSceneFBO() const {
    if (screenCaptureActive_ && screenFBOCreated_) return screenFBO_->handle();
    if (inFrame_ && fboOriginalCreated_) return fboOriginal_->handle();
    return FramebufferHandle::Default;
}

void PostProcessPipeline::begin(const f32* clearColor) {
    if (!initialized_ || inFrame_ || (bypass_ && !linear_output_)) return;

    ensureFBOs();
    if (!fboOriginalCreated_) return;

    RenderPassDesc pass{fboOriginal_->handle(), /*clearColor=*/true, /*clearDepth=*/true};
    if (clearColor) {
        for (int i = 0; i < 4; ++i) pass.clearColorValue[i] = clearColor[i];
        if (linear_output_) {
            // Authored sRGB -> linear; the sRGB attachment re-encodes on store.
            for (int i = 0; i < 3; ++i) {
                const f32 v = pass.clearColorValue[i];
                pass.clearColorValue[i] =
                    v <= 0.04045f ? v / 12.92f : std::pow((v + 0.055f) / 1.055f, 2.4f);
            }
        }
    }
    device_.beginRenderPass(pass);
    device_.setViewport(0, 0, width_, height_);

    inFrame_ = true;
    currentFBO_ = 0;
}

void PostProcessPipeline::end() {
    if (!initialized_ || !inFrame_ || (bypass_ && !linear_output_)) return;

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

        for (auto& pass : passes_) {
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

void PostProcessPipeline::renderPass(PostProcessPass& pass, TextureHandle inputTexture) {
    Shader* shader = resourceManager_.getShader(pass.shader);
    if (!shader) return;

    auto* device = &device_;
    device->bindTexture(0, inputTexture);

    applyPassPipeline(*shader);
    const bool glsl = shader->language() == GfxShaderLanguage::GLSL_ES300;
    if (glsl) {
        // Engine sampler seeding is a GLSL concept; the WGSL twins read the
        // input/scene as the t0/s0 and t1/s1 bind-group pairs.
        shader->setUniform("u_texture", 0);
        if (shader->hasUniform("u_sceneTexture")) shader->setUniform("u_sceneTexture", 1);
    }

    // #pragma-param effects: params ride the reflected MaterialConstants block
    // (binding 1) exactly like a material's — compileEsshader registered the
    // layout when the effect compiled. Resolution-style inputs come from the
    // injected u_viewport, so nothing per-pass remains loose.
    const MaterialUniformLayout* layout = context_.materials().layoutFor(shader->getProgramId());
    if (layout) {
        if (layout->blockSize > 0) {
            if (pass.paramDirty || pass.paramBytes.size() < layout->blockSize) {
                // Defaults first, then the pass's set values by reflected offset.
                // A multi-pass effect (bloom) carries its full uniform set; each
                // sub-pass layout picks only the params it declares.
                pass.paramBytes.assign(layout->blockSize, 0);
                for (const auto& p : layout->params) {
                    std::memcpy(pass.paramBytes.data() + p.offset, p.defaults,
                                p.arity * sizeof(f32));
                    if (auto fit = pass.floatUniforms.find(p.name); fit != pass.floatUniforms.end()) {
                        std::memcpy(pass.paramBytes.data() + p.offset, &fit->second, sizeof(f32));
                    }
                    if (auto vit = pass.vec4Uniforms.find(p.name); vit != pass.vec4Uniforms.end()) {
                        std::memcpy(pass.paramBytes.data() + p.offset, &vit->second.x,
                                    std::min(p.arity, 4u) * sizeof(f32));
                    }
                }
                pass.paramDirty = false;
                if (pass.paramUbo == BufferHandle::Invalid) {
                    pass.paramUbo = device->createBuffer(
                        {GfxBufferUsage::Uniform, layout->blockSize, /*dynamic=*/true},
                        pass.paramBytes.data());
                } else {
                    device->updateBuffer(pass.paramUbo, 0, pass.paramBytes.data(),
                                         static_cast<u32>(pass.paramBytes.size()));
                }
            }
            if (pass.paramUbo != BufferHandle::Invalid) {
                device->setUniformBuffer(MATERIAL_CONSTANTS_BINDING, pass.paramUbo);
            }
        }
        // Texture params (LUTs, masks) bind at their reflected material units;
        // an unset param gets its declared default (white/black/flatnormal).
        for (const auto& slot : layout->textures) {
            u32 glTexture = slot.defaultGlTexture;
            for (const auto& [name, glId] : pass.textureUniforms) {
                if (name == slot.name && glId != 0) { glTexture = glId; break; }
            }
            if (glTexture != 0) device->bindTexture(slot.unit, TextureHandle{glTexture});
        }
    } else if (glsl) {
        // Legacy loose-uniform path for raw-GLSL passes (addPass with a
        // hand-created shader): resolution, in-order extra textures, and the
        // DrawParams block lifted at creation.
        if (shader->hasUniform("u_resolution")) {
            shader->setUniform("u_resolution", glm::vec2(static_cast<f32>(width_), static_cast<f32>(height_)));
        }
        u32 extraUnit = 2;
        for (const auto& [name, glId] : pass.textureUniforms) {
            if (glId != 0 && shader->hasUniform(name)) {
                device->bindTexture(extraUnit, TextureHandle{glId});
                shader->setUniform(name, static_cast<i32>(extraUnit));
            }
            ++extraUnit;
        }
        for (const auto& [name, value] : pass.floatUniforms) {
            if (shader->hasUniform(name)) shader->setUniform(name, value);
        }
        for (const auto& [name, value] : pass.vec4Uniforms) {
            if (shader->hasUniform(name)) shader->setUniform(name, value);
        }
        shader->commitParams();
    }

    drawScreenQuad();
}

void PostProcessPipeline::clearPasses() {
    for (auto& pass : passes_) releasePassResources(pass);
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
    // The multi-camera composition surface carries scene values too — same
    // format + filter story as the capture/ping-pong chain (HDR in
    // linear+float mode; bilinear for the blur taps).
    spec.colorFormat = interFormat();
    spec.width = width_;
    spec.height = height_;
    spec.depthStencil = false;
    spec.linearFilter = true;

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

    for (auto& pass : screenPasses_) {
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
    for (auto& pass : screenPasses_) releasePassResources(pass);
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
        pass->paramDirty = true;
    }
}

void PostProcessPipeline::setScreenPassUniformVec4(const std::string& passName,
                                                    const std::string& uniform,
                                                    const glm::vec4& value) {
    if (auto* pass = findScreenPass(passName)) {
        pass->vec4Uniforms[uniform] = value;
        pass->paramDirty = true;
    }
}

}  // namespace esengine
