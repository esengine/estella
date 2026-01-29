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
// ShaderFileLoader Implementation
// =============================================================================

bool ShaderFileLoader::canLoad(const std::string& path) const {
    auto extensions = getSupportedExtensions();
    for (const auto& ext : extensions) {
        if (path.size() >= ext.size() &&
            path.compare(path.size() - ext.size(), ext.size(), ext) == 0) {
            return true;
        }
    }
    return false;
}

std::vector<std::string> ShaderFileLoader::getSupportedExtensions() const {
    return {".esshader"};
}

LoadResult<Shader> ShaderFileLoader::load(const LoadRequest& request) {
    if (!FileSystem::fileExists(request.path)) {
        return LoadResult<Shader>::err("Shader file not found: " + request.path);
    }

    std::string source = FileSystem::readTextFile(request.path);
    if (source.empty()) {
        return LoadResult<Shader>::err("Failed to read shader file: " + request.path);
    }

    auto result = loadFromSource(source, request.platform);
    result.dependencies.push_back(request.path);

    if (result.isOk()) {
        ES_LOG_DEBUG("ShaderFileLoader: Loaded shader from {}", request.path);
    }

    return result;
}

LoadResult<Shader> ShaderFileLoader::loadFromSource(const std::string& source,
                                                     const std::string& platform) {
    ParsedShader parsed = ShaderParser::parse(source);
    if (!parsed.valid) {
        ES_LOG_ERROR("ShaderFileLoader: {}", parsed.errorMessage);
        return LoadResult<Shader>::err("Shader parse error: " + parsed.errorMessage);
    }

    std::string effectivePlatform = platform.empty() ? getDefaultPlatform() : platform;

    std::string vertexSrc = ShaderParser::assembleStage(parsed, ShaderStage::Vertex, effectivePlatform);
    std::string fragmentSrc = ShaderParser::assembleStage(parsed, ShaderStage::Fragment, effectivePlatform);

    if (vertexSrc.empty()) {
        return LoadResult<Shader>::err("Failed to assemble vertex shader");
    }

    if (fragmentSrc.empty()) {
        return LoadResult<Shader>::err("Failed to assemble fragment shader");
    }

    auto shader = Shader::create(vertexSrc, fragmentSrc);
    if (!shader || !shader->isValid()) {
        ES_LOG_ERROR("ShaderFileLoader: Failed to compile shader");
        return LoadResult<Shader>::err("Failed to compile shader");
    }

    ES_LOG_DEBUG("ShaderFileLoader: Successfully compiled shader '{}'", parsed.name);
    return LoadResult<Shader>::ok(std::move(shader));
}

std::string ShaderFileLoader::getDefaultPlatform() {
#ifdef ES_PLATFORM_WEB
    return "WEBGL";
#else
    return "DESKTOP";
#endif
}

// =============================================================================
// ShaderLoader (Legacy) Implementation
// =============================================================================

ShaderLoadResult ShaderLoader::loadFromFile(const std::string& path,
                                             const std::string& platform) {
    LoadRequest request;
    request.path = path;
    request.platform = platform;
    return loader_.load(request);
}

ShaderLoadResult ShaderLoader::loadFromSource(const std::string& source,
                                               const std::string& platform) {
    return loader_.loadFromSource(source, platform);
}

bool ShaderLoader::canLoad(const std::string& path) {
    ShaderFileLoader loader;
    return loader.canLoad(path);
}

std::vector<std::string> ShaderLoader::getSupportedExtensions() {
    ShaderFileLoader loader;
    return loader.getSupportedExtensions();
}

}  // namespace esengine::resource
