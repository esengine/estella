/**
 * @file    Shader.cpp
 * @brief   Shader program implementation
 * @details Thin RAII handle over a GPU program. All GL is delegated to GfxDevice
 *          (compile/link via createProgram, uniforms via setUniform*, reflection
 *          via getActiveUniforms) — this file contains no GL calls.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Shader.hpp"
#include "GfxDevice.hpp"
#include "FrameConstants.hpp"
#include "../core/Log.hpp"

#include <fstream>
#include <vector>

namespace esengine {

Shader::~Shader() {
    if (programId_ != 0 && device_) {
        device_->deleteProgram(programId_);
        programId_ = 0;
    }
}

Shader::Shader(Shader&& other) noexcept
    : device_(other.device_)
    , programId_(other.programId_)
    , uniformCache_(std::move(other.uniformCache_))
    , attribCache_(std::move(other.attribCache_))
    , activeUniforms_(std::move(other.activeUniforms_)) {
    other.programId_ = 0;
}

Shader& Shader::operator=(Shader&& other) noexcept {
    if (this != &other) {
        if (programId_ != 0 && device_) {
            device_->deleteProgram(programId_);
        }
        device_ = other.device_;
        programId_ = other.programId_;
        uniformCache_ = std::move(other.uniformCache_);
        attribCache_ = std::move(other.attribCache_);
        activeUniforms_ = std::move(other.activeUniforms_);
        other.programId_ = 0;
    }
    return *this;
}

Unique<Shader> Shader::create(GfxDevice& device, const std::string& vertexSrc, const std::string& fragmentSrc) {
    auto shader = makeUnique<Shader>();
    shader->device_ = &device;
    if (!shader->compile(vertexSrc, fragmentSrc)) {
        return nullptr;
    }
    return shader;
}

Unique<Shader> Shader::createWithBindings(GfxDevice& device,
                                          const std::string& vertexSrc, const std::string& fragmentSrc,
                                          std::initializer_list<AttribBinding> bindings) {
    auto shader = makeUnique<Shader>();
    shader->device_ = &device;
    if (!shader->compile(vertexSrc, fragmentSrc, bindings)) {
        return nullptr;
    }
    return shader;
}

Unique<Shader> Shader::createFromFile(GfxDevice& device,
                                      const std::string& vertexPath, const std::string& fragmentPath) {
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

    return create(device, vertexSrc, fragmentSrc);
}

void Shader::bind() const {
    // Direct program bind for setup-time use (e.g. seeding a sampler uniform). Per-frame
    // rendering binds programs through GfxDevice::setPipeline, not here.
    if (device_) device_->useProgram(programId_);
}

void Shader::unbind() const {
    if (device_) device_->useProgram(0);
}

bool Shader::compile(const std::string& vertexSrc, const std::string& fragmentSrc,
                     std::initializer_list<AttribBinding> bindings,
                     std::string* outLog,
                     ShaderStageFailure* outFailedStage) {
    std::vector<GfxAttribBinding> binds;
    binds.reserve(bindings.size());
    for (const auto& b : bindings) {
        binds.push_back(GfxAttribBinding{b.index, b.name});
    }

    GfxShaderStage stage = GfxShaderStage::None;
    programId_ = device_->createProgram(vertexSrc.c_str(), fragmentSrc.c_str(),
                                        binds.data(), static_cast<u32>(binds.size()),
                                        outLog, &stage);

    if (outFailedStage) {
        switch (stage) {
        case GfxShaderStage::Vertex:   *outFailedStage = ShaderStageFailure::Vertex; break;
        case GfxShaderStage::Fragment: *outFailedStage = ShaderStageFailure::Fragment; break;
        case GfxShaderStage::Link:     *outFailedStage = ShaderStageFailure::Link; break;
        case GfxShaderStage::None:     *outFailedStage = ShaderStageFailure::None; break;
        }
    }

    if (programId_ == 0) {
        return false;
    }

    reflectActiveUniforms();

    // Link the per-frame constants block to its shared binding point, so the program
    // reads u_projection from the FrameConstants UBO with no loose uniform upload.
    // Programs without the block (custom/user shaders) simply skip this.
    u32 frameBlock = device_->getUniformBlockIndex(programId_, FRAME_CONSTANTS_BLOCK);
    if (frameBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(programId_, frameBlock, FRAME_CONSTANTS_BINDING);
    }

    ES_LOG_DEBUG("Shader compiled successfully (program ID: {}, active uniforms: {})",
                 programId_, activeUniforms_.size());
    return true;
}

ShaderCompileOutcome Shader::createEx(GfxDevice& device,
                                      const std::string& vertexSrc,
                                      const std::string& fragmentSrc,
                                      std::initializer_list<AttribBinding> bindings) {
    ShaderCompileOutcome outcome;
    auto shader = makeUnique<Shader>();
    shader->device_ = &device;
    if (!shader->compile(vertexSrc, fragmentSrc, bindings, &outcome.log, &outcome.failedStage)) {
        return outcome;
    }
    outcome.shader = std::move(shader);
    return outcome;
}

void Shader::reflectActiveUniforms() {
    activeUniforms_ = device_->getActiveUniforms(programId_);
}

i32 Shader::getUniformLocation(const std::string& name) const {
    auto [it, inserted] = uniformCache_.emplace(name, -1);
    if (inserted) {
        it->second = device_->getUniformLocation(programId_, name.c_str());
        if (it->second < 0) {
            ES_LOG_WARN("Shader {}: uniform '{}' not found (typo or optimized out)",
                        programId_, name);
        }
    }
    return it->second;
}

void Shader::setUniform(const std::string& name, i32 value) const {
    device_->setUniform1i(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, f32 value) const {
    device_->setUniform1f(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, const glm::vec2& value) const {
    device_->setUniform2f(getUniformLocation(name), value.x, value.y);
}

void Shader::setUniform(const std::string& name, const glm::vec3& value) const {
    device_->setUniform3f(getUniformLocation(name), value.x, value.y, value.z);
}

void Shader::setUniform(const std::string& name, const glm::vec4& value) const {
    device_->setUniform4f(getUniformLocation(name), value.x, value.y, value.z, value.w);
}

void Shader::setUniform(const std::string& name, const glm::mat3& value) const {
    device_->setUniformMat3(getUniformLocation(name), glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::mat4& value) const {
    device_->setUniformMat4(getUniformLocation(name), glm::value_ptr(value));
}

void Shader::setUniform(i32 location, i32 value) const {
    device_->setUniform1i(location, value);
}

void Shader::setUniform(i32 location, f32 value) const {
    device_->setUniform1f(location, value);
}

void Shader::setUniform(i32 location, const glm::vec2& value) const {
    device_->setUniform2f(location, value.x, value.y);
}

void Shader::setUniform(i32 location, const glm::vec3& value) const {
    device_->setUniform3f(location, value.x, value.y, value.z);
}

void Shader::setUniform(i32 location, const glm::vec4& value) const {
    device_->setUniform4f(location, value.x, value.y, value.z, value.w);
}

void Shader::setUniform(i32 location, const glm::mat3& value) const {
    device_->setUniformMat3(location, glm::value_ptr(value));
}

void Shader::setUniform(i32 location, const glm::mat4& value) const {
    device_->setUniformMat4(location, glm::value_ptr(value));
}

i32 Shader::getAttribLocation(const std::string& name) const {
    auto [it, inserted] = attribCache_.emplace(name, -1);
    if (inserted) {
        it->second = device_->getAttribLocation(programId_, name.c_str());
    }
    return it->second;
}

}  // namespace esengine
