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

#include <glm/glm.hpp>
#include <string>
#include <vector>
#include <unordered_map>

namespace esengine {

class GfxDevice;
class RenderContext;
class Shader;

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

    /// Rebuilds the intermediates and per-pass buffers after a device loss. The
    /// blit shader is not re-created — the manager rebuilt it behind its handle.
    void recreateGpuResources();

    /**
     * @brief Adds a post-processing pass
     * @param name Unique name for the pass
     * @param shader Shader handle for the effect
     * @return Index of the added pass
     */
    u32 addPass(const std::string& name, resource::ShaderHandle shader);




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
     * @brief Checks if pipeline is initialized
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Whether the scene goes through the graph or straight to the surface.
     *
     * @details Four things engage it: effects to run, the linear pipeline (whose
     *          final pass carries an encode a WebGL2 canvas framebuffer cannot do
     *          for itself), an output transform, or a present that scales. One
     *          predicate because everyone asks at both ends of a frame, and two
     *          copies of it is one edit away from a capture that is opened and
     *          never resolved.
     */
    bool isEngaged() const {
        // `initialized_` leads, and that is load-bearing: init refuses when the
        // blit shader will not compile, so a chain that cannot present degrades
        // to drawing straight at the surface rather than to a black frame.
        return initialized_ && ((!bypass_ && !passes_.empty()) || linear_output_
                                || output_transform_ != OutputTransform::None
                                || presentScales());
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

private:
    PostProcessPass* findPass(const std::string& name);
    /** Intermediate/capture attachment format for the active pipeline mode. */
    GfxPixelFormat interFormat() const;
    /** The shape of every target in a chain, the scene target included. */
    rg::TargetDesc chainTarget(bool withDepth) const;
    void ensureGraph();
    void ensureScreenQuad();
    void drawScreenQuad();
    void applyPassPipeline(const Shader& shader);
    void renderPass(PostProcessPass& pass, const rg::PassContext& ctx);
    /// Declares one chain onto an already-begun graph and runs it, ending in the
    /// output target. @p scene is the resource the first effect reads.
    void runChain(std::vector<PostProcessPass>& passes, rg::ResourceId scene);
    /// The chain's last pass: the output transform, then the copy into the
    /// output target's viewport.
    void blitPass();
    /// The blit variant the current output transform needs, compiled on demand.
    resource::ShaderHandle outputShader();
    /// One variant of blit.esshader, by feature.
    resource::ShaderHandle compileBlit(const std::vector<std::string>& features);
    /// Frees a pass's GPU-side param UBO (clearPasses/shutdown).
    void releasePassResources(PostProcessPass& pass);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resourceManager_;

    /// The frame's graph when one was given; `ownedGraph_` otherwise.
    rg::RenderGraph* graph_ = nullptr;
    Unique<rg::RenderGraph> ownedGraph_;
    VertexLayoutHandle screen_quad_layout_ = VertexLayoutHandle::Invalid;
    BufferHandle screen_quad_vbo_ = BufferHandle::Invalid;
    resource::ShaderHandle blitShader_;
    /// The ES_TONEMAP variant of the same file. Invalid until a chain asks for it.
    resource::ShaderHandle tonemapShader_;

    std::vector<PostProcessPass> passes_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
    bool bypass_ = false;
    bool linear_output_ = false;
    bool scene_needs_depth_ = false;
    OutputTransform output_transform_ = OutputTransform::None;
    /// The graph resource the scene is drawn into, live between begin() and end().
    rg::ResourceId sceneResource_ = rg::kNoResource;
    TextureHandle sceneTexture_ = TextureHandle::Invalid;

    FramebufferHandle output_target_fbo_ = FramebufferHandle::Default;
    u32 output_vp_x_ = 0;
    u32 output_vp_y_ = 0;
    u32 output_vp_w_ = 0;
    u32 output_vp_h_ = 0;

    Unique<Framebuffer> screenFBO_;
    bool screenFBOCreated_ = false;
    bool screenCaptureActive_ = false;
    std::vector<PostProcessPass> screenPasses_;

    PostProcessPass* findScreenPass(const std::string& name);
    void ensureScreenFBO();
};

}  // namespace esengine
