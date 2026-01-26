/**
 * @file    Shader.cpp
 * @brief   Shader program implementation for OpenGL/WebGL
 * @details Implements shader compilation, linking, and uniform management.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Shader.hpp"
#include "../core/Log.hpp"
#include "OpenGLHeaders.hpp"

#include <fstream>

namespace esengine {

Shader::~Shader() {
    if (programId_ != 0) {
#ifdef ES_PLATFORM_WEB
        glDeleteProgram(programId_);
#endif
        programId_ = 0;
    }
}

Shader::Shader(Shader&& other) noexcept
    : programId_(other.programId_), uniformCache_(std::move(other.uniformCache_)) {
    other.programId_ = 0;
}

Shader& Shader::operator=(Shader&& other) noexcept {
    if (this != &other) {
        if (programId_ != 0) {
#ifdef ES_PLATFORM_WEB
            glDeleteProgram(programId_);
#endif
        }
        programId_ = other.programId_;
        uniformCache_ = std::move(other.uniformCache_);
        other.programId_ = 0;
    }
    return *this;
}

Unique<Shader> Shader::create(const std::string& vertexSrc, const std::string& fragmentSrc) {
    auto shader = makeUnique<Shader>();
    if (!shader->compile(vertexSrc, fragmentSrc)) {
        return nullptr;
    }
    return shader;
}

Unique<Shader> Shader::createFromFile(const std::string& vertexPath, const std::string& fragmentPath) {
    auto readFile = [](const std::string& filepath) -> std::string {
        std::ifstream file(filepath, std::ios::in | std::ios::binary);
        if (!file.is_open()) {
            ES_LOG_ERROR("Failed to open shader file: {}", filepath);
            return "";
        }

        file.seekg(0, std::ios::end);
        const auto fileSize = file.tellg();
        if (fileSize <= 0) {
            ES_LOG_ERROR("Shader file is empty: {}", filepath);
            return "";
        }

        std::string content;
        content.resize(static_cast<usize>(fileSize));
        file.seekg(0, std::ios::beg);
        file.read(&content[0], fileSize);

        if (file.fail()) {
            ES_LOG_ERROR("Failed to read shader file: {}", filepath);
            return "";
        }

        return content;
    };

    std::string vertexSrc = readFile(vertexPath);
    std::string fragmentSrc = readFile(fragmentPath);

    if (vertexSrc.empty() || fragmentSrc.empty()) {
        ES_LOG_ERROR("Failed to load shader files: vertex={}, fragment={}", vertexPath, fragmentPath);
        return nullptr;
    }

    return create(vertexSrc, fragmentSrc);
}

void Shader::bind() const {
#ifdef ES_PLATFORM_WEB
    glUseProgram(programId_);
#endif
}

void Shader::unbind() const {
#ifdef ES_PLATFORM_WEB
    glUseProgram(0);
#endif
}

bool Shader::compile(const std::string& vertexSrc, const std::string& fragmentSrc) {
#ifdef ES_PLATFORM_WEB
    // Create vertex shader
    GLuint vertexShader = glCreateShader(GL_VERTEX_SHADER);
    const char* vertexSrcPtr = vertexSrc.c_str();
    glShaderSource(vertexShader, 1, &vertexSrcPtr, nullptr);
    glCompileShader(vertexShader);

    // Check vertex shader compilation
    GLint success;
    glGetShaderiv(vertexShader, GL_COMPILE_STATUS, &success);
    if (!success) {
        GLint logLength;
        glGetShaderiv(vertexShader, GL_INFO_LOG_LENGTH, &logLength);
        std::string log(logLength, '\0');
        glGetShaderInfoLog(vertexShader, logLength, nullptr, log.data());
        ES_LOG_ERROR("Vertex shader compilation failed: {}", log);
        glDeleteShader(vertexShader);
        return false;
    }

    // Create fragment shader
    GLuint fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
    const char* fragmentSrcPtr = fragmentSrc.c_str();
    glShaderSource(fragmentShader, 1, &fragmentSrcPtr, nullptr);
    glCompileShader(fragmentShader);

    // Check fragment shader compilation
    glGetShaderiv(fragmentShader, GL_COMPILE_STATUS, &success);
    if (!success) {
        GLint logLength;
        glGetShaderiv(fragmentShader, GL_INFO_LOG_LENGTH, &logLength);
        std::string log(logLength, '\0');
        glGetShaderInfoLog(fragmentShader, logLength, nullptr, log.data());
        ES_LOG_ERROR("Fragment shader compilation failed: {}", log);
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        return false;
    }

    // Create program and link
    programId_ = glCreateProgram();
    glAttachShader(programId_, vertexShader);
    glAttachShader(programId_, fragmentShader);
    glLinkProgram(programId_);

    // Check linking
    glGetProgramiv(programId_, GL_LINK_STATUS, &success);
    if (!success) {
        GLint logLength;
        glGetProgramiv(programId_, GL_INFO_LOG_LENGTH, &logLength);
        std::string log(logLength, '\0');
        glGetProgramInfoLog(programId_, logLength, nullptr, log.data());
        ES_LOG_ERROR("Shader program linking failed: {}", log);
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        glDeleteProgram(programId_);
        programId_ = 0;
        return false;
    }

    // Clean up shaders (they're now part of the program)
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    ES_LOG_DEBUG("Shader compiled successfully (program ID: {})", programId_);
    return true;
#else
    (void)vertexSrc;
    (void)fragmentSrc;
    ES_LOG_WARN("Shader compilation not available in native mode");
    return false;
#endif
}

i32 Shader::getUniformLocation(const std::string& name) const {
    auto it = uniformCache_.find(name);
    if (it != uniformCache_.end()) {
        return it->second;
    }

#ifdef ES_PLATFORM_WEB
    i32 location = glGetUniformLocation(programId_, name.c_str());
    uniformCache_[name] = location;
    if (location == -1) {
        ES_LOG_WARN("Uniform '{}' not found in shader", name);
    }
    return location;
#else
    return -1;
#endif
}

void Shader::setUniform(const std::string& name, i32 value) const {
#ifdef ES_PLATFORM_WEB
    glUniform1i(getUniformLocation(name), value);
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, f32 value) const {
#ifdef ES_PLATFORM_WEB
    glUniform1f(getUniformLocation(name), value);
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, const glm::vec2& value) const {
#ifdef ES_PLATFORM_WEB
    glUniform2f(getUniformLocation(name), value.x, value.y);
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, const glm::vec3& value) const {
#ifdef ES_PLATFORM_WEB
    glUniform3f(getUniformLocation(name), value.x, value.y, value.z);
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, const glm::vec4& value) const {
#ifdef ES_PLATFORM_WEB
    glUniform4f(getUniformLocation(name), value.x, value.y, value.z, value.w);
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, const glm::mat3& value) const {
#ifdef ES_PLATFORM_WEB
    glUniformMatrix3fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
#else
    (void)name;
    (void)value;
#endif
}

void Shader::setUniform(const std::string& name, const glm::mat4& value) const {
#ifdef ES_PLATFORM_WEB
    glUniformMatrix4fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
#else
    (void)name;
    (void)value;
#endif
}

}  // namespace esengine
