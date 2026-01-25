#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include <string>
#include <unordered_map>

namespace esengine {

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

    // Create shader from source code
    static Unique<Shader> create(const std::string& vertexSrc, const std::string& fragmentSrc);

    // Create shader from files
    static Unique<Shader> createFromFile(const std::string& vertexPath, const std::string& fragmentPath);

    // Bind/unbind shader
    void bind() const;
    void unbind() const;

    // Uniform setters
    void setUniform(const std::string& name, i32 value);
    void setUniform(const std::string& name, f32 value);
    void setUniform(const std::string& name, const glm::vec2& value);
    void setUniform(const std::string& name, const glm::vec3& value);
    void setUniform(const std::string& name, const glm::vec4& value);
    void setUniform(const std::string& name, const glm::mat3& value);
    void setUniform(const std::string& name, const glm::mat4& value);

    // Check if shader is valid
    bool isValid() const { return programId_ != 0; }
    u32 getProgramId() const { return programId_; }

private:
    bool compile(const std::string& vertexSrc, const std::string& fragmentSrc);
    i32 getUniformLocation(const std::string& name);

    u32 programId_ = 0;
    std::unordered_map<std::string, i32> uniformCache_;
};

// Common shader sources for 2D rendering
namespace ShaderSources {

// Basic 2D sprite vertex shader
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

// Basic 2D sprite fragment shader
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

// Simple color vertex shader
inline const char* COLOR_VERTEX = R"(
    attribute vec2 a_position;

    uniform mat4 u_projection;
    uniform mat4 u_model;

    void main() {
        gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
    }
)";

// Simple color fragment shader
inline const char* COLOR_FRAGMENT = R"(
    precision mediump float;

    uniform vec4 u_color;

    void main() {
        gl_FragColor = u_color;
    }
)";

}  // namespace ShaderSources

}  // namespace esengine
