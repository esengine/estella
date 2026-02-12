/**
 * @file    PostProcessPipeline.hpp
 * @brief   Post-processing effects pipeline
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include "../resource/Handle.hpp"
#include "../math/Math.hpp"
#include "Framebuffer.hpp"
#include "Buffer.hpp"

#include <glm/glm.hpp>
#include <string>
#include <vector>
#include <unordered_map>

namespace esengine {

class RenderContext;

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
};

/**
 * @brief Post-processing effects pipeline
 *
 * @details Manages a chain of full-screen post-processing effects using
 *          ping-pong framebuffers. Effects are applied in order.
 */
class PostProcessPipeline {
public:
    PostProcessPipeline(RenderContext& context, resource::ResourceManager& resourceManager);
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
     */
    void begin();

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
     * @brief Checks if bypass mode is enabled
     */
    bool isBypassed() const { return bypass_; }

private:
    PostProcessPass* findPass(const std::string& name);
    void ensureFBOs();
    void renderPass(const PostProcessPass& pass, u32 inputTexture);
    void blitToScreen(u32 texture);

    RenderContext& context_;
    resource::ResourceManager& resourceManager_;

    Unique<Framebuffer> fboA_;
    Unique<Framebuffer> fboB_;
    Unique<VertexArray> screenQuadVAO_;
    resource::ShaderHandle blitShader_;

    std::vector<PostProcessPass> passes_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool initialized_ = false;
    bool fbosCreated_ = false;
    bool inFrame_ = false;
    bool bypass_ = false;
    u32 currentFBO_ = 0;
};

}  // namespace esengine
