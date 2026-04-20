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

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <fstream>

namespace esengine {

Shader::~Shader() {
    if (programId_ != 0) {
        glDeleteProgram(programId_);
        programId_ = 0;
    }
}

Shader::Shader(Shader&& other) noexcept
    : programId_(other.programId_)
    , uniformCache_(std::move(other.uniformCache_))
    , attribCache_(std::move(other.attribCache_))
    , activeUniforms_(std::move(other.activeUniforms_)) {
    other.programId_ = 0;
}

Shader& Shader::operator=(Shader&& other) noexcept {
    if (this != &other) {
        if (programId_ != 0) {
            glDeleteProgram(programId_);
        }
        programId_ = other.programId_;
        uniformCache_ = std::move(other.uniformCache_);
        attribCache_ = std::move(other.attribCache_);
        activeUniforms_ = std::move(other.activeUniforms_);
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

Unique<Shader> Shader::createWithBindings(const std::string& vertexSrc, const std::string& fragmentSrc,
                                            std::initializer_list<AttribBinding> bindings) {
    auto shader = makeUnique<Shader>();
    if (!shader->compile(vertexSrc, fragmentSrc, bindings)) {
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
    glUseProgram(programId_);
}

void Shader::unbind() const {
    glUseProgram(0);
}

bool Shader::compile(const std::string& vertexSrc, const std::string& fragmentSrc,
                     std::initializer_list<AttribBinding> bindings) {
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

    for (const auto& b : bindings) {
        glBindAttribLocation(programId_, b.index, b.name);
    }

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

    reflectActiveUniforms();

    ES_LOG_DEBUG("Shader compiled successfully (program ID: {}, active uniforms: {})",
                 programId_, activeUniforms_.size());
    return true;
}

namespace {

GfxUniformType shaderUniformTypeFromGL(GLenum type) {
    switch (type) {
    case GL_FLOAT:        return GfxUniformType::Float;
    case GL_FLOAT_VEC2:   return GfxUniformType::Vec2;
    case GL_FLOAT_VEC3:   return GfxUniformType::Vec3;
    case GL_FLOAT_VEC4:   return GfxUniformType::Vec4;
    case GL_INT:          return GfxUniformType::Int;
    case GL_INT_VEC2:     return GfxUniformType::IVec2;
    case GL_INT_VEC3:     return GfxUniformType::IVec3;
    case GL_INT_VEC4:     return GfxUniformType::IVec4;
    case GL_BOOL:         return GfxUniformType::Bool;
    case GL_FLOAT_MAT2:   return GfxUniformType::Mat2;
    case GL_FLOAT_MAT3:   return GfxUniformType::Mat3;
    case GL_FLOAT_MAT4:   return GfxUniformType::Mat4;
    case GL_SAMPLER_2D:   return GfxUniformType::Sampler2D;
    case GL_SAMPLER_CUBE: return GfxUniformType::SamplerCube;
    default:              return GfxUniformType::Unknown;
    }
}

}  // namespace

void Shader::reflectActiveUniforms() {
    activeUniforms_.clear();
    if (programId_ == 0) return;

    GLint count = 0;
    glGetProgramiv(programId_, GL_ACTIVE_UNIFORMS, &count);
    if (count <= 0) return;

    GLint maxNameLen = 0;
    glGetProgramiv(programId_, GL_ACTIVE_UNIFORM_MAX_LENGTH, &maxNameLen);
    if (maxNameLen <= 0) maxNameLen = 64;

    std::string nameBuf(static_cast<size_t>(maxNameLen), '\0');
    activeUniforms_.reserve(static_cast<size_t>(count));

    for (GLint i = 0; i < count; ++i) {
        GLsizei nameLen = 0;
        GLint size = 0;
        GLenum type = 0;
        glGetActiveUniform(programId_, static_cast<GLuint>(i),
                           static_cast<GLsizei>(maxNameLen), &nameLen,
                           &size, &type, nameBuf.data());

        std::string name(nameBuf.data(), static_cast<size_t>(nameLen));
        // Strip "[0]" suffix so callers look up arrays by their declared name.
        const auto bracket = name.find('[');
        if (bracket != std::string::npos) {
            name.erase(bracket);
        }

        GfxUniformInfo info;
        info.type = shaderUniformTypeFromGL(type);
        info.location = glGetUniformLocation(programId_, name.c_str());
        info.arraySize = size > 0 ? static_cast<u32>(size) : 1u;
        info.name = std::move(name);
        activeUniforms_.push_back(std::move(info));
    }
}

i32 Shader::getUniformLocation(const std::string& name) const {
    auto [it, inserted] = uniformCache_.emplace(name, -1);
    if (inserted) {
        it->second = glGetUniformLocation(programId_, name.c_str());
        if (it->second < 0) {
            ES_LOG_WARN("Shader {}: uniform '{}' not found (typo or optimized out)",
                        programId_, name);
        }
    }
    return it->second;
}

void Shader::setUniform(const std::string& name, i32 value) const {
    glUniform1i(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, f32 value) const {
    glUniform1f(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, const glm::vec2& value) const {
    glUniform2f(getUniformLocation(name), value.x, value.y);
}

void Shader::setUniform(const std::string& name, const glm::vec3& value) const {
    glUniform3f(getUniformLocation(name), value.x, value.y, value.z);
}

void Shader::setUniform(const std::string& name, const glm::vec4& value) const {
    glUniform4f(getUniformLocation(name), value.x, value.y, value.z, value.w);
}

void Shader::setUniform(const std::string& name, const glm::mat3& value) const {
    glUniformMatrix3fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::mat4& value) const {
    glUniformMatrix4fv(getUniformLocation(name), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setUniform(i32 location, i32 value) const {
    if (location >= 0) glUniform1i(location, value);
}

void Shader::setUniform(i32 location, f32 value) const {
    if (location >= 0) glUniform1f(location, value);
}

void Shader::setUniform(i32 location, const glm::vec2& value) const {
    if (location >= 0) glUniform2f(location, value.x, value.y);
}

void Shader::setUniform(i32 location, const glm::vec3& value) const {
    if (location >= 0) glUniform3f(location, value.x, value.y, value.z);
}

void Shader::setUniform(i32 location, const glm::vec4& value) const {
    if (location >= 0) glUniform4f(location, value.x, value.y, value.z, value.w);
}

void Shader::setUniform(i32 location, const glm::mat3& value) const {
    if (location >= 0) glUniformMatrix3fv(location, 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setUniform(i32 location, const glm::mat4& value) const {
    if (location >= 0) glUniformMatrix4fv(location, 1, GL_FALSE, glm::value_ptr(value));
}

i32 Shader::getAttribLocation(const std::string& name) const {
    auto [it, inserted] = attribCache_.emplace(name, -1);
    if (inserted) {
        it->second = glGetAttribLocation(programId_, name.c_str());
    }
    return it->second;
}

}  // namespace esengine
