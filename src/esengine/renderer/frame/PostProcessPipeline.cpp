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
#include "../RenderOrigin.hpp"
#include "./RenderContext.hpp"
#include "./VoxelGI.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../store/MaterialConstants.hpp"
#include "../store/MaterialStore.hpp"
#include "../store/LightConstants.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../resource/ResourceManager.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>

#include "../rhi/GfxEnums.hpp"

namespace esengine {

PostProcessPipeline::PostProcessPipeline(GfxDevice& device,
                                         RenderContext& context,
                                         resource::ResourceManager& resourceManager,
                                         rg::RenderGraph& graph)
    : device_(device)
    , context_(context)
    , resourceManager_(resourceManager)
    , graph_(&graph)
    , frameGraph_(&graph) {
}

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

    blitShader_ = compileBlit({});
    if (!blitShader_.isValid()) {
        ES_LOG_ERROR("PostProcessPipeline: Failed to create blit shader");
        return;
    }

    applySampleRequest();

    initialized_ = true;
}

/**
 * A variant of blit.esshader, which is the chain's last pass in every mode.
 *
 * No loose non-sampler uniforms, so the DrawParams rewrite has nothing to lift;
 * u_texture seeds via setUniform (GLSL-only, guarded there). ES_LINEAR is not
 * passed here — the parser adds it from the process-global colour space.
 */
resource::ShaderHandle PostProcessPipeline::compileBlit(const std::vector<std::string>& features) {
    const auto target = resourceManager_.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BLIT);
    const auto handle = resourceManager_.createShader(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target),
        /*rewriteLoose=*/false,
        resourceManager_.preferredShaderLanguage());
    // Its parameters are read as a material's are, off the reflected layout: the block and the texture slot every variant declares.
    if (handle.isValid()) {
        context_.materials().registerLayout(handle, MaterialStore::layoutOf(parsed));
        // The table's sampler is in the program only where the look is (the others do not read it, and the compiler drops it).
        if (Shader* compiled = resourceManager_.getShader(handle);
            compiled && compiled->language() == GfxShaderLanguage::GLSL_ES300 && compiled->hasUniform("u_displayLut")) {
            compiled->bind();
            for (const auto& p : parsed.properties) {
                if (p.fromParam && p.name == "u_displayLut" && p.textureUnit >= 0) compiled->setUniform(p.name, static_cast<i32>(p.textureUnit));
            }
            compiled->unbind();
        }
    }
    return handle;
}

void PostProcessPipeline::setViewExposure(f32 ev) {
    view_exposure_ = std::isfinite(ev) ? std::clamp(ev, -10.0f, 10.0f) : 0.0f;
    context_.setViewExposure(view_exposure_);
}

/**
 * The blit the current output transform needs. Compiled on first use rather
 * than at init: a project that never asks for a curve never pays for one.
 */
resource::ShaderHandle PostProcessPipeline::blitVariant(bool upscale, OutputTransform transform, bool lut) {
    const u32 key = (upscale ? 1u : 0u) | (static_cast<u32>(transform) << 1) | (lut ? 8u : 0u);
    if (key == 0) return blitShader_;
    if (const auto it = blitVariants_.find(key); it != blitVariants_.end()) return it->second;
    std::vector<std::string> features;
    if (upscale) features.push_back("ES_UPSCALE");
    if (transform == OutputTransform::Neutral) features.push_back("ES_TONEMAP_NEUTRAL");
    if (transform == OutputTransform::ACES) features.push_back("ES_TONEMAP");
    if (lut) features.push_back("ES_DISPLAY_LUT");
    const resource::ShaderHandle handle = compileBlit(features);
    if (!handle.isValid()) ES_LOG_ERROR("PostProcessPipeline: the last pass would not compile with upscale={} curve={} lut={}", upscale, static_cast<u32>(transform), lut);
    blitVariants_[key] = handle;
    return handle;
}

resource::ShaderHandle PostProcessPipeline::outputShader() {
    // What the last pass is asked for, and then, where a variant would not compile, less of it: the look first (it is the part a flat frame
    // can do without), then the resampling, then the curve. Never a black frame.
    const bool upscale = presentUpscales();
    const bool lut = displayLutActive();
    const struct { bool upscale; OutputTransform transform; bool lut; } wants[] = {
        {upscale, output_transform_, lut},
        {upscale, output_transform_, false},
        {false, output_transform_, false},
        {false, OutputTransform::None, false},
    };
    for (const auto& w : wants) {
        const resource::ShaderHandle handle = blitVariant(w.upscale, w.transform, w.lut);
        if (handle.isValid()) return handle;
    }
    return blitShader_;
}

/**
 * The format this frame committed to — read, never re-derived: begin() and
 * declareChain() both build targets, and a colour-space flip between them would
 * give one frame two formats.
 */
GfxPixelFormat PostProcessPipeline::interFormat() const {
    return frame_format_.effective;
}

/** Take the format decision for the frame about to be built. */
void PostProcessPipeline::commitFormat() {
    frame_format_ = decideHdrFormat(linear_output_, device_.supportsFloatTargets());
}

void PostProcessPipeline::ensureGraph() {
    if (graph_) return;
    // Only the frame-less fallback reaches here; with a frame, graph_ is the
    // frame's from construction and this is a no-op.
    ownedGraph_ = makeUnique<rg::RenderGraph>(device_);
    graph_ = ownedGraph_.get();
    commitFormat();
    if (linear_output_) {
        ES_LOG_INFO("PostProcess intermediates: {}",
                    interFormat() == GfxPixelFormat::RGBA16F ? "RGBA16F (HDR)"
                                                            : "SRGB8_ALPHA8 (LDR linear)");
    }
}

/**
 * The shape every target in a chain has, the one the scene lands in included.
 *
 * Bilinear throughout: Kawase blur samples at half-texel offsets, which under
 * NEAREST land ON texel boundaries whose rounding is backend-dependent (GL and
 * Dawn diverged visibly). LINEAR makes the tap the 2x2 average it means.
 */
rg::TargetDesc PostProcessPipeline::chainTarget(bool withDepth) const {
    rg::TargetDesc desc;
    desc.format = interFormat();
    desc.linearFilter = true;
    desc.depthStencil = withDepth;
    return desc;
}

/**
 * The last target in the chain, which only the blit samples. Bilinear everywhere
 * else for the reason above; here the present decides, because a whole-multiple
 * upscale wants an exact copy and interpolating it blurs a picture that needed
 * no resampling.
 */
rg::TargetDesc PostProcessPipeline::blitSourceTarget(bool withDepth) const {
    rg::TargetDesc desc = chainTarget(withDepth);
    if (presentIsWholeMultiple()) desc.linearFilter = false;
    return desc;
}

void PostProcessPipeline::shutdown() {
    if (!initialized_) return;

    for (auto& pass : passes_) releasePassResources(pass);
    for (auto& pass : screenPasses_) releasePassResources(pass);
    releasePassResources(sky_capture_.copy);
    sky_capture_.target.reset();
    sky_capture_.state = SkyCapture::State::Idle;
    for (auto& [source, program] : compute_cache_) device_.deleteCompute(program);
    compute_cache_.clear();
    voxel_gis_.clear();
    if (compute_view_ubo_ != BufferHandle::Invalid) {
        device_.deleteBuffer(compute_view_ubo_);
        compute_view_ubo_ = BufferHandle::Invalid;
    }
    passes_.clear();
    screenPasses_.clear();
    temporal_.clear();
    feedback_.clear();

    auto* device = &device_;
    if (screen_quad_vbo_ != BufferHandle::Invalid && device) {
        device->deleteBuffer(screen_quad_vbo_);
        screen_quad_vbo_ = BufferHandle::Invalid;
    }
    if (screen_quad_layout_ != VertexLayoutHandle::Invalid && device) {
        device->deleteVertexLayout(screen_quad_layout_);
        screen_quad_layout_ = VertexLayoutHandle::Invalid;
    }

    ownedGraph_.reset();
    // Back to the frame's, not to none: the frame outlives a shutdown and goes on running its graph,
    // so a pipeline restarted on a graph of its own declares passes nothing executes, and presents black.
    graph_ = frameGraph_;
    screenFBO_.reset();
    sceneResource_ = rg::kNoResource;
    screenCaptureActive_ = false;
    screenFBOCreated_ = false;
    sceneTexture_ = TextureHandle::Invalid;

    if (blitShader_.isValid()) {
        resourceManager_.releaseShader(blitShader_);
    }
    if (copyShader_.isValid()) {
        resourceManager_.releaseShader(copyShader_);
        copyShader_ = resource::ShaderHandle{};
    }
    if (exactCopyShader_.isValid()) {
        resourceManager_.releaseShader(exactCopyShader_);
        exactCopyShader_ = resource::ShaderHandle{};
    }
    if (copyDepthShader_.isValid()) {
        resourceManager_.releaseShader(copyDepthShader_);
        copyDepthShader_ = resource::ShaderHandle{};
    }
    for (auto& [key, shader] : blitVariants_) {
        if (shader.isValid()) resourceManager_.releaseShader(shader);
    }
    blitVariants_.clear();
    if (blitParamUbo_ != BufferHandle::Invalid) {
        device_.deleteBuffer(blitParamUbo_);
        blitParamUbo_ = BufferHandle::Invalid;
        blitParamAmount_ = -1.0f;
    }

    initialized_ = false;
    ES_LOG_INFO("PostProcessPipeline shutdown");
}

void PostProcessPipeline::resize(u32 width, u32 height) {
    if (!initialized_) return;
    if (width == width_ && height == height_) return;

    width_ = width;
    height_ = height;

    // The pool is keyed by shape, so targets at the old size would never be
    // handed out again — they would just sit there holding memory.
    if (graph_) graph_->releasePool();
    sceneResource_ = rg::kNoResource;
    // History at the old size names texels this picture no longer has.
    temporal_.clear();
    feedback_.clear();

    ensureGraph();

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

bool PostProcessPipeline::supportsCompute() const { return device_.supportsCompute(); }

bool PostProcessPipeline::runnable(const PostProcessPass& pass) const {
    if (!pass.nativeKind.empty()) return pass.enabled && device_.supportsCompute();
    return pass.enabled && (!pass.isCompute || (device_.supportsCompute() && pass.compute != ComputeHandle::Invalid));
}

u32 PostProcessPipeline::addNativePass(const std::string& name, const std::string& kind) {
    PostProcessPass pass;
    pass.name = name;
    pass.enabled = true;
    pass.nativeKind = kind;
    passes_.push_back(pass);
    return static_cast<u32>(passes_.size() - 1);
}

u32 PostProcessPipeline::addComputePass(const std::string& name, const std::string& wgsl,
                                         const std::vector<std::string>& params, u32 workgroupX, u32 workgroupY) {
    PostProcessPass pass;
    pass.name = name;
    pass.enabled = true;
    pass.isCompute = true;
    pass.computeParams = params;
    pass.workgroupX = std::max(workgroupX, 1u);
    pass.workgroupY = std::max(workgroupY, 1u);
    if (device_.supportsCompute()) {
        auto cached = compute_cache_.find(wgsl);
        if (cached == compute_cache_.end()) {
            std::string log;
            const ComputeHandle program = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, wgsl.c_str(), "main"}, &log);
            if (program == ComputeHandle::Invalid) {
                ES_LOG_ERROR("PostProcessPipeline: compute pass '{}' did not compile: {}", name, log);
            }
            // A program that failed is remembered as failed, or every camera of every frame would try it again.
            cached = compute_cache_.emplace(wgsl, program).first;
        }
        pass.compute = cached->second;
    }
    passes_.push_back(pass);
    return static_cast<u32>(passes_.size() - 1);
}

/**
 * The device answers what it CAN do; the project says what it SHOULD do. The
 * effective count is the second clamped by the first — a backend must never
 * pick the quality level, or every low-end target inherits whatever its driver
 * happens to allow.
 */
void PostProcessPipeline::applySampleRequest() {
    scene_samples_ = std::clamp(requested_samples_, 1u, device_.maxSamples());
    // A frame with no chain draws straight to the backbuffer, which on a surface
    // the host does not antialias needs the same answer — one setting, both paths.
    device_.setSurfaceSamples(scene_samples_);
}

void PostProcessPipeline::setRequestedSamples(u32 samples) {
    requested_samples_ = samples < 1u ? 1u : samples;
    if (initialized_) applySampleRequest();
}

void PostProcessPipeline::setPassScale(const std::string& passName, f32 scale) {
    if (auto* pass = findPass(passName)) {
        // A pass that draws at zero has no pixels and one that draws above the
        // chain size would resample upward for nothing: neither is a fraction.
        pass->scale = std::clamp(scale, 0.01f, 1.0f);
    }
}

void PostProcessPipeline::setPassContinuesEffect(const std::string& passName) {
    if (auto* pass = findPass(passName)) pass->continuesEffect = true;
}

bool PostProcessPipeline::passHasTexture(const PostProcessPass& pass, const char* name) {
    const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
    if (!layout) return false;
    for (const auto& slot : layout->textures) {
        if (slot.name == name) return true;
    }
    return false;
}

bool PostProcessPipeline::passUsesLights(const PostProcessPass& pass) {
    const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
    return layout && layout->usesLights;
}

bool PostProcessPipeline::passIsTemporal(const PostProcessPass& pass) {
    return passHasTexture(pass, "u_history");
}

u64 PostProcessPipeline::feedbackKey(const std::string& passName) const {
    return temporalKey_ * 1000003ull + std::hash<std::string>{}(passName);
}

bool PostProcessPipeline::passesWantGBuffer() {
    if (bypass_) return false;
    for (const auto& pass : passes_) {
        if (!pass.enabled) continue;
        // The voxel GI reads the surface's normal, whatever the effect's shader (it has none).
        if (!pass.nativeKind.empty()) {
            if (device_.supportsCompute()) return true;
            continue;
        }
        const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
        if (layout && layout->usesGBuffer) return true;
    }
    return false;
}

bool PostProcessPipeline::temporalActive() {
    if (!initialized_ || bypass_) return false;
    for (const auto& pass : passes_) {
        if (pass.enabled && passIsTemporal(pass)) return true;
    }
    return false;
}

bool PostProcessPipeline::cameraMotionWanted() {
    if (!initialized_ || bypass_) return false;
    for (const auto& pass : passes_) {
        if (!pass.enabled || !pass.nativeKind.empty() || passIsTemporal(pass)) continue;
        const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
        if (layout && layout->find("u_prevViewProjection0")) return true;
    }
    return false;
}

void PostProcessPipeline::trackView(const glm::mat4& viewProjection, u64 key) {
    TemporalState& state = temporal_[key];
    temporalKey_ = key;
    state.previous = state.frame > 0 ? viewProjectionFromOrigin(state.current, state.origin) : viewProjection;
    state.current = viewProjection;
    state.origin = renderOrigin();
    ++state.frame;
}

bool PostProcessPipeline::sceneCoverageWanted() {
    if (!initialized_ || bypass_) return false;
    for (const auto& pass : passes_) {
        if (!pass.enabled || !pass.nativeKind.empty()) continue;
        const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
        if (!layout || !layout->find("u_sceneCoverage")) continue;
        if (const auto it = pass.floatUniforms.find("u_panorama"); it != pass.floatUniforms.end() && it->second > 0.001f) continue;
        return true;
    }
    return false;
}

bool PostProcessPipeline::velocityWanted() {
    if (!initialized_ || bypass_ || !device_.supportsFloatTargets()) return false;
    for (const auto& pass : passes_) {
        if (pass.enabled && passHasTexture(pass, "u_velocity")) return true;
    }
    return false;
}

namespace {
/// Van der Corput in @p base: the low-discrepancy sequence a jitter walks the pixel with.
f32 halton(u32 index, u32 base) {
    f32 f = 1.0f, r = 0.0f;
    while (index > 0) {
        f /= static_cast<f32>(base);
        r += f * static_cast<f32>(index % base);
        index /= base;
    }
    return r;
}
/// Samples before the pattern repeats. Eight covers a pixel evenly enough that the
/// accumulated image is stable, and repeats fast enough to settle in a few frames.
constexpr u32 kJitterPhases = 8;
}  // namespace

glm::vec2 PostProcessPipeline::beginTemporalView(const glm::mat4& viewProjection, u64 key) {
    TemporalState& state = temporal_[key];
    temporalKey_ = key;
    if (state.frame > 0) state.previous = viewProjectionFromOrigin(state.current, state.origin);
    else state.previous = viewProjection;
    state.current = viewProjection;
    state.origin = renderOrigin();
    ++state.frame;
    // A chain that did not write last frame leaves history of a picture this one no
    // longer follows (a camera that was off, a frame the host skipped).
    if (state.writtenFrame + 1 != state.frame) state.valid = false;
    const u32 phase = (state.frame % kJitterPhases) + 1;
    const f32 jx = halton(phase, 2) - 0.5f;
    const f32 jy = halton(phase, 3) - 0.5f;
    const f32 w = static_cast<f32>(std::max(width_, 1u));
    const f32 h = static_cast<f32>(std::max(height_, 1u));
    return {jx * 2.0f / w, jy * 2.0f / h};
}

PostProcessPipeline::TemporalView PostProcessPipeline::peekTemporalView(const glm::mat4& viewProjection,
                                                                        u64 key) const {
    const auto it = temporal_.find(key);
    const u32 frame = it == temporal_.end() ? 0u : it->second.frame;
    TemporalView view;
    view.previous = frame > 0 ? viewProjectionFromOrigin(it->second.current, it->second.origin) : viewProjection;
    // The step beginTemporalView will take next: one frame on, the same phase of the same sequence.
    const u32 phase = ((frame + 1) % kJitterPhases) + 1;
    const f32 w = static_cast<f32>(std::max(width_, 1u));
    const f32 h = static_cast<f32>(std::max(height_, 1u));
    view.jitter = {(halton(phase, 2) - 0.5f) * 2.0f / w, (halton(phase, 3) - 0.5f) * 2.0f / h};
    if (frame > 0) {
        const u32 before = (frame % kJitterPhases) + 1;
        view.previousJitter = {(halton(before, 2) - 0.5f) * 2.0f / w, (halton(before, 3) - 0.5f) * 2.0f / h};
    }
    return view;
}

// The map is drawn for an effect that says how far it reaches (rain, snow): one that only reads it (reflections, keeping the
// ground under a roof dry) borrows it where it is drawn, and does not cost a second picture of the scene by being on alone.
bool PostProcessPipeline::passDrawsCover(const PostProcessPass& pass) {
    if (!passHasTexture(pass, "u_rainCover")) return false;
    const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
    return layout && layout->find("u_shelterRange");
}

bool PostProcessPipeline::coverWanted() {
    if (!initialized_ || bypass_) return false;
    for (const auto& pass : passes_) {
        if (pass.enabled && passDrawsCover(pass)) return true;
    }
    return false;
}

f32 PostProcessPipeline::coverRange() {
    for (const auto& pass : passes_) {
        if (!pass.enabled || !passDrawsCover(pass)) continue;
        if (auto it = pass.floatUniforms.find("u_shelterRange"); it != pass.floatUniforms.end()) {
            return std::max(it->second, 10.0f);
        }
    }
    return 3000.0f;
}

f32 PostProcessPipeline::coverBias() {
    for (const auto& pass : passes_) {
        if (!pass.enabled || !passDrawsCover(pass)) continue;
        if (auto it = pass.floatUniforms.find("u_shelterBias"); it != pass.floatUniforms.end()) return it->second;
        return 40.0f;
    }
    return 40.0f;
}

rg::ResourceId PostProcessPipeline::declareCover(u32 size) {
    cover_active_ = false;
    if (!graph_) return rg::kNoResource;
    if (!cover_fbo_ || cover_fbo_->getWidth() != size) {
        FramebufferSpec spec;
        spec.width = size;
        spec.height = size;
        spec.colorFormat = GfxPixelFormat::RGBA8;
        spec.depthStencil = true;
        spec.linearFilter = false;
        cover_fbo_ = Framebuffer::create(device_, spec);
        if (!cover_fbo_) {
            ES_LOG_ERROR("PostProcessPipeline: Failed to create the rain cover target");
            return rg::kNoResource;
        }
    }
    cover_resource_ = graph_->importTarget(cover_fbo_->handle(), size, size, /*output=*/false,
                                           cover_fbo_->getColorAttachment());
    cover_active_ = true;
    return cover_resource_;
}

rg::ResourceId PostProcessPipeline::declareVelocity() {
    velocity_active_ = false;
    if (!graph_ || !device_.supportsFloatTargets()) return rg::kNoResource;
    const u32 w = std::max(width_, 1u);
    const u32 h = std::max(height_, 1u);
    if (!velocity_fbo_ || velocity_fbo_->getWidth() != w || velocity_fbo_->getHeight() != h) {
        FramebufferSpec spec;
        spec.width = w;
        spec.height = h;
        spec.colorFormat = GfxPixelFormat::RGBA32F;
        spec.depthStencil = true;
        spec.linearFilter = false;
        velocity_fbo_ = Framebuffer::create(device_, spec);
        if (!velocity_fbo_) {
            ES_LOG_ERROR("PostProcessPipeline: Failed to create the motion target");
            return rg::kNoResource;
        }
    }
    velocity_resource_ = graph_->importTarget(velocity_fbo_->handle(), w, h, /*output=*/false,
                                              velocity_fbo_->getColorAttachment());
    velocity_active_ = true;
    return velocity_resource_;
}

bool PostProcessPipeline::passIsHighPrecision(const PostProcessPass& pass) {
    const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
    return layout && layout->highPrecision && device_.supportsFloatTargets();
}

PostProcessPipeline::TemporalState* PostProcessPipeline::prepareHistory(TemporalState& state,
                                                                         u32 w, u32 h,
                                                                         GfxPixelFormat format) {
    w = std::max(w, 1u);
    h = std::max(h, 1u);
    if (state.history[0] && state.width == w && state.height == h
        && state.format == format) {
        return &state;
    }
    for (auto& fbo : state.history) {
        FramebufferSpec spec;
        spec.colorFormat = format;
        spec.width = w;
        spec.height = h;
        spec.depthStencil = false;
        // The reprojected read lands between texels, so it wants the filter.
        spec.linearFilter = true;
        fbo = Framebuffer::create(device_, spec);
        if (!fbo) {
            ES_LOG_ERROR("PostProcessPipeline: Failed to create a temporal history target");
            state.history[0].reset();
            state.history[1].reset();
            return nullptr;
        }
    }
    state.width = w;
    state.height = h;
    state.format = format;
    state.valid = false;
    return &state;
}

void PostProcessPipeline::requestSkyCapture(const std::string& passName, u32 width, u32 height) {
    sky_capture_.pass = passName;
    sky_capture_.width = std::clamp(width, 4u, 512u);
    sky_capture_.height = std::clamp(height, 2u, 256u);
    sky_capture_.state = SkyCapture::State::Requested;
    sky_capture_.readback = ReadbackHandle::Invalid;
}

i32 PostProcessPipeline::pollSkyCapture() {
    SkyCapture& c = sky_capture_;
    switch (c.state) {
        case SkyCapture::State::Idle: return 2;
        case SkyCapture::State::Requested: return 0;
        case SkyCapture::State::Drawn:
            c.readback = c.target ? device_.requestReadback(c.target->handle(), c.width, c.height) : ReadbackHandle::Invalid;
            if (c.readback == ReadbackHandle::Invalid) { c.state = SkyCapture::State::Idle; return 2; }
            c.state = SkyCapture::State::Reading;
            [[fallthrough]];
        case SkyCapture::State::Reading: {
            const GfxReadbackStatus status = device_.pollReadback(c.readback);
            if (status == GfxReadbackStatus::Pending) return 0;
            c.state = SkyCapture::State::Idle;
            if (status != GfxReadbackStatus::Ready) return 2;
            c.pixels.resize(static_cast<usize>(c.width) * c.height * 4);
            return device_.takeReadback(c.readback, c.pixels.data(), c.pixels.size()) ? 1 : 2;
        }
    }
    return 2;
}

void PostProcessPipeline::declareSkyCapture(const PostProcessPass& pass, rg::ResourceId input, rg::ResourceId effectInput) {
    SkyCapture& c = sky_capture_;
    if (!c.target || c.target->getSpecification().width != c.width || c.target->getSpecification().height != c.height) {
        FramebufferSpec spec;
        spec.colorFormat = GfxPixelFormat::RGBA8;
        spec.width = c.width;
        spec.height = c.height;
        spec.depthStencil = false;
        spec.linearFilter = true;
        c.target = Framebuffer::create(device_, spec);
        if (!c.target) {
            ES_LOG_ERROR("PostProcessPipeline: could not make the sky capture target");
            c.state = SkyCapture::State::Idle;
            return;
        }
    }
    // The pass's shader and settings, its own parameter buffer kept.
    const BufferHandle ubo = c.copy.paramUbo;
    c.copy = pass;
    c.copy.paramUbo = ubo;
    c.copy.name = pass.name + "_skyCapture";
    c.copy.temporal = false;
    c.copy.feedback = false;
    c.copy.earlierInputs.clear();
    c.copy.floatUniforms["u_skyCapture"] = 1.0f;
    c.copy.paramDirty = true;

    rg::PassDesc node;
    node.name = c.copy.name;
    node.reads = {input, effectInput};
    node.keep = true;
    node.write = graph_->importTarget(c.target->handle(), c.width, c.height, /*output=*/false, c.target->getColorAttachment());
    node.execute = [this](const rg::PassContext& ctx) {
        renderPass(sky_capture_.copy, ctx);
        sky_capture_.state = SkyCapture::State::Drawn;
    };
    graph_->addPass(std::move(node));
}

void PostProcessPipeline::releasePassResources(PostProcessPass& pass) {
    if (pass.paramUbo != BufferHandle::Invalid) {
        device_.deleteBuffer(pass.paramUbo);
        pass.paramUbo = BufferHandle::Invalid;
    }
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
        {GfxBufferUsage::Vertex, static_cast<u32>(sizeof(vertices)), /*dynamic=*/false},
        GfxContent::retained(), vertices);

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

void PostProcessPipeline::applyPassPipeline(const Shader& shader, bool over) {
    ensureScreenQuad();
    // Fullscreen passes overwrite every pixel: no blend, no depth, no stencil. The one exception is the present of a
    // camera that keeps the colour under it, which lays its picture over by coverage. The capture was cleared to
    // transparent, so its colour is already weighted by its alpha (a resolve averages both): premultiplied.
    PipelineDesc desc{};
    desc.program = shader.handle();
    desc.vertexLayout = screen_quad_layout_;
    desc.blendEnabled = over;
    if (over) desc.blend = BlendMode::PremultipliedAlpha;
    desc.depthTest = false;
    desc.depthWrite = false;
    device_.setPipeline(device_.createPipeline(desc));
}

FramebufferHandle PostProcessPipeline::currentSceneFBO() const {
    if (screenCaptureActive_ && screenFBOCreated_) return screenFBO_->handle();
    if (inFrame_ && graph_) return graph_->framebufferOf(sceneResource_);
    return FramebufferHandle::Default;
}

void PostProcessPipeline::begin(const f32* clearColor) {
    if (!isEngaged() || inFrame_) return;

    ensureGraph();
    if (!graph_) return;

    // The frame's format is taken HERE, before its first resource exists, and
    // every target built between here and end() reads it. A policy flip lands on
    // the next frame rather than halfway through this one.
    commitFormat();

    // The graph opens HERE and not at end(), because the scene target is its
    // first resource and the scene is drawn before any pass can be declared.
    graph_->begin(width_, height_);
    // With no pass to run, the blit samples the scene target itself, so the
    // present's filter is the one that applies to it.
    const bool sceneIsBlitSource = bypass_ || passes_.empty();
    rg::TargetDesc sceneDesc =
        sceneIsBlitSource ? blitSourceTarget(scene_needs_depth_) : chainTarget(scene_needs_depth_);
    // The only target geometry is rasterised into, so the only one with edges.
    // Every other target in the chain is a fullscreen pass and stays at one
    // sample. Gate: check-postfx-aa.
    sceneDesc.samples = scene_samples_;
    // The surface record needs the scene's depth to test against and to be read beside, so a frame
    // with no depth has no use for one.
    scene_gbuffer_ = scene_needs_depth_ && passesWantGBuffer();
    sceneDesc.gbuffer = scene_gbuffer_;
    sceneResource_ = graph_->createExternalTarget(sceneDesc);
    if (sceneResource_ == rg::kNoResource) {
        ES_LOG_ERROR("PostProcessPipeline: no scene target this frame");
        return;
    }

    RenderPassDesc pass{graph_->framebufferOf(sceneResource_),
                        /*clearColor=*/true, /*clearDepth=*/true};
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
}

void PostProcessPipeline::declareChain() {
    // Gated on inFrame_ alone, not on isEngaged(): whatever begin() opened has
    // to be resolved even if the answer changed underneath in between.
    if (!initialized_ || !inFrame_) return;

    // Read while the resource still holds its target — the graph hands it back
    // at the last pass that reads it.
    sceneTexture_ = graph_->textureOf(sceneResource_);
    // What Framebuffer::unbind did for the FBO this replaced: a WebGPU pass
    // encoder has to be closed before the graph opens the first one of its own.
    device_.endRenderPass();

    runChain(passes_, sceneResource_);
}

void PostProcessPipeline::chainDone() {
    velocity_active_ = false;
    cover_active_ = false;
    if (!initialized_ || !inFrame_) return;
    device_.invalidatePipelineCache();
    inFrame_ = false;
    output_target_fbo_ = FramebufferHandle::Default;
    present_over_ = false;
    // Per-frame, like the target above: a camera that asked for a present must not
    // leave the next one engaged for a frame it never asked about.
    present_required_ = false;
}

void PostProcessPipeline::renderPass(PostProcessPass& pass, const rg::PassContext& ctx) {
    Shader* shader = resourceManager_.getShader(pass.shader);
    if (!shader) return;

    auto* device = &device_;
    applyPassPipeline(*shader);
    const bool glsl = shader->language() == GfxShaderLanguage::GLSL_ES300;
    if (glsl) {
        // Engine sampler seeding is a GLSL concept; the WGSL twins read the
        // input/scene as the t0/s0 and t1/s1 bind-group pairs.
        // An effect that makes its picture rather than reading one (the sky) has no input to seat.
        if (shader->hasUniform("u_texture")) shader->setUniform("u_texture", 0);
        if (shader->hasUniform("u_sceneTexture")) shader->setUniform("u_sceneTexture", 1);
        if (shader->hasUniform("u_sceneDepth")) {
            shader->setUniform("u_sceneDepth", static_cast<i32>(kSceneDepthUnit));
        }
        if (shader->hasUniform("u_gbuffer")) {
            shader->setUniform("u_gbuffer", static_cast<i32>(kGBufferUnit));
        }
        if (shader->hasUniform("u_shadowMap")) {
            shader->setUniform("u_shadowMap", static_cast<i32>(SHADOW_MAP_TEXTURE_UNIT));
        }
    }

    // #pragma-param effects: params ride the reflected MaterialConstants block
    // (binding 1) exactly like a material's — compileEsshader registered the
    // layout when the effect compiled. Resolution-style inputs come from the
    // injected u_viewport, so nothing per-pass remains loose.
    const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader);
    TemporalState* temporal = nullptr;
    if (pass.temporal) {
        if (auto it = temporal_.find(temporalKey_); it != temporal_.end()) temporal = &it->second;
    } else if (pass.feedback) {
        if (auto it = feedback_.find(pass.historyKey); it != feedback_.end()) temporal = &it->second;
    }
    // An effect that reflects the environment declares its parameters, and takes them from the
    // light block the scene was drawn with: how the atlas is laid out, how bright it is, how far the sky has turned.
    // An effect that asks what stands over a place is handed the matrix the answer was drawn through, and whether there is one.
    if (layout && layout->find("u_coverMatrix0")) {
        for (int c = 0; c < 4; ++c) {
            pass.vec4Uniforms["u_coverMatrix" + std::to_string(c)] = glm::vec4(cover_matrix_[c]);
        }
        pass.floatUniforms["u_coverActive"] = cover_active_ ? 1.0f : 0.0f;
        // The reach the map was drawn with and the bias it is read with, for a pass that reads it without stating either (reflections
        // read the rain's): both are the drawing effect's, in its world's units.
        if (layout->find("u_coverRange")) pass.floatUniforms["u_coverRange"] = coverRange();
        if (layout->find("u_coverBias")) pass.floatUniforms["u_coverBias"] = coverBias();
        pass.paramDirty = true;
    }
    if (layout && layout->usesLights) {
        // The block the scene was lit with, bound again: the passes between have no claim on its slot, but a
        // chain is not the place to find out. And the atlas on the unit the Lit shaders read it from.
        context_.lights().uploadAndBind();
        if (shadow_texture_ != 0) device->bindTexture(SHADOW_MAP_TEXTURE_UNIT, TextureHandle{shadow_texture_});
    }
    if (layout && layout->find("u_envParams")) {
        const LightConstants& lights = context_.lights().data();
        pass.vec4Uniforms["u_envParams"] = lights.envParams;
        pass.vec4Uniforms["u_envTint"] = lights.envTint;
        pass.vec4Uniforms["u_reflParams"] = lights.reflParams;
        pass.paramDirty = true;
    }
    if (temporal && pass.temporal) {
        // The previous picture's camera, as columns: a world point times it is where
        // that point was one frame ago. Re-sent each frame because it is each frame's.
        for (int c = 0; c < 4; ++c) {
            pass.vec4Uniforms["u_prevViewProjection" + std::to_string(c)] =
                glm::vec4(temporal->previous[c]);
        }
        pass.floatUniforms["u_historyValid"] = temporal->valid ? 1.0f : 0.0f;
        pass.paramDirty = true;
    } else if (temporal) {
        pass.floatUniforms["u_historyValid"] = temporal->valid ? 1.0f : 0.0f;
        pass.paramDirty = true;
    }
    // An effect that wants only where the camera WAS (motion blur): no history, so no `temporal` above, but the
    // same matrix. Nothing to send before the view has been followed once.
    if (!pass.temporal && layout && layout->find("u_prevViewProjection0")) {
        if (auto it = temporal_.find(temporalKey_); it != temporal_.end()) {
            for (int c = 0; c < 4; ++c) {
                pass.vec4Uniforms["u_prevViewProjection" + std::to_string(c)] = glm::vec4(it->second.previous[c]);
            }
            pass.paramDirty = true;
        }
    }
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
                        GfxContent::retained(), pass.paramBytes.data());
                } else {
                    device->updateBuffer(pass.paramUbo, 0, pass.paramBytes.data(),
                                         static_cast<u32>(pass.paramBytes.size()));
                }
            }
            if (pass.paramUbo != BufferHandle::Invalid) {
                device->setUniformBuffer(MATERIAL_CONSTANTS_BINDING, pass.paramUbo);
            }
        }
        // Scene depth, bound whether or not this pass reads it: the WGSL twin
    // declares the unit either way. runChain keeps the scene alive through
    // every pass for it.

    // A target with no depth binds nothing, and an effect over a scene that
    // wrote none then finds no edge — the right answer for a flat one.
    device->bindTexture(kSceneDepthUnit, graph_ ? graph_->depthTextureOf(sceneResource_)
                                                : TextureHandle::Invalid);
    // And the surface record, on the unit below it, on the same terms: nothing where the frame drew none.
    device->bindTexture(kGBufferUnit, graph_ && scene_gbuffer_ ? graph_->gbufferTextureOf(sceneResource_)
                                                               : TextureHandle::Invalid);

    // Texture params (LUTs, masks) bind at their reflected material units;
        // an unset param gets its declared default (white/black/flatnormal).
        for (const auto& slot : layout->textures) {
            TextureHandle gpu = context_.materials().builtinDefault(slot.defaultTexture);
            if (temporal && (slot.name == "u_history" || slot.name == "u_feedback")
                && temporal->history[temporal->readIndex]) {
                gpu = temporal->history[temporal->readIndex]->getColorAttachment();
            }
            if (slot.name == "u_environment" && environment_texture_ != 0) {
                gpu = TextureHandle{environment_texture_};
            }
            if (slot.name == "u_velocity" && velocity_active_ && velocity_fbo_) {
                gpu = velocity_fbo_->getColorAttachment();
            }
            // The scene's albedo, beside its surface record: what bounce light an effect adds is coloured by.
            if (slot.name == "u_sceneAlbedo" && graph_ && scene_gbuffer_) {
                const TextureHandle albedo = graph_->albedoTextureOf(sceneResource_);
                if (albedo != TextureHandle::Invalid) gpu = albedo;
            }
            if (slot.name == "u_rainCover" && cover_active_ && cover_fbo_) {
                gpu = cover_fbo_->getColorAttachment();
            }
            for (const auto& [name, glId] : pass.textureUniforms) {
                if (name == slot.name && glId != 0) { gpu = TextureHandle{glId}; break; }
            }
            for (const auto& [name, id] : pass.earlierInputs) {
                if (name != slot.name || !graph_) continue;
                const TextureHandle earlier = graph_->textureOf(id);
                if (earlier != TextureHandle::Invalid) gpu = earlier;
                break;
            }
            if (gpu != TextureHandle::Invalid) device->bindTexture(slot.unit, gpu);
        }
    } else if (glsl) {
        // Legacy loose-uniform path for raw-GLSL passes (addPass with a
        // hand-created shader): resolution, in-order extra textures, and the
        // DrawParams block lifted at creation.
        // The pass's own size, not the screen's: a chain link that runs at a
        // fraction of the reference size must sample by ITS texel grid.
        if (shader->hasUniform("u_resolution")) {
            shader->setUniform("u_resolution", glm::vec2(static_cast<f32>(ctx.width), static_cast<f32>(ctx.height)));
        }
        u32 extraUnit = 2;
        for (const auto& [name, glId] : pass.textureUniforms) {
            // Stops below the scene-depth unit rather than walking into it: a
            // sixth loose texture would otherwise take the binding depth is on.
            if (extraUnit >= kGBufferUnit) break;
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

void PostProcessPipeline::computePass(PostProcessPass& pass, const rg::PassContext& ctx) {
    if (pass.compute == ComputeHandle::Invalid || ctx.output == TextureHandle::Invalid) return;
    const TextureHandle input = ctx.input(0);
    if (input == TextureHandle::Invalid) return;

    // The params block: the pass's floats in the order the effect declared them, at least one vec4 (a uniform
    // binding is never smaller than that).
    const usize floats = std::max<usize>(4, (pass.computeParams.size() + 3) / 4 * 4);
    std::vector<f32> values(floats, 0.0f);
    for (usize i = 0; i < pass.computeParams.size(); ++i) {
        if (auto it = pass.floatUniforms.find(pass.computeParams[i]); it != pass.floatUniforms.end()) values[i] = it->second;
    }
    const u32 paramBytes = static_cast<u32>(values.size() * sizeof(f32));
    if (pass.paramUbo == BufferHandle::Invalid) {
        pass.paramUbo = device_.createBuffer({GfxBufferUsage::Uniform, paramBytes, /*dynamic=*/true},
                                             GfxContent::retained(), values.data());
    } else {
        device_.updateBuffer(pass.paramUbo, 0, values.data(), paramBytes);
    }

    const f32 w = static_cast<f32>(std::max(ctx.width, 1u));
    const f32 h = static_cast<f32>(std::max(ctx.height, 1u));
    const f32 view[4] = {w, h, 1.0f / w, 1.0f / h};
    if (compute_view_ubo_ == BufferHandle::Invalid) {
        compute_view_ubo_ = device_.createBuffer({GfxBufferUsage::Uniform, sizeof(view), /*dynamic=*/true},
                                                 GfxContent::retained(), view);
    } else {
        device_.updateBuffer(compute_view_ubo_, 0, view, sizeof(view));
    }

    // The scene's depth where the frame wrote one; the device stands a blank in where it did not.
    const TextureHandle depth = (graph_ && sceneResource_ != rg::kNoResource) ? graph_->depthTextureOf(sceneResource_)
                                                                              : TextureHandle::Invalid;
    const GfxComputeBinding bindings[6] = {
        GfxComputeBinding::sampled(0, input),
        GfxComputeBinding::storageTexture(1, ctx.output),
        GfxComputeBinding::uniform(2, pass.paramUbo),
        GfxComputeBinding::uniform(3, compute_view_ubo_),
        GfxComputeBinding::depth(4, depth),
        GfxComputeBinding::sampler(5, TextureFilter::Linear),
    };
    const u32 groupsX = (ctx.width + pass.workgroupX - 1) / pass.workgroupX;
    const u32 groupsY = (ctx.height + pass.workgroupY - 1) / pass.workgroupY;
    device_.dispatchCompute(pass.compute, bindings, 6, groupsX, groupsY, 1);
}

void PostProcessPipeline::clearPasses() {
    for (auto& pass : passes_) releasePassResources(pass);
    passes_.clear();
    // The display look is the chain's, like its passes: the next camera says its own.
    display_lut_texture_ = 0;
    display_lut_amount_ = 0.0f;
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

void PostProcessPipeline::grabScene(bool marked) {
    resource::ShaderHandle& handle = marked ? copyShader_ : exactCopyShader_;
    if (!handle.isValid()) {
        handle = compileBlit({marked ? "ES_COPY" : "ES_COPY_EXACT"});
        if (!handle.isValid()) {
            ES_LOG_ERROR("PostProcessPipeline: no copy shader; a refractive surface sees nothing behind it");
            return;
        }
    }
    Shader* shader = resourceManager_.getShader(handle);
    if (!shader) return;
    applyPassPipeline(*shader);
    if (shader->hasUniform("u_texture")) shader->setUniform("u_texture", 0);
    shader->commitParams();
    bindBlitInputs(handle);
    drawScreenQuad();
}

bool PostProcessPipeline::canGrabDepth() {
    return device_.supportsFloatTargets();
}

void PostProcessPipeline::grabDepth() {
    if (!copyDepthShader_.isValid()) {
        copyDepthShader_ = compileBlit({"ES_COPY_DEPTH"});
        if (!copyDepthShader_.isValid()) {
            ES_LOG_ERROR("PostProcessPipeline: no depth copy shader; water sees no depth behind it");
            return;
        }
    }
    Shader* shader = resourceManager_.getShader(copyDepthShader_);
    if (!shader) return;
    applyPassPipeline(*shader);
    if (shader->hasUniform("u_texture")) shader->setUniform("u_texture", 0);
    if (shader->hasUniform("u_sceneDepth")) shader->setUniform("u_sceneDepth", static_cast<i32>(kSceneDepthUnit));
    shader->commitParams();
    device_.bindTexture(kSceneDepthUnit, graph_ ? graph_->depthTextureOf(sceneResource_) : TextureHandle::Invalid);
    bindBlitInputs(copyDepthShader_);
    drawScreenQuad();
}

void PostProcessPipeline::blitPass() {
    const resource::ShaderHandle outputHandle = outputShader();
    Shader* shader = resourceManager_.getShader(outputHandle);
    if (!shader) return;

    // The output rect is the one thing a pass does not get from its target: the
    // graph sized the viewport to the whole target, and a camera writing into a
    // shared surface owns only part of it.
    if (output_vp_w_ > 0 && output_vp_h_ > 0) {
        device_.setViewport(output_vp_x_, output_vp_y_, output_vp_w_, output_vp_h_);
    }

    applyPassPipeline(*shader, present_over_);
    if (shader->hasUniform("u_texture")) shader->setUniform("u_texture", 0);
    shader->commitParams();
    bindBlitInputs(outputHandle);

    drawScreenQuad();
}

void PostProcessPipeline::bindBlitInputs(const resource::ShaderHandle& handle) {
    const MaterialUniformLayout* layout = context_.materials().layoutFor(handle);
    if (!layout) return;
    // Only the last pass applies the look: the copies share the file, and read the amount as none.
    const bool lastPass = handle.id() != copyShader_.id() && handle.id() != exactCopyShader_.id() && handle.id() != copyDepthShader_.id();
    const f32 amount = lastPass && displayLutActive() ? display_lut_amount_ : 0.0f;
    if (layout->blockSize > 0) {
        if (blitParamUbo_ == BufferHandle::Invalid || blitParamAmount_ != amount) {
            std::vector<u8> bytes(layout->blockSize, 0);
            for (const auto& p : layout->params) {
                if (p.name == "u_displayLutAmount") std::memcpy(bytes.data() + p.offset, &amount, sizeof(f32));
            }
            if (blitParamUbo_ == BufferHandle::Invalid) {
                blitParamUbo_ = device_.createBuffer({GfxBufferUsage::Uniform, layout->blockSize, /*dynamic=*/true},
                                                     GfxContent::retained(), bytes.data());
            } else {
                device_.updateBuffer(blitParamUbo_, 0, bytes.data(), static_cast<u32>(bytes.size()));
            }
            blitParamAmount_ = amount;
        }
        device_.setUniformBuffer(MATERIAL_CONSTANTS_BINDING, blitParamUbo_);
    }
    for (const auto& slot : layout->textures) {
        TextureHandle gpu = context_.materials().builtinDefault(slot.defaultTexture);
        if (slot.name == "u_displayLut" && lastPass && display_lut_texture_ != 0) gpu = TextureHandle{display_lut_texture_};
        if (gpu != TextureHandle::Invalid) device_.bindTexture(slot.unit, gpu);
    }
}

void PostProcessPipeline::runChain(std::vector<PostProcessPass>& passes, rg::ResourceId scene) {
    if (!graph_ || scene == rg::kNoResource) return;

    // The surface has to be declared big enough to hold the rect the blit writes,
    // which is NOT the chain's size once the present scales. Only the extent
    // matters: blitPass sets its own viewport, so the graph's default never runs.
    const u32 outW = std::max(width_, output_vp_x_ + output_vp_w_);
    const u32 outH = std::max(height_, output_vp_y_ + output_vp_h_);
    const rg::ResourceId out = graph_->importTarget(output_target_fbo_, outW, outH);
    const rg::TargetDesc desc = chainTarget(/*withDepth=*/false);
    const rg::TargetDesc blitDesc = blitSourceTarget(/*withDepth=*/false);

    // Which enabled pass is last decides which target the blit will sample.
    usize lastEnabled = passes.size();
    for (usize i = passes.size(); i-- > 0;) {
        if (runnable(passes[i])) { lastEnabled = i; break; }
    }

    rg::ResourceId input = scene;
    rg::ResourceId effectInput = scene;
    // The outputs of the current effect's passes so far, by pass name: what a `u_pass_<name>` texture reads.
    std::vector<std::pair<std::string, rg::ResourceId>> effectOutputs;
    for (usize i = 0; i < passes.size(); ++i) {
        auto& pass = passes[i];
        if (!runnable(pass)) continue;
        if (!pass.continuesEffect) {
            effectInput = input;
            effectOutputs.clear();
        }
        rg::PassDesc node;
        node.name = pass.name;
        pass.earlierInputs.clear();
        if (const MaterialUniformLayout* layout = context_.materials().layoutFor(pass.shader)) {
            for (const auto& slot : layout->textures) {
                if (slot.name.rfind("u_pass_", 0) != 0) continue;
                const std::string wanted = slot.name.substr(7);
                for (const auto& [name, id] : effectOutputs) {
                    if (name != wanted) continue;
                    pass.earlierInputs.emplace_back(slot.name, id);
                    node.dependencies.push_back(id);
                    break;
                }
            }
        }
        // Unit 1 is the image the pass's effect started from, which a composite
        // (bloom's and SSAO's last link) lays its result over — not the untouched
        // scene, which would discard every effect earlier in the chain.
        node.reads = {input, effectInput};
        // Every pass samples the scene's depth, so the scene target has to outlive
        // the last pass that reads its colour: returned to the pool any earlier,
        // an SSAO behind a colour grade found no depth and occluded nothing.
        // Added to, not assigned: the `u_pass_` targets above are dependencies too, and must outlive this pass.
        if (scene_needs_depth_ || scene_gbuffer_) node.dependencies.push_back(scene);
        // The motion pass wrote a target this one reads by name, not by unit: the graph owes it ordering
        // (and the pass its place in the culled set), and the pipeline binds it.
        if (velocity_active_ && velocity_resource_ != rg::kNoResource && passHasTexture(pass, "u_velocity")) {
            node.dependencies.push_back(velocity_resource_);
        }
        if (cover_active_ && cover_resource_ != rg::kNoResource && passHasTexture(pass, "u_rainCover")) {
            node.dependencies.push_back(cover_resource_);
        }
        if (shadow_resource_ != rg::kNoResource && passUsesLights(pass)) {
            node.dependencies.push_back(shadow_resource_);
        }
        // The last pass feeds the blit, which copies into the output rect at the
        // chain's size — so it draws full-size whatever fraction it asked for.
        rg::TargetDesc writeDesc = (i == lastEnabled) ? blitDesc : desc;
        if (i != lastEnabled) writeDesc.scale = pass.scale;
        if (passIsHighPrecision(pass)) writeDesc.format = GfxPixelFormat::RGBA16F;
        if (!pass.nativeKind.empty()) {
            // A pass the engine implements itself, in compute passes of its own that it declares onto the graph.
            if (pass.nativeKind == "voxelGI" && &passes == &passes_ && (scene_needs_depth_ || scene_gbuffer_) && scene_gbuffer_) {
                const auto get = [&pass](const char* name, f32 fallback) {
                    const auto it = pass.floatUniforms.find(name);
                    return it != pass.floatUniforms.end() ? it->second : fallback;
                };
                VoxelGIParams gi;
                gi.intensity = get("u_intensity", gi.intensity);
                gi.rays = static_cast<u32>(std::max(get("u_rays", static_cast<f32>(gi.rays)), 1.0f));
                gi.voxelSize = get("u_voxelSize", gi.voxelSize);
                gi.range = get("u_range", gi.range);
                gi.maxBounce = get("u_maxBounce", gi.maxBounce);
                gi.decay = get("u_decay", gi.decay);
                gi.bias = get("u_bias", gi.bias);
                gi.divisor = static_cast<u32>(std::max(get("u_divisor", static_cast<f32>(gi.divisor)), 1.0f));
                gi.debug = get("u_debug", gi.debug);
                gi.blend = get("u_blend", gi.blend);
                gi.sunAlbedo = get("u_sunAlbedo", gi.sunAlbedo);
                gi.bounceFeedback = get("u_bounceFeedback", gi.bounceFeedback);
                auto& cache = voxel_gis_[temporalKey_];
                if (!cache) {
                    // A handful of cameras at most have a cache each; one past that evicts another's, which rebuilds when its camera returns.
                    if (voxel_gis_.size() > 4) {
                        for (auto it = voxel_gis_.begin(); it != voxel_gis_.end(); ++it) {
                            if (it->first != temporalKey_) { voxel_gis_.erase(it); break; }
                        }
                    }
                    voxel_gis_[temporalKey_] = makeUnique<VoxelGI>(device_, context_);
                }
                input = voxel_gis_[temporalKey_]->declare(*graph_, input, scene, gi, width_, height_,
                                                          TextureHandle{shadow_texture_}, shadow_resource_);
            }
            continue;
        }
        if (pass.isCompute) {
            // A compute pass writes a storage texture, which is a half float whatever the chain keeps between passes (the
            // shader says its format), and it reads the scene's depth, so the scene has to outlive it.
            writeDesc.format = GfxPixelFormat::RGBA16F;
            writeDesc.storage = true;
            writeDesc.linearFilter = true;
            pass.temporal = false;
            pass.feedback = false;
            node.compute = true;
            node.reads = {input};
            node.dependencies = {scene};
            node.write = graph_->createTarget(writeDesc);
            node.execute = [this, &pass](const rg::PassContext& ctx) { computePass(pass, ctx); };
            input = node.write;
            effectOutputs.emplace_back(pass.name, input);
            graph_->addPass(std::move(node));
            continue;
        }
        if (sky_capture_.state == SkyCapture::State::Requested && pass.name == sky_capture_.pass && &passes == &passes_) {
            declareSkyCapture(pass, input, effectInput);
        }
        // A temporal pass writes the history target itself, so that what it wrote is
        // still there next frame, and the passes after it read it from there.
        TemporalState* temporal = nullptr;
        pass.temporal = false;
        pass.feedback = false;
        if (&passes == &passes_) {
            if (passIsTemporal(pass)) {
                // Never begun: nothing shifted this frame's picture, and nothing is remembered.
                if (auto it = temporal_.find(temporalKey_); it != temporal_.end() && it->second.frame > 0) {
                    temporal = prepareHistory(it->second, width_, height_, interFormat());
                    pass.temporal = temporal != nullptr;
                }
            } else if (passHasTexture(pass, "u_feedback")) {
                // At the pass's own size: a measurement is a few texels, not a picture.
                pass.historyKey = feedbackKey(pass.name);
                u32 fw = static_cast<u32>(static_cast<f32>(width_) * pass.scale);
                u32 fh = static_cast<u32>(static_cast<f32>(height_) * pass.scale);
                // A memory that is not a picture (the voxel cache laid out as an atlas) names its own size, in texels.
                const auto sized = [&pass](const char* name, u32 fallback) {
                    const auto it = pass.floatUniforms.find(name);
                    return it != pass.floatUniforms.end() && it->second >= 1.0f ? std::min(static_cast<u32>(it->second), 4096u) : fallback;
                };
                fw = sized("u_feedbackWidth", fw);
                fh = sized("u_feedbackHeight", fh);
                // What it remembers is a measurement: kept in a float even where the picture is 8 bits a channel.
                temporal = prepareHistory(feedback_[pass.historyKey], fw, fh,
                                          passIsHighPrecision(pass) ? GfxPixelFormat::RGBA16F : interFormat());
                pass.feedback = temporal != nullptr;
            }
        }
        if (temporal) {
            const u32 write = temporal->readIndex ^ 1u;
            Framebuffer& target = *temporal->history[write];
            node.write = graph_->importTarget(target.handle(), temporal->width, temporal->height,
                                              /*output=*/false, target.getColorAttachment());
            node.execute = [this, &pass, temporal, write](const rg::PassContext& ctx) {
                renderPass(pass, ctx);
                temporal->readIndex = write;
                temporal->valid = true;
                temporal->writtenFrame = temporal->frame;
            };
        } else {
            node.write = graph_->createTarget(writeDesc);
            node.execute = [this, &pass](const rg::PassContext& ctx) { renderPass(pass, ctx); };
        }
        input = node.write;
        effectOutputs.emplace_back(pass.name, input);
        graph_->addPass(std::move(node));
    }

    rg::PassDesc blit;
    blit.name = "blit";
    blit.reads = {input};
    blit.write = out;
    blit.execute = [this](const rg::PassContext&) { blitPass(); };
    graph_->addPass(std::move(blit));
}

void PostProcessPipeline::ensureScreenFBO() {
    // This one PERSISTS across frames, so a colour-space change leaves it holding
    // the format it was made under while the chain has moved on. Remade when it
    // no longer matches.
    if (screenFBOCreated_ && screenFBOFormat_ == interFormat()) return;
    screenFBO_.reset();
    screenFBOCreated_ = false;

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

    screenFBOFormat_ = spec.colorFormat;
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
    device->invalidatePipelineCache();
    device->setScissorTest(false);

    ensureGraph();
    if (!graph_) return;

    sceneTexture_ = screenFBO_->getColorAttachment();
    screenFBO_->unbind();

    // The composition surface every camera drew into is NOT a transient (it
    // outlives each camera graph), so this chain imports it and opens a graph
    // of its own.
    graph_->begin(width_, height_);
    runChain(screenPasses_, graph_->importTexture(sceneTexture_, width_, height_));
    // Its own graph and its own run: this chain composes what every camera drew
    // and happens after the last of them ended, so no frame is declaring here.
    graph_->execute();

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
