/**
 * @file    ShaderLoader.hpp
 * @brief   Shader resource loader for .esshader files
 * @details Loads unified shader files and creates Shader resources.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../ResourceLoader.hpp"
#include "../ShaderParser.hpp"
#include "../../renderer/Shader.hpp"

#include <string>

namespace esengine::resource {

// =============================================================================
// ShaderLoadResult (legacy compatibility)
// =============================================================================

using ShaderLoadResult = LoadResult<Shader>;

// =============================================================================
// ShaderFileLoader Class
// =============================================================================

/**
 * @brief Loader for unified .esshader files
 *
 * @details Implements ResourceLoader<Shader> interface for loading shaders
 *          from the unified .esshader format. Supports platform variants.
 *
 * @code
 * ShaderFileLoader loader;
 * auto result = loader.load({"shaders/sprite.esshader"});
 * if (result.isOk()) {
 *     Shader* shader = result.resource.get();
 * }
 * @endcode
 */
class ShaderFileLoader : public ResourceLoader<Shader> {
public:
    bool canLoad(const std::string& path) const override;
    std::vector<std::string> getSupportedExtensions() const override;
    LoadResult<Shader> load(const LoadRequest& request) override;
    const char* getTypeName() const override { return "Shader"; }

    /**
     * @brief Loads a shader from source string
     * @param source Complete .esshader content
     * @param platform Platform variant to use (empty for auto-detect)
     * @return Load result with shader or error message
     */
    LoadResult<Shader> loadFromSource(const std::string& source,
                                       const std::string& platform = "");

    /**
     * @brief Gets the default platform identifier for current build
     * @return Platform string (e.g., "WEBGL", "DESKTOP")
     */
    static std::string getDefaultPlatform();
};

// =============================================================================
// ShaderLoader (legacy compatibility alias)
// =============================================================================

/**
 * @brief Legacy shader loader (use ShaderFileLoader for new code)
 */
class ShaderLoader {
public:
    ShaderLoadResult loadFromFile(const std::string& path,
                                   const std::string& platform = "");

    ShaderLoadResult loadFromSource(const std::string& source,
                                     const std::string& platform = "");

    static std::string getDefaultPlatform() { return ShaderFileLoader::getDefaultPlatform(); }
    static bool canLoad(const std::string& path);
    static std::vector<std::string> getSupportedExtensions();

private:
    ShaderFileLoader loader_;
};

}  // namespace esengine::resource
