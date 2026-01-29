/**
 * @file    ShaderLoader.cpp
 * @brief   Shader resource loader implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ShaderLoader.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../core/Log.hpp"

#include <algorithm>

namespace esengine::resource {

// =============================================================================
// Public Methods
// =============================================================================

ShaderLoadResult ShaderLoader::loadFromFile(const std::string& path,
                                             const std::string& platform) {
    ShaderLoadResult result;

    if (!FileSystem::fileExists(path)) {
        result.errorMessage = "Shader file not found: " + path;
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    std::string source = FileSystem::readTextFile(path);
    if (source.empty()) {
        result.errorMessage = "Failed to read shader file: " + path;
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    result = loadFromSource(source, platform);
    result.dependencies.push_back(path);

    if (result.isOk()) {
        ES_LOG_DEBUG("ShaderLoader: Loaded shader from {}", path);
    }

    return result;
}

ShaderLoadResult ShaderLoader::loadFromSource(const std::string& source,
                                               const std::string& platform) {
    ShaderLoadResult result;

    ParsedShader parsed = ShaderParser::parse(source);
    if (!parsed.valid) {
        result.errorMessage = "Shader parse error: " + parsed.errorMessage;
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    std::string effectivePlatform = platform.empty() ? getDefaultPlatform() : platform;

    std::string vertexSrc = ShaderParser::assembleStage(parsed, ShaderStage::Vertex, effectivePlatform);
    std::string fragmentSrc = ShaderParser::assembleStage(parsed, ShaderStage::Fragment, effectivePlatform);

    if (vertexSrc.empty()) {
        result.errorMessage = "Failed to assemble vertex shader";
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    if (fragmentSrc.empty()) {
        result.errorMessage = "Failed to assemble fragment shader";
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    result.shader = Shader::create(vertexSrc, fragmentSrc);
    if (!result.shader || !result.shader->isValid()) {
        result.errorMessage = "Failed to compile shader";
        result.shader.reset();
        ES_LOG_ERROR("ShaderLoader: {}", result.errorMessage);
        return result;
    }

    ES_LOG_DEBUG("ShaderLoader: Successfully compiled shader '{}'", parsed.name);
    return result;
}

std::string ShaderLoader::getDefaultPlatform() {
#ifdef ES_PLATFORM_WEB
    return "WEBGL";
#else
    return "DESKTOP";
#endif
}

bool ShaderLoader::canLoad(const std::string& path) {
    auto extensions = getSupportedExtensions();
    for (const auto& ext : extensions) {
        if (path.size() >= ext.size() &&
            path.compare(path.size() - ext.size(), ext.size(), ext) == 0) {
            return true;
        }
    }
    return false;
}

std::vector<std::string> ShaderLoader::getSupportedExtensions() {
    return {".esshader"};
}

}  // namespace esengine::resource
