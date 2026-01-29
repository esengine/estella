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
#include "../ShaderParser.hpp"
#include "../../renderer/Shader.hpp"

#include <string>

namespace esengine::resource {

// =============================================================================
// Load Result
// =============================================================================

/**
 * @brief Result of shader loading operation
 */
struct ShaderLoadResult {
    Unique<Shader> shader;           ///< Loaded shader (nullptr on failure)
    std::string errorMessage;        ///< Error message if loading failed
    std::vector<std::string> dependencies;  ///< File dependencies for hot reload

    /** @brief Checks if loading succeeded */
    bool isOk() const { return shader != nullptr; }
};

// =============================================================================
// ShaderLoader Class
// =============================================================================

/**
 * @brief Loader for unified .esshader files
 *
 * @details Parses .esshader format and creates GPU shader resources.
 *          Supports platform variants for cross-platform compatibility.
 *
 * @code
 * ShaderLoader loader;
 * auto result = loader.loadFromFile("shaders/sprite.esshader");
 * if (result.isOk()) {
 *     Shader* shader = result.shader.get();
 * }
 * @endcode
 */
class ShaderLoader {
public:
    /**
     * @brief Loads a shader from .esshader file
     * @param path Path to the .esshader file
     * @param platform Platform variant to use (empty for auto-detect)
     * @return Load result with shader or error message
     */
    ShaderLoadResult loadFromFile(const std::string& path,
                                   const std::string& platform = "");

    /**
     * @brief Loads a shader from source string
     * @param source Complete .esshader content
     * @param platform Platform variant to use (empty for auto-detect)
     * @return Load result with shader or error message
     */
    ShaderLoadResult loadFromSource(const std::string& source,
                                     const std::string& platform = "");

    /**
     * @brief Gets the default platform identifier for current build
     * @return Platform string (e.g., "WEBGL", "DESKTOP")
     */
    static std::string getDefaultPlatform();

    /**
     * @brief Checks if a file path is a supported shader format
     * @param path File path to check
     * @return True if the file extension is supported
     */
    static bool canLoad(const std::string& path);

    /**
     * @brief Gets supported file extensions
     * @return List of supported extensions (e.g., {".esshader"})
     */
    static std::vector<std::string> getSupportedExtensions();
};

}  // namespace esengine::resource
