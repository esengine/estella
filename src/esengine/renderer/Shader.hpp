/**
 * @file    Shader.hpp
 * @brief   GPU shader program abstraction
 * @details Provides a cross-platform shader abstraction for OpenGL ES/WebGL
 *          including compilation, linking, and uniform management.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "GfxEnums.hpp"

// Standard library
#include <initializer_list>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {

class GfxDevice;

struct AttribBinding {
    u32 index;
    const char* name;
};

/** @brief Which pipeline stage rejected a shader during compile/link. */
enum class ShaderStageFailure : u8 {
    None,
    Vertex,
    Fragment,
    Link,
};

// Forward declare Shader for the outcome struct.
class Shader;

/**
 * @brief Result returned by Shader::createEx when you need the raw driver log.
 *
 * On success `shader` is non-null and `failedStage == None`. On failure
 * `shader` is null, `failedStage` identifies which step rejected the source,
 * and `log` carries the GL info log verbatim (ready to feed into
 * ShaderParser::remapCompilerLog).
 */
struct ShaderCompileOutcome {
    Unique<Shader> shader;
    ShaderStageFailure failedStage = ShaderStageFailure::None;
    std::string log;
};

// =============================================================================
// Shader Class
// =============================================================================

/**
 * @brief GPU shader program for rendering
 *
 * @details Encapsulates an OpenGL/WebGL shader program consisting of
 *          a vertex shader and fragment shader. Provides uniform setting
 *          with location caching for performance.
 *
 * @code
 * auto shader = Shader::create(vertexSource, fragmentSource);
 * shader->bind();
 * shader->setUniform("u_projection", projectionMatrix);
 * shader->setUniform("u_color", glm::vec4(1.0f, 0.0f, 0.0f, 1.0f));
 * @endcode
 */
class Shader {
public:
    Shader() = default;
    ~Shader();

    // Non-copyable
    Shader(const Shader&) = delete;
    Shader& operator=(const Shader&) = delete;

    // Movable
    Shader(Shader&& other) noexcept;
    Shader& operator=(Shader&& other) noexcept;

    // =========================================================================
    // Creation
    // =========================================================================

    /**
     * @brief Creates a shader from source code strings
     * @param vertexSrc Vertex shader GLSL source
     * @param fragmentSrc Fragment shader GLSL source
     * @return Unique pointer to the shader, or nullptr on failure
     */
    static Unique<Shader> create(GfxDevice& device, const std::string& vertexSrc, const std::string& fragmentSrc);

    /**
     * @brief Creates a shader with explicit attribute bindings applied before linking
     * @param vertexSrc Vertex shader GLSL source
     * @param fragmentSrc Fragment shader GLSL source
     * @param bindings Attribute location bindings
     * @return Unique pointer to the shader, or nullptr on failure
     */
    static Unique<Shader> createWithBindings(GfxDevice& device,
                                              const std::string& vertexSrc, const std::string& fragmentSrc,
                                              std::initializer_list<AttribBinding> bindings);

    /**
     * @brief Creates a shader from file paths
     * @param vertexPath Path to vertex shader file
     * @param fragmentPath Path to fragment shader file
     * @return Unique pointer to the shader, or nullptr on failure
     */
    static Unique<Shader> createFromFile(GfxDevice& device,
                                         const std::string& vertexPath, const std::string& fragmentPath);

    /**
     * @brief Creates a shader and exposes the driver log on failure
     *
     * Same behaviour as createWithBindings but returns a ShaderCompileOutcome
     * so callers (notably ShaderLoader) can remap the GL log back to the
     * original .esshader file and line numbers.
     */
    static ShaderCompileOutcome createEx(GfxDevice& device,
                                         const std::string& vertexSrc,
                                         const std::string& fragmentSrc,
                                         std::initializer_list<AttribBinding> bindings = {});

    // =========================================================================
    // Operations
    // =========================================================================

    /** @brief Binds the shader for rendering */
    void bind() const;

    /** @brief Unbinds the shader */
    void unbind() const;

    // =========================================================================
    // Uniforms
    // =========================================================================

    /**
     * @brief Sets an integer uniform
     * @param name Uniform name in shader
     * @param value Integer value
     */
    void setUniform(const std::string& name, i32 value) const;
    void setUniform(const std::string& name, f32 value) const;
    void setUniform(const std::string& name, const glm::vec2& value) const;
    void setUniform(const std::string& name, const glm::vec3& value) const;
    void setUniform(const std::string& name, const glm::vec4& value) const;
    void setUniform(const std::string& name, const glm::mat3& value) const;
    void setUniform(const std::string& name, const glm::mat4& value) const;

    void setUniform(i32 location, i32 value) const;
    void setUniform(i32 location, f32 value) const;
    void setUniform(i32 location, const glm::vec2& value) const;
    void setUniform(i32 location, const glm::vec3& value) const;
    void setUniform(i32 location, const glm::vec4& value) const;
    void setUniform(i32 location, const glm::mat3& value) const;
    void setUniform(i32 location, const glm::mat4& value) const;

    // =========================================================================
    // Attributes
    // =========================================================================

    /**
     * @brief Gets the location of a vertex attribute
     * @param name Attribute name in shader
     * @return Location, or -1 if not found
     */
    i32 getAttribLocation(const std::string& name) const;

    i32 getUniformLocation(const std::string& name) const;

    /** @brief Returns reflected metadata for every active uniform, populated at link time */
    const std::vector<GfxUniformInfo>& getActiveUniforms() const { return activeUniforms_; }

    // =========================================================================
    // State
    // =========================================================================

    /**
     * @brief Checks if the shader compiled and linked successfully
     * @return True if the shader is usable
     */
    bool isValid() const { return programId_ != 0; }

    /**
     * @brief Gets the OpenGL program ID
     * @return GPU program handle
     */
    u32 getProgramId() const { return programId_; }

private:
    /**
     * @brief Compiles and links shader sources
     * @param vertexSrc Vertex shader source
     * @param fragmentSrc Fragment shader source
     * @return True on success
     */
    bool compile(const std::string& vertexSrc, const std::string& fragmentSrc,
                 std::initializer_list<AttribBinding> bindings = {},
                 std::string* outLog = nullptr,
                 ShaderStageFailure* outFailedStage = nullptr);

    void reflectActiveUniforms();

    GfxDevice* device_ = nullptr;  ///< Set by the create* factories; all GL goes through it.
    u32 programId_ = 0;

    /** @brief Cached uniform locations (mutable for const uniform setters) */
    mutable std::unordered_map<std::string, i32> uniformCache_;
    mutable std::unordered_map<std::string, i32> attribCache_;
    std::vector<GfxUniformInfo> activeUniforms_;
};

}  // namespace esengine
