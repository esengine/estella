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

struct AttribBinding {
    u32 index;
    const char* name;
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
    static Unique<Shader> create(const std::string& vertexSrc, const std::string& fragmentSrc);

    /**
     * @brief Creates a shader with explicit attribute bindings applied before linking
     * @param vertexSrc Vertex shader GLSL source
     * @param fragmentSrc Fragment shader GLSL source
     * @param bindings Attribute location bindings
     * @return Unique pointer to the shader, or nullptr on failure
     */
    static Unique<Shader> createWithBindings(const std::string& vertexSrc, const std::string& fragmentSrc,
                                              std::initializer_list<AttribBinding> bindings);

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
                 std::initializer_list<AttribBinding> bindings = {});

    void reflectActiveUniforms();

    u32 programId_ = 0;

    /** @brief Cached uniform locations (mutable for const uniform setters) */
    mutable std::unordered_map<std::string, i32> uniformCache_;
    mutable std::unordered_map<std::string, i32> attribCache_;
    std::vector<GfxUniformInfo> activeUniforms_;
};

// =============================================================================
// Built-in Shader Sources
// =============================================================================

/**
 * @brief Shader source code for internal renderers (ES 3.0)
 *
 * @details ES 1.0 shaders (sprite, color, batch compat) are now sourced from
 *          .esshader files via ShaderEmbeds.generated.hpp + ShaderParser.
 *          Only ES 3.0 and internal-only shaders remain here.
 */
namespace ShaderSources {

inline const char* EXT_MESH_VERTEX = R"(
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    attribute vec4 a_color;

    uniform mat4 u_projection;
    uniform mat4 u_model;

    varying vec2 v_texCoord;
    varying vec4 v_color;

    void main() {
        gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_color = a_color;
    }
)";

inline const char* EXT_MESH_FRAGMENT = R"(
    precision mediump float;

    uniform sampler2D u_texture;

    varying vec2 v_texCoord;
    varying vec4 v_color;

    void main() {
        vec4 texColor = texture2D(u_texture, v_texCoord);
        gl_FragColor = texColor * v_color;
    }
)";

inline const char* BATCH_VERTEX = R"(#version 300 es
    layout(location = 0) in vec2 a_position;
    layout(location = 1) in vec4 a_color;
    layout(location = 2) in vec2 a_texCoord;

    uniform mat4 u_projection;

    out vec4 v_color;
    out vec2 v_texCoord;

    void main() {
        gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
        v_color = a_color;
        v_texCoord = a_texCoord;
    }
)";

/**
 * @brief Fragment shader for batched sprite rendering
 */
inline const char* BATCH_FRAGMENT = R"(#version 300 es
    precision mediump float;

    in vec4 v_color;
    in vec2 v_texCoord;

    uniform sampler2D u_texture;

    out vec4 fragColor;

    void main() {
        vec4 texColor = texture(u_texture, v_texCoord);
        fragColor = texColor * v_color;
    }
)";

inline const char* PARTICLE_INSTANCE_VERTEX = R"(#version 300 es
    layout(location = 0) in vec2 a_position;
    layout(location = 1) in vec2 a_texCoord;

    layout(location = 2) in vec2 a_inst_position;
    layout(location = 3) in vec2 a_inst_size;
    layout(location = 4) in float a_inst_rotation;
    layout(location = 5) in vec4 a_inst_color;
    layout(location = 6) in vec2 a_inst_uv_offset;
    layout(location = 7) in vec2 a_inst_uv_scale;

    uniform mat4 u_projection;

    out vec2 v_texCoord;
    out vec4 v_color;

    void main() {
        vec2 scaled = a_position * a_inst_size;

        float cosR = cos(a_inst_rotation);
        float sinR = sin(a_inst_rotation);
        vec2 rotated = vec2(
            scaled.x * cosR - scaled.y * sinR,
            scaled.x * sinR + scaled.y * cosR
        );

        vec2 worldPos = rotated + a_inst_position;
        gl_Position = u_projection * vec4(worldPos, 0.0, 1.0);

        v_texCoord = a_texCoord * a_inst_uv_scale + a_inst_uv_offset;
        v_color = a_inst_color;
    }
)";

inline const char* PARTICLE_INSTANCE_FRAGMENT = R"(#version 300 es
    precision mediump float;

    in vec2 v_texCoord;
    in vec4 v_color;

    uniform sampler2D u_texture;

    out vec4 fragColor;

    void main() {
        vec4 texColor = texture(u_texture, v_texCoord);
        fragColor = texColor * v_color;
    }
)";

}  // namespace ShaderSources

}  // namespace esengine
