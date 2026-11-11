// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PostProcessPipeline.hpp
 * @brief   Post-processing effects pipeline
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../resource/Handle.hpp"
#include "../../math/Math.hpp"
#include "../rhi/Framebuffer.hpp"
#include "../graph/RenderGraph.hpp"
#include "../store/HdrFormat.hpp"

#include <glm/glm.hpp>
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>

namespace esengine {

class GfxDevice;
class RenderContext;
class Shader;
class VoxelGI;
class DynamicGI;

namespace resource {
    class ResourceManager;
}

/**
 * @brief What the last pass of a chain does to scene values on the way out.
 *
 * @details A tonemap is the OUTPUT transform, not an effect: it runs exactly once
 *          and last — after the effects, which want scene values, and before the
 *          OETF, which is a transfer function. `None` by default: a flat frame in
 *          linear light wants an exact round trip, and a filmic curve is not one.
 */
enum class OutputTransform : u8 {
    None = 0,  ///< Encode only. Values above 1 clip, which is what LDR content means.
    ACES = 1,  ///< Narkowicz ACES filmic curve, for a scene that carries HDR radiance.
    Neutral = 2,  ///< Khronos PBR Neutral: hue and saturation survive, highlights roll off.
};

/**
 * @brief Post-processing pass configuration
 */
struct PostProcessPass {
    std::string name;
    resource::ShaderHandle shader;
    bool enabled = true;
    std::unordered_map<std::string, f32> floatUniforms;
    std::unordered_map<std::string, glm::vec4> vec4Uniforms;
    /// Effect-declared textures (LUTs, masks): sampler uniform name -> GL
    /// texture id. #pragma-param shaders bind them at their reflected material
    /// units; the legacy loose path binds in order above the two engine units
    /// (0 = input, 1 = scene).
    std::vector<std::pair<std::string, u32>> textureUniforms;

    /// Set by the chain when the pass keeps its output for the next frame (its
    /// shader declares `u_history`); the pass then reads the previous frame there.
    bool temporal = false;
    /// Set instead of `temporal` when the shader declares `u_feedback`: the pass keeps
    /// its own last output without shifting the picture, and reads it there. An
    /// auto-exposure's adapted value is remembered this way.
    bool feedback = false;
    /// Which remembered state the pass uses, resolved when the chain is declared.
    u64 historyKey = 0;

    /// Fraction of the chain's size this pass draws at; the pass consuming it
    /// upsamples. The graph resolves the fraction, and u_viewport still reports
    /// the CANVAS, so a fractional pass must read its extent off its texture.
    f32 scale = 1.0f;

    /// Set on every pass of a multi-pass effect after its first: unit 1 then
    /// reads the input that effect started from, not this pass's own input. False
    /// starts an effect, so a single-pass effect sees the chain as it reached it.
    bool continuesEffect = false;

    /// What this pass reads from passes earlier in its own effect: a texture param named `u_pass_<name>` is the output
    /// of the pass called <name> (a bloom's upsample adds the downsample of its own size back). Resolved by the chain
    /// each frame, which also keeps those targets alive until this pass has run.
    std::vector<std::pair<std::string, rg::ResourceId>> earlierInputs;

    /// A compute pass (see PostProcessPipeline::addComputePass): the program, which floats its params block holds, in
    /// order, and the workgroup the shader declares. Invalid for every pass that draws.
    ComputeHandle compute = ComputeHandle::Invalid;
    bool isCompute = false;
    /// A pass the engine implements itself, in compute passes of its own (see VoxelGI): its name, empty for every other pass.
    std::string nativeKind;
    std::vector<std::string> computeParams;
    u32 workgroupX = 8;
    u32 workgroupY = 8;

    /// #pragma-param shaders: the pass's packed MaterialConstants payload +
    /// its UBO (binding 1) — the same reflected block a material would use.
    /// Rebuilt from float/vec4Uniforms over the layout defaults when dirty.
    std::vector<u8> paramBytes;
    BufferHandle paramUbo = BufferHandle::Invalid;
    bool paramDirty = true;
};

/**
 * @brief Post-processing effects pipeline
 *
 * @details Owns the scene capture and the effect chains; the chains themselves
 *          are declared to a RenderGraph, which decides what physical targets
 *          they cost. The per-camera and screen-level chains are the same shape
 *          and go through the same builder.
 */
class PostProcessPipeline {
public:
    /**
     * @brief Builds a pipeline that declares its chains onto the FRAME's graph.
     *
     * @details A chain is not a graph of its own: the frame declares the scene
     *          and the effects that read it to one graph and executes it once,
     *          so every pass a frame runs is stated in one place.
     */
    PostProcessPipeline(GfxDevice& device, RenderContext& context,
                        resource::ResourceManager& resourceManager, rg::RenderGraph& graph);

    /**
     * @brief Builds one with no frame behind it; it gets a graph of its own.
     *
     * @details The fallback path in the bindings, for a pipeline that exists
     *          without a RenderFrame having made one.
     */
    PostProcessPipeline(GfxDevice& device, RenderContext& context,
                        resource::ResourceManager& resourceManager);
    ~PostProcessPipeline();

    PostProcessPipeline(const PostProcessPipeline&) = delete;
    PostProcessPipeline& operator=(const PostProcessPipeline&) = delete;

    /**
     * @brief Initializes the pipeline with given dimensions
     */
    void init(u32 width, u32 height);

    /**
     * @brief Shuts down and releases resources
     */
    void shutdown();

    /**
     * @brief Resizes the framebuffers
     */
    void resize(u32 width, u32 height);

    /**
     * @brief Adds a post-processing pass
     * @param name Unique name for the pass
     * @param shader Shader handle for the effect
     * @return Index of the added pass
     */
    u32 addPass(const std::string& name, resource::ShaderHandle shader);
    /**
     * @brief Adds a pass that is a compute shader over the picture instead of a draw.
     * @details The WGSL is handed these, at group 0: `@binding(0)` the image so far (`texture_2d<f32>`), `@binding(1)`
     *          the image it writes (`texture_storage_2d<rgba16float, write>`, the same size), `@binding(2)` a uniform
     *          block of @p params as f32s in that order, `@binding(3)` the size as `vec4f(w, h, 1/w, 1/h)`, `@binding(4)`
     *          the scene's depth (`texture_depth_2d`), `@binding(5)` a linear clamp sampler. A shader declares the ones it
     *          uses. It is dispatched over the whole image in groups of @p workgroupX x @p workgroupY, which it declares.
     *          Compute needs a device that supportsCompute(): on one that does not the pass is left out of the chain, and
     *          the picture goes through as it was.
     * @return Index of the added pass.
     */
    u32 addComputePass(const std::string& name, const std::string& wgsl, const std::vector<std::string>& params,
                       u32 workgroupX, u32 workgroupY);
    /**
     * @brief Adds a pass the engine implements itself: "voxelGI" (see VoxelGI). Its parameters are set like any pass's, by name.
     * @details Needs a device with a compute stage; elsewhere the pass is left out of the chain.
     */
    u32 addNativePass(const std::string& name, const std::string& kind);
    /// Whether passes added with addComputePass run on this device.
    bool supportsCompute() const;
    /// The project's multisampling request; 1 = off. Clamped by the device.
    void setRequestedSamples(u32 samples);
    /// What the scene target is actually created with: the request after the
    /// device's ceiling. The two silently differing is how a project ships at 1x
    /// believing it asked for 8.
    u32 sceneSamples() const { return scene_samples_; }
    /// What was asked for, before the ceiling.
    u32 requestedSamples() const { return requested_samples_; }
    /// Draw @p passName at @p scale of the chain size (clamped to (0, 1]).
    void setPassScale(const std::string& passName, f32 scale);
    /// Mark @p passName as a later pass of the effect the pass before it began.
    void setPassContinuesEffect(const std::string& passName);




    /**
     * @brief Sets a float uniform for a pass
     */
    void setPassUniformFloat(const std::string& passName, const std::string& uniform, f32 value);

    /**
     * @brief Binds a texture to a pass's sampler uniform (unit 2 upward, in
     *        registration order). Replaces an existing binding of the same name.
     */
    void setPassTexture(const std::string& passName, const std::string& uniform, u32 glTextureId);

    /**
     * @brief Sets a vec4 uniform for a pass
     */
    void setPassUniformVec4(const std::string& passName, const std::string& uniform, const glm::vec4& value);

    /**
     * @brief Gets the pass count
     */
    u32 getPassCount() const { return static_cast<u32>(passes_.size()); }

    /**
     * @brief Gets a pass by index
     */
    const PostProcessPass* getPass(u32 index) const;

    /**
     * @brief Gets a pass by name
     */
    const PostProcessPass* getPass(const std::string& name) const;

    /**
     * @brief Begins rendering to the pipeline
     * @details Binds the input framebuffer. Render scene content after this.
     *          @p clearColor (RGBA) colors the capture's load-op clear — the
     *          camera background; null = opaque black.
     */
    void begin(const f32* clearColor = nullptr);

    /** The graph resource the scene is captured into, for the frame to declare
     *  its scene pass against. kNoResource when no capture is open. */
    rg::ResourceId sceneResource() const { return inFrame_ ? sceneResource_ : rg::kNoResource; }

    /** Declares this camera's chain onto the frame's graph. The frame runs it. */
    void declareChain();
    /** Closes the capture once the graph has run it. */
    void chainDone();

    /**
     * @brief Whether this frame's chain holds a temporal effect.
     *
     * @details An effect is temporal when its shader declares a `u_history` texture:
     *          the engine then keeps the pass's last output for it and shifts the
     *          picture by a sub-pixel amount each frame. The pass list is the
     *          answer, so there is no flag to disagree with it.
     */
    bool temporalActive();

    /**
     * @brief Whether an enabled pass that keeps no history reads the previous camera (`u_prevViewProjection0`).
     *
     * @details Motion blur is one: it needs to know where each pixel was a frame ago, and nothing else of the
     *          temporal machinery — no history, and above all no sub-pixel shift, which would shake a picture
     *          nothing resolves. The frame then follows the camera with @ref trackView.
     */
    bool cameraMotionWanted();

    /// The shape of the copy of the opaque scene a refractive surface reads: the chain's own, bilinear.
    rg::TargetDesc grabTarget() const { return chainTarget(/*withDepth=*/false); }

    /// Copies what is bound at unit 0 (the scene, as the pass before drew it) into the target being drawn. No exposure, no curve, no
    /// encode: a copy, with the alpha set to a marker (0.5) a shader can tell from the white a texture param falls back to — unless
    /// @p marked is false, for a copy that stands in for the scene itself (kept aside and put back): its alpha is coverage, and is kept.
    void grabScene(bool marked = true);

    /// Whether this device can hold the distances a depth copy is made of: a float target. Without one a surface that measures
    /// the water in front of what is behind it gets no depth and falls back to a fixed column.
    bool canGrabDepth();
    /// The shape of the copy of the opaque scene's depth: how far each pixel is from the eye, in the red channel of a float target.
    rg::TargetDesc grabDepthTarget() {
        rg::TargetDesc desc = chainTarget(/*withDepth=*/false);
        desc.format = GfxPixelFormat::RGBA16F;
        return desc;
    }
    /// Draws, into the target being drawn, the distance to the opaque scene at every pixel (the scene's depth, read at its unit).
    void grabDepth();

    /**
     * @brief Whether the scene is to be cleared to nothing (all four channels zero) so that its alpha says how much of each pixel geometry covers.
     *
     * @details A sky drawn after the scene (the Sky Atmosphere effect) replaces every pixel whose depth is the far plane. Depth is resolved from
     *          one sample of a multisampled target, so a wire narrower than a pixel — covered at some samples, not at the one depth keeps — is
     *          painted over wherever that sample missed, and a line becomes dashes. With a clear of (0,0,0,0) the resolved colour is the
     *          geometry's share premultiplied and the alpha is its coverage, which is exactly what the sky has to be laid UNDER.
     *          An enabled pass asks for it by declaring `u_sceneCoverage`, unless it keeps the scene's own background (`u_panorama` above zero):
     *          there the cleared pixels are what the picture shows, and they must stay the camera's colour.
     */
    bool sceneCoverageWanted();

    /// Records this frame's camera as the view @p key's current one, and last frame's as its previous. No shift.
    void trackView(const glm::mat4& viewProjection, u64 key);

    /**
     * @brief Whether an enabled pass reads how far each moving surface travelled (`u_velocity`).
     *
     * @details The frame then draws its moving meshes a second time into a target of its own, so a
     *          temporal effect can follow an object by its own displacement instead of the camera's.
     */
    bool velocityWanted();

    /// What a temporal view would be given by its NEXT begin: the sub-pixel shift and last frame's camera.
    struct TemporalView {
        glm::vec2 jitter{0.0f};
        glm::mat4 previous{1.0f};
        /// The shift the previous frame was drawn with.
        glm::vec2 previousJitter{0.0f};
    };
    /// Read before the scene is drawn, because the motion pass is collected with the scene and the shift
    /// is only applied when it is drawn. Changes nothing: beginTemporalView still takes the same step.
    TemporalView peekTemporalView(const glm::mat4& viewProjection, u64 key) const;

    /**
     * @brief The motion pass's target for this frame, declared in the graph (kNoResource when it cannot be made).
     *
     * @details RGBA32F: xy = how far the surface moved in uv, z = its window depth, w = 1 where something wrote.
     *          Depth in a float because the reader compares it with the scene's, and a half cannot tell two
     *          surfaces apart near the far plane.
     */
    rg::ResourceId declareVelocity();

    /**
     * @brief Whether an enabled pass reads what stands over each place (`u_rainCover`).
     *
     * @details The frame then draws the scene from straight above, depth only, around the camera: a map of the highest
     *          surface at each spot, so an effect can tell open ground from ground under an awning.
     */
    bool coverWanted();
    /// How far from the camera, in world units, that map reaches each way (the effect's `u_shelterRange`).
    f32 coverRange();
    /// The bias the drawing effect reads the map with (its u_shelterBias), for a pass that only borrows the map.
    f32 coverBias();
    /// The map's target for this frame, declared in the graph (kNoResource when it cannot be made).
    rg::ResourceId declareCover(u32 size);
    /// The matrix the map was drawn through, for the effect to put a world point in it.
    void setCoverMatrix(const glm::mat4& viewProjection) { cover_matrix_ = viewProjection; }

    /**
     * @brief Whether this frame's scene target carries a second attachment for the surface's material.
     *
     * @details Decided when the capture opens, from the passes: an effect whose shader says
     *          `#pragma gbuffer` reads what a surface IS (normal, roughness, metalness), which the
     *          scene's own shaders write beside the colour. A frame with no such effect makes none, so
     *          the cost is paid only by the project that asked for it.
     */
    bool sceneHasGBuffer() const { return inFrame_ && scene_gbuffer_; }

    /**
     * @brief The frame's environment atlas, for an effect that reflects it (`u_environment`).
     *
     * @details Handed over by the frame that bound it for the scene: the same atlas the meshes
     *          reflect, so a reflection an effect adds where the scene's own ray found nothing is the
     *          sky the surface already shows. 0 = none this frame.
     */
    void setEnvironmentTexture(u32 glTextureId) { environment_texture_ = glTextureId; }

    /**
     * @brief The frame's shadow atlas, for an effect that asks whether a point of air is in the sun (`#pragma lights`).
     *
     * @details The atlas is a graph resource the scene pass names as a dependency; an effect that reads it names it
     *          too, or the graph would hand it back to the pool before the effect ran. 0 / kNoResource = no map.
     */
    void setShadowAtlas(u32 glTextureId, rg::ResourceId resource) {
        shadow_texture_ = glTextureId;
        shadow_resource_ = resource;
    }

    /**
     * @brief Starts a frame of the temporal view @p key, and answers how far to shift it.
     *
     * @param key Names the view whose history this is — two cameras must not
     *        blend into one history. 0 for the screen.
     * @return The shift in clip-square units, to hand to the camera constants.
     */
    glm::vec2 beginTemporalView(const glm::mat4& viewProjection, u64 key);

    /**
     * @brief Checks if pipeline is initialized
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Whether the scene goes through the graph or straight to the surface.
     *
     * @details Effects to run, the linear pipeline, an output transform, a display LUT or a scaling present engage it. One predicate, because
     *          everyone asks at both ends of a frame and a capture opened but never resolved is one edit away.
     */
    bool isEngaged() const {
        // `initialized_` leads, and that is load-bearing: init refuses when the
        // blit shader will not compile, so a chain that cannot present degrades
        // to drawing straight at the surface rather than to a black frame.
        return initialized_ && ((!bypass_ && !passes_.empty()) || linear_output_
                                || output_transform_ != OutputTransform::None
                                || displayLutActive()
                                || view_exposure_ != 0.0f
                                || presentScales() || present_required_ || compute_needs_depth_);
    }

    /**
     * @brief Whether the chain's own size differs from the rect it lands in.
     *
     * @details Inferred rather than flagged: the chain size and the output rect
     *          are already two separate calls, so "they disagree" needs no third
     *          piece of state to go stale. A scene rendered at one resolution and
     *          presented at another is a scale, and a scale needs the blit.
     */
    bool presentScales() const {
        return output_vp_w_ > 0 && output_vp_h_ > 0
            && (output_vp_w_ != width_ || output_vp_h_ != height_);
    }

    /**
     * @brief The caller has decided this frame needs a present.
     *
     * @details A DECISION, not a rect — which is why it is set rather than
     *          inferred like presentScales(). A 1x letterbox and a split-screen
     *          viewport are the same geometry, same size and offset, and differ
     *          only in intent; the two rects cannot say which is which.
     */
    /// A compute pass reads the scene's depth, which only a scene drawn into a target of the graph's has.
    void setComputeNeedsDepth(bool needs) { compute_needs_depth_ = needs; }
    void setPresentRequired(bool required) { present_required_ = required; }

    /**
     * @brief This camera keeps the colour under it: its present composites over the target by coverage.
     *
     * @details A camera that does not clear colour (a first-person view model, any overlay) still goes through a capture when
     *          the frame is linear or has an output transform, and the capture starts empty. Copied over the target as it
     *          was, it replaced the camera underneath with black. Set by the frame when it opens such a camera's pass (its
     *          capture is then cleared to transparent); cleared when the camera's chain is done.
     */
    void setPresentOver(bool over) { present_over_ = over; }

    /**
     * @brief Whether the present is a whole-multiple upscale of the chain.
     *
     * @details Inferred from the two rects, for the reason presentScales() is:
     *          the rect is the one authority, and a filter beside it is a second
     *          one to disagree with. A whole multiple copies exactly, and
     *          interpolating it blurs a picture that needed no resampling.
     */
    /// A present that stretches the chain's picture over a bigger rect by a factor that is not a whole number: where a
    /// bilinear copy would blur it, and the blit resamples with a sharper filter instead.
    bool presentUpscales() const {
        return presentScales() && width_ > 0 && height_ > 0 && !presentIsWholeMultiple()
            && (output_vp_w_ > width_ || output_vp_h_ > height_);
    }

    bool presentIsWholeMultiple() const {
        if (!presentScales() || width_ == 0 || height_ == 0) return false;
        if (output_vp_w_ % width_ || output_vp_h_ % height_) return false;
        return output_vp_w_ / width_ == output_vp_h_ / height_;
    }

    /**
     * @brief Skip the EFFECTS, not the chain.
     *
     * @details It gates the authored passes and nothing else. The linear encode,
     *          the output transform and a scaling present all still engage —
     *          none of them is an effect, they are how the image reaches the
     *          screen, and a camera with no stack still needs them.
     */
    void setBypass(bool bypass) { bypass_ = bypass; }

    /**
     * @brief Linear-light mode: sRGB-format intermediates (hardware linear
     *        blending) and an always-engaged capture+blit whose final pass
     *        carries the linear->sRGB encode. Overrides bypass.
     */
    void setLinearOutput(bool linear) { linear_output_ = linear; }

    /**
     * @brief What this frame's intermediates were asked to be and allowed to be.
     *
     * @details The committed decision, not a re-derivation: an editor explaining
     *          why a linear project is running at 8-bit has to agree with the
     *          targets the frame actually made.
     */
    const HdrFormatDecision& hdrFormat() const { return frame_format_; }

    /**
     * @brief Whether the scene target needs a depth attachment.
     *
     * @details A depth buffer is per-frame memory and clear bandwidth (≈8MB at 1080p),
     *          which a project with no depth layer should not pay for a feature it does
     *          not use. A flag and nothing more: the scene target is declared to the
     *          graph at every begin(), so the next frame asks the pool for the shape
     *          this answer describes and the old one is simply never handed out again.
     */
    void setSceneNeedsDepth(bool needs) { scene_needs_depth_ = needs; }
    bool linearOutput() const { return linear_output_; }

    /**
     * @brief The curve the final pass applies to scene values.
     *
     * @details Costs nothing when the chain is already engaged — the blit was
     *          always going to run — so this is a variant of that shader rather
     *          than a pass of its own.
     */
    void setOutputTransform(OutputTransform transform) { output_transform_ = transform; }
    /**
     * @brief A graded look the final pass applies to the picture as the display will show it.
     *
     * @details The display stage of the last pass: after the output transform and the transfer function, from a 32x32x32 table laid out as
     *          a 1024x32 strip (slice along x is blue). It is a variant of that shader, so it costs one texture read and no pass. It belongs
     *          to the chain that set it, and is let go with the passes (clearPasses): a camera that wants it says so each time.
     * @param glTexture The table's texture, or 0 for none.
     * @param amount How far the picture moves toward the table's answer, 0 to 1.
     */
    void setDisplayLut(u32 glTexture, f32 amount) {
        display_lut_texture_ = glTexture;
        display_lut_amount_ = std::isfinite(amount) ? std::clamp(amount, 0.0f, 1.0f) : 0.0f;
    }
    bool displayLutActive() const { return display_lut_texture_ != 0 && display_lut_amount_ > 0.0f; }
    /// The editor view's exposure in stops, applied by the blit. Engages the blit when
    /// non-zero, since only the blit carries it; the value rides the frame's time block.
    void setViewExposure(f32 ev);
    OutputTransform outputTransform() const { return output_transform_; }

    /**
     * @brief Checks if bypass mode is enabled
     */
    /**
     * @brief Clears all passes
     */
    void clearPasses();

    /**
     * @brief Sets the output target for the final blit (Default = screen)
     */
    void setOutputTarget(FramebufferHandle target);

    /**
     * @brief Sets the output viewport for the final blit
     */
    void setOutputViewport(u32 x, u32 y, u32 w, u32 h);

    /**
     * @brief Begins screen-level capture (all camera output goes into screen FBO)
     */
    void beginScreenCapture();

    /**
     * @brief Ends screen-level capture
     */
    void endScreenCapture();

    /**
     * @brief Executes screen-level post-process passes on captured output
     */
    void executeScreenPasses();

    /**
     * @brief Adds a screen-level post-process pass
     */
    u32 addScreenPass(const std::string& name, resource::ShaderHandle shader);

    /**
     * @brief Clears all screen-level passes
     */
    void clearScreenPasses();

    /**
     * @brief Sets a float uniform for a screen-level pass
     */
    void setScreenPassUniformFloat(const std::string& passName, const std::string& uniform, f32 value);

    /**
     * @brief Sets a vec4 uniform for a screen-level pass
     */
    void setScreenPassUniformVec4(const std::string& passName, const std::string& uniform, const glm::vec4& value);

    /**
     * @brief Gets the screen pass count
     */
    u32 getScreenPassCount() const { return static_cast<u32>(screenPasses_.size()); }

    /**
     * @brief Checks if screen capture is active
     */
    bool isScreenCaptureActive() const { return screenCaptureActive_; }

    /** @brief The surface the scene is currently rendering into: the screen-capture
     *         FBO when the screen stack is live, the per-camera capture when
     *         in-frame, else the default target. The main-pass load-op clear must
     *         land HERE — rebinding the default target mid-capture breaks the stack. */
    FramebufferHandle currentSceneFBO() const;

    /**
     * @brief Draws pass @p passName once more, next frame, into a @p width x @p height RGBA8 target with its float param
     *        `u_skyCapture` at 1, and reads it back: a sky effect's panorama (see the SDK's defineSkyEffect).
     * @details The pass is drawn from a copy with a parameter buffer of its own — the same buffer written twice in one
     *          frame is one write on WebGPU. A request while one is in flight replaces it.
     */
    void requestSkyCapture(const std::string& passName, u32 width, u32 height);
    /** @brief Draws the texture on unit 0 into the bound target as RGBM over 8 (alpha 0 kept for nothing drawn): a probe
     *         capture's face, packed for an 8-bit readback. Called inside a graph pass that reads that texture. */
    void encodeRgbm();
    /** @brief 0 = not yet, 1 = the pixels are ready (skyCapturePixels), 2 = none was asked for or it failed. Issues the
     *         readback itself once the capture has been drawn, so call it between frames, never inside one. */
    i32 pollSkyCapture();
    /** @brief The captured pixels, RGBA8, rows bottom-up as every readback lands. Valid after poll answered 1. */
    const std::vector<u8>& skyCapturePixels() const { return sky_capture_.pixels; }

private:
    PostProcessPass* findPass(const std::string& name);
    /// The capture's node: the copy of @p pass drawn into the capture target. Declared in the chain so it runs with the
    /// frame's light and time bound, as the pass itself does.
    void declareSkyCapture(const PostProcessPass& pass, rg::ResourceId input, rg::ResourceId effectInput);
    /** Intermediate/capture attachment format for the active pipeline mode. */
    GfxPixelFormat interFormat() const;
    void commitFormat();
    /** The shape of every target in a chain, the scene target included. */
    rg::TargetDesc chainTarget(bool withDepth) const;
    rg::TargetDesc blitSourceTarget(bool withDepth) const;
    void ensureGraph();
    void ensureScreenQuad();
    void drawScreenQuad();
    /// @p over: composite onto the target by the source's coverage (premultiplied) instead of replacing it.
    void applyPassPipeline(const Shader& shader, bool over = false);
    void renderPass(PostProcessPass& pass, const rg::PassContext& ctx);
    /// A compute pass: its params and the size into a block each, the picture, the depth and the output bound, one dispatch over it.
    void computePass(PostProcessPass& pass, const rg::PassContext& ctx);
    /// Whether a pass has anything to run on this device: a drawn pass always, a compute one only where there is compute.
    bool runnable(const PostProcessPass& pass) const;
    /// Compute programs by source, kept while the pipeline lives: the passes are pushed again every camera, and a
    /// program is a compiled pipeline, not something to build per frame.
    std::unordered_map<std::string, ComputeHandle> compute_cache_;
    /// The voxel GI's cache lives here, across frames: what it has seen is the point of it. One per camera, since a cache is a
    /// window around the eye and two eyes would take turns tearing each other's down.
    std::unordered_map<u64, Unique<VoxelGI>> voxel_gis_;
    std::unordered_map<u64, Unique<DynamicGI>> dynamic_gis_;
    /// The size block a compute pass reads, one for all of them (each dispatch writes it just before it runs).
    BufferHandle compute_view_ubo_ = BufferHandle::Invalid;
    /// Declares one chain onto an already-begun graph and runs it, ending in the
    /// output target. @p scene is the resource the first effect reads.
    void runChain(std::vector<PostProcessPass>& passes, rg::ResourceId scene);
    /// The chain's last pass: the output transform, then the copy into the
    /// output target's viewport.
    void blitPass();
    /// The blit variant the current output transform, present and display LUT need, compiled on demand.
    resource::ShaderHandle outputShader();
    /// The variant of the blit with these features, or an invalid handle when it does not compile.
    resource::ShaderHandle blitVariant(bool upscale, OutputTransform transform, bool lut);
    /// Binds what every variant of the blit declares: its parameter block (the display LUT's amount) and the table's texture.
    void bindBlitInputs(const resource::ShaderHandle& shader);
    /// One variant of blit.esshader, by feature.
    resource::ShaderHandle compileBlit(const std::vector<std::string>& features);
    /// Frees a pass's GPU-side param UBO (clearPasses/shutdown).
    void releasePassResources(PostProcessPass& pass);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resourceManager_;

    /// The frame's graph when one was given; `ownedGraph_` otherwise.
    rg::RenderGraph* graph_ = nullptr;
    /// The frame's graph, kept so a shutdown can hand it back. Null with no frame.
    rg::RenderGraph* frameGraph_ = nullptr;
    Unique<rg::RenderGraph> ownedGraph_;
    VertexLayoutHandle screen_quad_layout_ = VertexLayoutHandle::Invalid;
    BufferHandle screen_quad_vbo_ = BufferHandle::Invalid;
    resource::ShaderHandle blitShader_;
    /// The other variants of the same file the last pass needs (a curve, the resampling upscaler, the display LUT), by feature set, compiled when
    /// a chain first asks. An invalid handle is a variant that would not compile: asked for once, not again.
    std::unordered_map<u32, resource::ShaderHandle> blitVariants_;
    u32 display_lut_texture_ = 0;
    f32 display_lut_amount_ = 0.0f;
    /// The last pass's parameter block (the display LUT's amount): one for every variant of the blit, written when the amount changes.
    BufferHandle blitParamUbo_ = BufferHandle::Invalid;
    f32 blitParamAmount_ = -1.0f;
    resource::ShaderHandle copyShader_;
    /// The copy that keeps alpha (grabScene(false)): the opaque scene kept aside and put back around the blended draws.
    resource::ShaderHandle exactCopyShader_;
    resource::ShaderHandle copyDepthShader_;

    std::vector<PostProcessPass> passes_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
    bool bypass_ = false;
    bool linear_output_ = false;
    /// The format this frame committed to; see commitFormat().
    HdrFormatDecision frame_format_{};
    /// What screenFBO_ was created with, so a policy change can be noticed.
    GfxPixelFormat screenFBOFormat_ = GfxPixelFormat::RGBA8;
    bool scene_needs_depth_ = false;
    /// What the PROJECT asked for (policy). 4 matches what a browser gives its
    /// own drawing buffer, which is the quality a chain-less frame always had.
    u32 requested_samples_ = 4;
    /// What the scene target actually rasterises with: the request clamped by
    /// the device's ceiling. Never read the ceiling as if it were the answer.
    u32 scene_samples_ = 1;
    void applySampleRequest();
    OutputTransform output_transform_ = OutputTransform::None;
    f32 view_exposure_ = 0.0f;
    /// The graph resource the scene is drawn into, live between begin() and end().
    rg::ResourceId sceneResource_ = rg::kNoResource;
    TextureHandle sceneTexture_ = TextureHandle::Invalid;

    FramebufferHandle output_target_fbo_ = FramebufferHandle::Default;
    u32 output_vp_x_ = 0;
    u32 output_vp_y_ = 0;
    bool present_required_ = false;
    bool present_over_ = false;
    bool compute_needs_depth_ = false;
    u32 output_vp_w_ = 0;
    u32 output_vp_h_ = 0;

    /// What a temporal pass remembers of one view between frames.
    struct TemporalState {
        glm::mat4 current{1.0f};
        glm::mat4 previous{1.0f};
        /// The render origin `current` was made for: the next frame's `previous` is it, taken to the origin then.
        glm::dvec3 origin{0.0};
        u32 frame = 0;
        /// The frame whose chain last wrote the history; a gap means the history
        /// is of a picture this one no longer follows.
        u32 writtenFrame = 0;
        Unique<Framebuffer> history[2];
        u32 readIndex = 0;
        bool valid = false;
        u32 width = 0;
        u32 height = 0;
        GfxPixelFormat format = GfxPixelFormat::RGBA8;
    };
    std::unordered_map<u64, TemporalState> temporal_;
    u64 temporalKey_ = 0;
    bool passIsTemporal(const PostProcessPass& pass);
    bool passUsesLights(const PostProcessPass& pass);
    /// Some enabled pass of the chain reads the surface record.
    bool passesWantGBuffer();
    bool scene_gbuffer_ = false;
    u32 environment_texture_ = 0;
    u32 shadow_texture_ = 0;
    rg::ResourceId shadow_resource_ = rg::kNoResource;
    /// The motion pass's target, kept across frames for its size, and whether this frame drew into it.
    Unique<Framebuffer> cover_fbo_;
    rg::ResourceId cover_resource_ = rg::kNoResource;
    /// A sky's panorama, drawn on request from a copy of its pass and read back (requestSkyCapture).
    struct SkyCapture {
        enum class State : u8 { Idle, Requested, Drawn, Reading };
        State state = State::Idle;
        std::string pass;
        u32 width = 64;
        u32 height = 32;
        Unique<Framebuffer> target;
        PostProcessPass copy;
        ReadbackHandle readback = ReadbackHandle::Invalid;
        std::vector<u8> pixels;
    };
    SkyCapture sky_capture_;
    resource::ShaderHandle rgbmShader_;
    bool cover_active_ = false;
    glm::mat4 cover_matrix_{1.0f};
    Unique<Framebuffer> velocity_fbo_;
    rg::ResourceId velocity_resource_ = rg::kNoResource;
    bool velocity_active_ = false;
    bool passHasTexture(const PostProcessPass& pass, const char* name);
    /// A pass that has the overhead cover map drawn for it (it states a reach, u_shelterRange), not one that only reads it.
    bool passDrawsCover(const PostProcessPass& pass);
    /// A history made (or kept) at @p w x @p h, or null when it cannot be.
    TemporalState* prepareHistory(TemporalState& state, u32 w, u32 h, GfxPixelFormat format);
    /// The pass writes a measurement, so its target is a float one where the device has them.
    bool passIsHighPrecision(const PostProcessPass& pass);
    /// Per pass, per view: what a `u_feedback` pass remembers.
    std::unordered_map<u64, TemporalState> feedback_;
    u64 feedbackKey(const std::string& passName) const;

    Unique<Framebuffer> screenFBO_;
    bool screenFBOCreated_ = false;
    bool screenCaptureActive_ = false;
    std::vector<PostProcessPass> screenPasses_;

    PostProcessPass* findScreenPass(const std::string& name);
    void ensureScreenFBO();
};

}  // namespace esengine
