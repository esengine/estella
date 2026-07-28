// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the Apache License, Version 2.0.
 */

#include "./Shader.hpp"
#include "./GfxDevice.hpp"
#include "../frame/FrameConstants.hpp"
#include "../store/MaterialConstants.hpp"
#include "../store/LightConstants.hpp"
#include "../../core/Log.hpp"

#include <cstring>
#include <fstream>
#include <vector>

namespace esengine {

Shader::~Shader() {
    if (device_) {
        if (program_ != ShaderHandle::Invalid) {
            device_->deleteProgram(program_);
            program_ = ShaderHandle::Invalid;
        }
        if (paramsUbo_ != BufferHandle::Invalid) {
            device_->deleteBuffer(paramsUbo_);
            paramsUbo_ = BufferHandle::Invalid;
        }
    }
}

Shader::Shader(Shader&& other) noexcept
    : device_(other.device_)
    , program_(other.program_)
    , uniformCache_(std::move(other.uniformCache_))
    , attribCache_(std::move(other.attribCache_))
    , activeUniforms_(std::move(other.activeUniforms_))
    , drawParams_(std::move(other.drawParams_))
    , paramsShadow_(std::move(other.paramsShadow_))
    , paramsDirty_(other.paramsDirty_)
    , paramsUbo_(other.paramsUbo_) {
    other.program_ = ShaderHandle::Invalid;
    other.paramsUbo_ = BufferHandle::Invalid;
}

Shader& Shader::operator=(Shader&& other) noexcept {
    if (this != &other) {
        if (device_) {
            if (program_ != ShaderHandle::Invalid) device_->deleteProgram(program_);
            if (paramsUbo_ != BufferHandle::Invalid) device_->deleteBuffer(paramsUbo_);
        }
        device_ = other.device_;
        program_ = other.program_;
        uniformCache_ = std::move(other.uniformCache_);
        attribCache_ = std::move(other.attribCache_);
        activeUniforms_ = std::move(other.activeUniforms_);
        drawParams_ = std::move(other.drawParams_);
        paramsShadow_ = std::move(other.paramsShadow_);
        paramsDirty_ = other.paramsDirty_;
        paramsUbo_ = other.paramsUbo_;
        other.program_ = ShaderHandle::Invalid;
        other.paramsUbo_ = BufferHandle::Invalid;
    }
    return *this;
}

Unique<Shader> Shader::create(GfxDevice& device, const std::string& vertexSrc, const std::string& fragmentSrc,
                              GfxShaderLanguage language) {
    auto shader = makeUnique<Shader>();
    shader->device_ = &device;
    if (!shader->compile(vertexSrc, fragmentSrc, {}, nullptr, nullptr, language)) {
        return nullptr;
    }
    return shader;
}

Unique<Shader> Shader::createWithBindings(GfxDevice& device,
                                          const std::string& vertexSrc, const std::string& fragmentSrc,
                                          std::initializer_list<AttribBinding> bindings,
                                          GfxShaderLanguage language) {
    auto shader = makeUnique<Shader>();
    shader->device_ = &device;
    if (!shader->compile(vertexSrc, fragmentSrc, bindings, nullptr, nullptr, language)) {
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
    if (device_) device_->useProgram(program_);
}

void Shader::unbind() const {
    if (device_) device_->useProgram(ShaderHandle::Invalid);
}

bool Shader::compile(const std::string& vertexSrc, const std::string& fragmentSrc,
                     std::initializer_list<AttribBinding> bindings,
                     std::string* outLog,
                     ShaderStageFailure* outFailedStage,
                     GfxShaderLanguage language) {
    language_ = language;

    // Fail fast on a language the backend cannot compile, before any GPU call —
    // the caller gets a diagnostic instead of a backend-specific compile error.
    if (!device_->supportsShaderLanguage(language)) {
        if (outLog) *outLog = "backend does not support the shader source language";
        if (outFailedStage) *outFailedStage = ShaderStageFailure::Vertex;
        ES_LOG_ERROR("Shader::compile: backend does not support the requested shader language");
        return false;
    }

    std::vector<GfxAttribBinding> binds;
    binds.reserve(bindings.size());
    for (const auto& b : bindings) {
        binds.push_back(GfxAttribBinding{b.index, b.name});
    }

    GfxShaderStage stage = GfxShaderStage::None;
    GfxShaderSource source{language, vertexSrc.c_str(), fragmentSrc.c_str()};
    program_ = device_->createProgram(source,
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

    if (program_ == ShaderHandle::Invalid) {
        return false;
    }

    reflectActiveUniforms();

    // Link the per-frame constants block to its shared binding point, so the program
    // reads u_projection from the FrameConstants UBO with no loose uniform upload.
    // Programs without the block (custom/user shaders) simply skip this.
    u32 frameBlock = device_->getUniformBlockIndex(program_, FRAME_CONSTANTS_BLOCK);
    if (frameBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(program_, frameBlock, FRAME_CONSTANTS_BINDING);
    }

    // Same for the per-material constants block (ShaderParser auto-generates it for shaders
    // authored with #pragma param); the render path binds each material's UBO here per draw.
    u32 materialBlock = device_->getUniformBlockIndex(program_, MATERIAL_CONSTANTS_BLOCK);
    if (materialBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(program_, materialBlock, MATERIAL_CONSTANTS_BINDING);
    }

    // Same for the per-frame 2D light block (ShaderParser injects it for Lit2D-domain shaders);
    // the render path uploads + binds the shared LightConstants UBO here once per frame.
    u32 lightBlock = device_->getUniformBlockIndex(program_, LIGHT_CONSTANTS_BLOCK);
    if (lightBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(program_, lightBlock, LIGHT_CONSTANTS_BINDING);
    }

    // Same for the injected frame clock (u_time).
    u32 timeBlock = device_->getUniformBlockIndex(program_, TIME_CONSTANTS_BLOCK);
    if (timeBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(program_, timeBlock, TIME_CONSTANTS_BINDING);
    }

    // Same for the per-draw params block (rewriteLooseUniforms generates it for
    // shaders whose loose uniforms were lifted); commitParams binds the UBO.
    u32 drawParamsBlock = device_->getUniformBlockIndex(program_, DRAW_PARAMS_BLOCK);
    if (drawParamsBlock != GFX_INVALID_UNIFORM_BLOCK) {
        device_->uniformBlockBinding(program_, drawParamsBlock, DRAW_PARAMS_BINDING);
    }

    ES_LOG_DEBUG("Shader compiled successfully (program handle: {}, active uniforms: {})",
                 static_cast<u32>(program_), activeUniforms_.size());
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
    activeUniforms_ = device_->getActiveUniforms(program_);
}

i32 Shader::cacheUniformLocation(const std::string& name, bool warnOnMiss) const {
    auto [it, inserted] = uniformCache_.emplace(name, -1);
    if (inserted) {
        it->second = device_->getUniformLocation(program_, name.c_str());
        if (it->second < 0 && warnOnMiss) {
            ES_LOG_WARN("Shader {}: uniform '{}' not found (typo or optimized out)",
                        static_cast<u32>(program_), name);
        }
    }
    return it->second;
}

i32 Shader::getUniformLocation(const std::string& name) const {
    return cacheUniformLocation(name, /*warnOnMiss=*/true);
}

bool Shader::hasUniform(const std::string& name) const {
    // A lifted uniform is a block member: it has no location, but callers that
    // guard with hasUniform (e.g. the post-process pass loop) must still see it.
    if (drawParams_.find(name) != nullptr) return true;
    return cacheUniformLocation(name, /*warnOnMiss=*/false) >= 0;
}

void Shader::adoptDrawParams(DrawParamsLayout layout) {
    drawParams_ = std::move(layout);
    paramsShadow_.assign(drawParams_.blockSize, 0);
    paramsDirty_ = false;  // commitParams creates the UBO from the zeroed shadow
    if (drawParams_.blockSize > DRAW_PARAMS_FALLBACK_SIZE) {
        ES_LOG_WARN("Shader {}: DrawParams block ({} bytes) exceeds the frame fallback ({}); "
                    "draws that skip commitParams may be rejected",
                    static_cast<u32>(program_), drawParams_.blockSize, DRAW_PARAMS_FALLBACK_SIZE);
    }
}

void Shader::commitParams() {
    if (drawParams_.empty() || !device_) return;
    if (paramsUbo_ == BufferHandle::Invalid) {
        paramsUbo_ = device_->createBuffer(
            {GfxBufferUsage::Uniform, drawParams_.blockSize, /*dynamic=*/true}, paramsShadow_.data());
        paramsDirty_ = false;
    } else if (paramsDirty_) {
        device_->updateBuffer(paramsUbo_, 0, paramsShadow_.data(), drawParams_.blockSize);
        paramsDirty_ = false;
    }
    // Rebind even when clean: the slot is shared, another shader's commit (or
    // the frame fallback) owns it otherwise.
    device_->setUniformBuffer(DRAW_PARAMS_BINDING, paramsUbo_);
}

bool Shader::writeParam(const std::string& name, DrawParamType type, const void* src) const {
    const DrawParamSlot* slot = drawParams_.find(name);
    if (slot == nullptr) return false;
    if (slot->type != type) {
        ES_LOG_WARN("Shader {}: setUniform('{}') type mismatch with its DrawParams slot",
                    static_cast<u32>(program_), name);
        return true;  // consumed: the name has no loose location to fall back to
    }
    u8* dst = paramsShadow_.data() + slot->offset;
    if (type == DrawParamType::Mat3) {
        // std140 mat3 columns have vec4 stride; glm::mat3 is 3 packed vec3s.
        const f32* m = static_cast<const f32*>(src);
        for (u32 col = 0; col < 3; ++col) {
            std::memcpy(dst + col * 16, m + col * 3, 3 * sizeof(f32));
        }
    } else {
        u32 size = 0, align = 0;
        drawParamSizeAlign(type, size, align);
        std::memcpy(dst, src, size);
    }
    paramsDirty_ = true;
    return true;
}

void Shader::setUniform(const std::string& name, i32 value) const {
    if (writeParam(name, DrawParamType::Int, &value)) return;
    device_->setUniform1i(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, f32 value) const {
    if (writeParam(name, DrawParamType::Float, &value)) return;
    device_->setUniform1f(getUniformLocation(name), value);
}

void Shader::setUniform(const std::string& name, const glm::vec2& value) const {
    if (writeParam(name, DrawParamType::Vec2, glm::value_ptr(value))) return;
    device_->setUniform2f(getUniformLocation(name), value.x, value.y);
}

void Shader::setUniform(const std::string& name, const glm::vec3& value) const {
    if (writeParam(name, DrawParamType::Vec3, glm::value_ptr(value))) return;
    device_->setUniform3f(getUniformLocation(name), value.x, value.y, value.z);
}

void Shader::setUniform(const std::string& name, const glm::vec4& value) const {
    if (writeParam(name, DrawParamType::Vec4, glm::value_ptr(value))) return;
    device_->setUniform4f(getUniformLocation(name), value.x, value.y, value.z, value.w);
}

void Shader::setUniform(const std::string& name, const glm::mat3& value) const {
    if (writeParam(name, DrawParamType::Mat3, glm::value_ptr(value))) return;
    device_->setUniformMat3(getUniformLocation(name), glm::value_ptr(value));
}

void Shader::setUniform(const std::string& name, const glm::mat4& value) const {
    if (writeParam(name, DrawParamType::Mat4, glm::value_ptr(value))) return;
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
        it->second = device_->getAttribLocation(program_, name.c_str());
    }
    return it->second;
}

}  // namespace esengine
