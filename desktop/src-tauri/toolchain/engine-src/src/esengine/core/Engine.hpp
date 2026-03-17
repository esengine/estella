/**
 * @file    Engine.hpp
 * @brief   Engine information and capabilities
 * @details Provides engine version information, platform detection,
 *          and feature capability queries.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "Types.hpp"

// Standard library
#include <string>

namespace esengine {

// =============================================================================
// Engine Version
// =============================================================================

/**
 * @brief Engine version information
 *
 * @details Provides compile-time version constants and a utility
 *          function for retrieving the version string.
 */
struct EngineVersion {
    /** @brief Major version number (breaking changes) */
    static constexpr u32 MAJOR = 0;
    /** @brief Minor version number (new features) */
    static constexpr u32 MINOR = 1;
    /** @brief Patch version number (bug fixes) */
    static constexpr u32 PATCH = 0;

    /**
     * @brief Gets the version as a string
     * @return Version in "MAJOR.MINOR.PATCH" format
     */
    static std::string toString() {
        return std::to_string(MAJOR) + "." +
               std::to_string(MINOR) + "." +
               std::to_string(PATCH);
    }
};

// =============================================================================
// Engine Class
// =============================================================================

/**
 * @brief Global engine information and capability queries
 *
 * @details Provides static methods for querying engine metadata,
 *          platform information, and graphics capabilities.
 *
 * @code
 * std::cout << Engine::getName() << " v" << Engine::getVersion() << std::endl;
 *
 * if (Engine::isWebPlatform()) {
 *     // Web-specific code
 * }
 *
 * if (Engine::hasWebGL2()) {
 *     // Use WebGL 2 features
 * }
 * @endcode
 */
class Engine {
public:
    // =========================================================================
    // Instance Access
    // =========================================================================

    /**
     * @brief Gets the engine singleton instance
     * @return Reference to the engine instance
     */
    static Engine& get();

    // =========================================================================
    // Engine Information
    // =========================================================================

    /**
     * @brief Gets the engine name
     * @return "ESEngine"
     */
    static const char* getName() { return "ESEngine"; }

    /**
     * @brief Gets the engine version string
     * @return Version in "MAJOR.MINOR.PATCH" format
     */
    static std::string getVersion() { return EngineVersion::toString(); }

    // =========================================================================
    // Platform Information
    // =========================================================================

    /**
     * @brief Gets the current platform name
     * @return Platform identifier (e.g., "Web", "Windows", "Linux")
     */
    static const char* getPlatformName();

    /**
     * @brief Checks if running on a web platform
     * @return True if ES_PLATFORM_WEB is defined
     */
    static bool isWebPlatform();

    // =========================================================================
    // Capability Queries
    // =========================================================================

    /**
     * @brief Checks if WebGL 2.0 is available
     * @return True if WebGL 2.0 context is active
     *
     * @note Only meaningful on web platforms.
     */
    static bool hasWebGL2();

    /**
     * @brief Gets the maximum supported texture size
     * @return Maximum width/height in pixels
     */
    static u32 getMaxTextureSize();

private:
    Engine() = default;
    ~Engine() = default;

    // Non-copyable
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;
};

}  // namespace esengine
