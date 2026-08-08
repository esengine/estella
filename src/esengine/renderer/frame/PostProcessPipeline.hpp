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
 * @details Manages a chain of full-screen post-processing effects using
 *          ping-pong framebuffers. Effects are applied in order.
 */
class PostProcessPipeline {
public:
    PostProcessPipeline(GfxDevice& device, RenderContext& context, resource::ResourceManager& resourceManager);
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
     * @brief Removes a pass by name
     */
    void removePass(const std::string& name);

    /**
     * @brief Enables or disables a pass
     */
    void setPassEnabled(const std::string& name, bool enabled);

    /**
     * @brief Checks if a pass is enabled
     */
    bool isPassEnabled(const std::string& name) const;

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

    /**
     * @brief Ends and processes all passes
     * @details Applies all enabled passes and outputs to screen.
     */
    void end();

    /**
     * @brief Gets the source framebuffer texture
     */
    u32 getSourceTexture() const;

    /**
     * @brief Gets the output framebuffer texture
     */
    u32 getOutputTexture() const;

    /**
     * @brief Checks if pipeline is initialized
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Sets bypass mode to skip FBO rendering entirely
     * @param bypass If true, begin()/end() become no-ops
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
     *          not use. Drops the scene FBO when the answer changes so the next
     *          ensureFBOs rebuilds it with the right attachments — the same way resize
     *          handles a size change.
     */
    void setSceneNeedsDepth(bool needs) {
        if (needs == scene_needs_depth_) return;
        scene_needs_depth_ = needs;
        if (fboOriginalCreated_) {
            fboOriginal_.reset();
            fboOriginalCreated_ = false;
        }
    }
    bool linearOutput() const { return linear_output_; }

    /**
     * @brief Checks if bypass mode is enabled
     */
    bool isBypassed() const { return bypass_; }

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
    void ensureFBOs();
    void ensureScreenQuad();
    void drawScreenQuad();
    void applyPassPipeline(const Shader& shader);
    void renderPass(PostProcessPass& pass, TextureHandle inputTexture);
    void blitToOutput(TextureHandle texture);
    /// Frees a pass's GPU-side param UBO (removePass/clearPasses/shutdown).
    void releasePassResources(PostProcessPass& pass);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resourceManager_;

    Unique<Framebuffer> fboA_;
    Unique<Framebuffer> fboB_;
    Unique<Framebuffer> fboOriginal_;
    VertexLayoutHandle screen_quad_layout_ = VertexLayoutHandle::Invalid;
    BufferHandle screen_quad_vbo_ = BufferHandle::Invalid;
    resource::ShaderHandle blitShader_;

    std::vector<PostProcessPass> passes_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool initialized_ = false;
    bool fbosCreated_ = false;
    bool fboOriginalCreated_ = false;
    bool inFrame_ = false;
    bool bypass_ = false;
    bool linear_output_ = false;
    bool scene_needs_depth_ = false;
    u32 currentFBO_ = 0;
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
