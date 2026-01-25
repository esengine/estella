#include "Shader.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    // For native debugging, we'll use a minimal OpenGL header
    // In production, you'd include GLAD or similar
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    // Define missing GL functions for native build (stub)
    #ifndef GL_VERTEX_SHADER
        #define GL_VERTEX_SHADER 0x8B31
        #define GL_FRAGMENT_SHADER 0x8B30
        #define GL_COMPILE_STATUS 0x8B81
        #define GL_LINK_STATUS 0x8B82
        #define GL_INFO_LOG_LENGTH 0x8B84
    #endif
#endif

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
    // TODO: Implement file loading
    ES_LOG_ERROR("Shader::createFromFile not implemented yet");
    (void)vertexPath;
    (void)fragmentPath;
    return nullptr;
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
