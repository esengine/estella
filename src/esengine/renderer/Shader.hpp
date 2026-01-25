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

// Standard library
#include <string>
#include <unordered_map>

namespace esengine {

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
    static Unique<Shader> create(const std::string& vertexSrc, const std::string& fragmentSrc);

    /**
     * @brief Creates a shader from file paths
     * @param vertexPath Path to vertex shader file
     * @param fragmentPath Path to fragment shader file
     * @return Unique pointer to the shader, or nullptr on failure
     */
    static Unique<Shader> createFromFile(const std::string& vertexPath, const std::string& fragmentPath);

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

    /**
     * @brief Sets a float uniform
     * @param name Uniform name in shader
     * @param value Float value
     */
    void setUniform(const std::string& name, f32 value) const;

    /**
     * @brief Sets a vec2 uniform
     * @param name Uniform name in shader
     * @param value Vector value
     */
    void setUniform(const std::string& name, const glm::vec2& value) const;

    /**
     * @brief Sets a vec3 uniform
     * @param name Uniform name in shader
     * @param value Vector value
     */
    void setUniform(const std::string& name, const glm::vec3& value) const;

    /**
     * @brief Sets a vec4 uniform
     * @param name Uniform name in shader
     * @param value Vector value
     */
    void setUniform(const std::string& name, const glm::vec4& value) const;

    /**
     * @brief Sets a mat3 uniform
     * @param name Uniform name in shader
     * @param value Matrix value
     */
    void setUniform(const std::string& name, const glm::mat3& value) const;

    /**
     * @brief Sets a mat4 uniform
     * @param name Uniform name in shader
     * @param value Matrix value
     */
    void setUniform(const std::string& name, const glm::mat4& value) const;

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
    bool compile(const std::string& vertexSrc, const std::string& fragmentSrc);

    /**
     * @brief Gets uniform location with caching
     * @param name Uniform name
     * @return Location, or -1 if not found
     */
    i32 getUniformLocation(const std::string& name) const;

    /** @brief OpenGL program handle */
    u32 programId_ = 0;

    /** @brief Cached uniform locations (mutable for const uniform setters) */
    mutable std::unordered_map<std::string, i32> uniformCache_;
};

// =============================================================================
// Built-in Shader Sources
// =============================================================================

/**
 * @brief Common shader source code for 2D rendering
 *
 * @details Provides ready-to-use GLSL ES shader sources for common
 *          2D rendering tasks. Compatible with WebGL and OpenGL ES 2.0.
 */
namespace ShaderSources {

/**
 * @brief Vertex shader for textured sprites
 *
 * @details Uniforms:
 * - u_projection: Projection matrix
 * - u_model: Model transform matrix
 *
 * Attributes:
 * - a_position: Vertex position (vec2)
 * - a_texCoord: Texture coordinates (vec2)
 *
 * Outputs:
 * - v_texCoord: Interpolated texture coordinates
 */
inline const char* SPRITE_VERTEX = R"(
    attribute vec2 a_position;
    attribute vec2 a_texCoord;

    uniform mat4 u_projection;
    uniform mat4 u_model;

    varying vec2 v_texCoord;

    void main() {
        gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
)";

/**
 * @brief Fragment shader for textured sprites
 *
 * @details Uniforms:
 * - u_texture: Texture sampler
 * - u_color: Color tint
 *
 * Inputs:
 * - v_texCoord: Texture coordinates
 */
inline const char* SPRITE_FRAGMENT = R"(
    precision mediump float;

    uniform sampler2D u_texture;
    uniform vec4 u_color;

    varying vec2 v_texCoord;

    void main() {
        vec4 texColor = texture2D(u_texture, v_texCoord);
        gl_FragColor = texColor * u_color;
    }
)";

/**
 * @brief Vertex shader for solid color shapes
 *
 * @details Uniforms:
 * - u_projection: Projection matrix
 * - u_model: Model transform matrix
 *
 * Attributes:
 * - a_position: Vertex position (vec2)
 */
inline const char* COLOR_VERTEX = R"(
    attribute vec2 a_position;

    uniform mat4 u_projection;
    uniform mat4 u_model;

    void main() {
        gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
    }
)";

/**
 * @brief Fragment shader for solid color shapes
 *
 * @details Uniforms:
 * - u_color: Fill color
 */
inline const char* COLOR_FRAGMENT = R"(
    precision mediump float;

    uniform vec4 u_color;

    void main() {
        gl_FragColor = u_color;
    }
)";

}  // namespace ShaderSources

}  // namespace esengine
