/**
 * @file    RuntimeConfig.hpp
 * @brief   Runtime configuration for engine mode detection
 * @details Provides runtime flags for distinguishing editor vs game mode.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

namespace esengine {

// =============================================================================
// RuntimeConfig
// =============================================================================

/**
 * @brief Runtime configuration singleton
 *
 * @details Provides runtime flags for feature detection. Set by the
 *          application at startup based on build type.
 *
 * @code
 * // In editor main.cpp
 * RuntimeConfig::get().setEditorMode(true);
 *
 * // Anywhere in engine code
 * if (RuntimeConfig::get().isEditorMode()) {
 *     // Editor-only code
 * }
 * @endcode
 */
class RuntimeConfig {
public:
    static RuntimeConfig& get() {
        static RuntimeConfig instance;
        return instance;
    }

    /** @brief Sets editor mode flag */
    void setEditorMode(bool enabled) { editorMode_ = enabled; }

    /** @brief Checks if running in editor mode */
    bool isEditorMode() const { return editorMode_; }

    /** @brief Sets hot reload enabled flag */
    void setHotReloadEnabled(bool enabled) { hotReloadEnabled_ = enabled; }

    /** @brief Checks if hot reload is enabled */
    bool isHotReloadEnabled() const { return hotReloadEnabled_ && editorMode_; }

private:
    RuntimeConfig() = default;
    RuntimeConfig(const RuntimeConfig&) = delete;
    RuntimeConfig& operator=(const RuntimeConfig&) = delete;

    bool editorMode_ = false;
    bool hotReloadEnabled_ = true;
};

}  // namespace esengine
