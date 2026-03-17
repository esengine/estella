/**
 * @file    HotReloadManager.hpp
 * @brief   Hot reload manager for resources
 * @details Watches files for changes and triggers reloading of resources.
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

#include "../core/Types.hpp"
#include "../events/Signal.hpp"
#include "../platform/FileSystem.hpp"
#include "Handle.hpp"

#include <string>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <typeindex>

namespace esengine::resource {

// Forward declarations
class ResourceManager;

// =============================================================================
// Reload Event
// =============================================================================

/**
 * @brief Event data for resource reload
 */
template<typename T>
struct ReloadEvent {
    Handle<T> handle;           ///< Handle to the reloaded resource
    std::string path;           ///< File path that changed
    bool success = false;       ///< Whether reload succeeded
    std::string errorMessage;   ///< Error message if reload failed
};

// =============================================================================
// WatchEntry
// =============================================================================

struct WatchEntry {
    std::string path;                           ///< File path being watched
    std::type_index type = std::type_index(typeid(void));  ///< Resource type
    std::function<void(const std::string&)> reloadFn;  ///< Reload function
};

// =============================================================================
// HotReloadManager Class
// =============================================================================

/**
 * @brief Manages hot reloading of resources
 *
 * @details Integrates with FileSystem::watchFile to detect file changes
 *          and trigger resource reloading. Connect to signals to handle
 *          reload events.
 *
 * @code
 * HotReloadManager hrm;
 * hrm.init(true);  // Enable hot reload
 *
 * // Watch a shader
 * hrm.watch<Shader>(shaderHandle, "shaders/my.esshader", [&](auto& path) {
 *     // Reload logic
 * });
 *
 * // Handle reload events
 * hrm.onShaderReloaded.connect([](const ReloadEvent<Shader>& e) {
 *     if (e.success) {
 *         ES_LOG_INFO("Shader reloaded: {}", e.path);
 *     }
 * });
 *
 * // In main loop
 * hrm.update();  // Must be called each frame
 * @endcode
 */
class HotReloadManager {
public:
    HotReloadManager() = default;
    ~HotReloadManager();

    HotReloadManager(const HotReloadManager&) = delete;
    HotReloadManager& operator=(const HotReloadManager&) = delete;

    /**
     * @brief Initializes the hot reload manager
     * @param enabled Whether hot reload is enabled
     */
    void init(bool enabled = true);

    /**
     * @brief Shuts down and stops all file watching
     */
    void shutdown();

    /**
     * @brief Updates file watchers (call once per frame)
     */
    void update();

    /**
     * @brief Checks if hot reload is enabled
     * @return True if enabled
     */
    bool isEnabled() const { return enabled_; }

    /**
     * @brief Enables or disables hot reload
     * @param enabled Whether to enable
     */
    void setEnabled(bool enabled);

    /**
     * @brief Watches a resource for file changes
     * @tparam T Resource type
     * @param handle Resource handle
     * @param path File path to watch
     * @param reloadFn Function to call when file changes
     */
    template<typename T>
    void watch(Handle<T> handle, const std::string& path,
               std::function<void(const std::string&)> reloadFn);

    /**
     * @brief Stops watching a file
     * @param path File path to unwatch
     */
    void unwatch(const std::string& path);

    /**
     * @brief Checks if a file is being watched
     * @param path File path
     * @return True if being watched
     */
    bool isWatching(const std::string& path) const;

    /**
     * @brief Gets the number of watched files
     * @return Number of watched files
     */
    usize getWatchCount() const { return watchedFiles_.size(); }

    // =========================================================================
    // Reload Signals
    // =========================================================================

    Signal<void(const ReloadEvent<class Shader>&)> onShaderReloaded;
    Signal<void(const ReloadEvent<class Texture>&)> onTextureReloaded;
    Signal<void(const std::string&)> onAnyFileChanged;

private:
    void onFileChanged(const std::string& path);

    bool enabled_ = false;
    bool initialized_ = false;
    std::unordered_map<std::string, WatchEntry> watchedFiles_;
    std::unordered_set<std::string> pendingReloads_;
    mutable std::mutex mutex_;
};

// =============================================================================
// Template Implementation
// =============================================================================

template<typename T>
void HotReloadManager::watch(Handle<T> handle, const std::string& path,
                              std::function<void(const std::string&)> reloadFn) {
    if (!enabled_ || !initialized_) {
        return;
    }

    std::lock_guard<std::mutex> lock(mutex_);

    if (watchedFiles_.find(path) != watchedFiles_.end()) {
        return;
    }

    WatchEntry entry;
    entry.path = path;
    entry.type = std::type_index(typeid(T));
    entry.reloadFn = std::move(reloadFn);

    watchedFiles_[path] = std::move(entry);

    FileSystem::watchFile(path, [this](const std::string& changedPath) {
        onFileChanged(changedPath);
    });
}

}  // namespace esengine::resource
