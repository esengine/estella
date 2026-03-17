/**
 * @file    HotReloadManager.cpp
 * @brief   Hot reload manager implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "HotReloadManager.hpp"
#include "../core/Log.hpp"
#include "../core/RuntimeConfig.hpp"

namespace esengine::resource {

// =============================================================================
// Lifecycle
// =============================================================================

HotReloadManager::~HotReloadManager() {
    if (initialized_) {
        shutdown();
    }
}

void HotReloadManager::init(bool enabled) {
    if (initialized_) {
        ES_LOG_WARN("HotReloadManager already initialized");
        return;
    }

    enabled_ = enabled && RuntimeConfig::get().isEditorMode();
    initialized_ = true;

    if (enabled_) {
        ES_LOG_INFO("HotReloadManager initialized (hot reload enabled)");
    } else {
        ES_LOG_INFO("HotReloadManager initialized (hot reload disabled)");
    }
}

void HotReloadManager::shutdown() {
    if (!initialized_) {
        return;
    }

    std::lock_guard<std::mutex> lock(mutex_);

    for (const auto& [path, entry] : watchedFiles_) {
        FileSystem::unwatchFile(path);
    }
    watchedFiles_.clear();
    pendingReloads_.clear();

    initialized_ = false;
    ES_LOG_INFO("HotReloadManager shutdown complete");
}

void HotReloadManager::update() {
    if (!enabled_ || !initialized_) {
        return;
    }

    std::unordered_set<std::string> reloadsToProcess;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        reloadsToProcess = std::move(pendingReloads_);
        pendingReloads_.clear();
    }

    for (const auto& path : reloadsToProcess) {
        WatchEntry entry;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto it = watchedFiles_.find(path);
            if (it == watchedFiles_.end()) {
                continue;
            }
            entry = it->second;
        }

        ES_LOG_INFO("HotReloadManager: Reloading '{}'", path);

        onAnyFileChanged.publish(path);

        if (entry.reloadFn) {
            try {
                entry.reloadFn(path);
            } catch (const std::exception& e) {
                ES_LOG_ERROR("HotReloadManager: Reload failed for '{}': {}", path, e.what());
            }
        }
    }
}

void HotReloadManager::setEnabled(bool enabled) {
    if (enabled_ == enabled) {
        return;
    }

    enabled_ = enabled;

    if (!enabled) {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& [path, entry] : watchedFiles_) {
            FileSystem::unwatchFile(path);
        }
        watchedFiles_.clear();
    }

    ES_LOG_INFO("HotReloadManager: Hot reload {}", enabled ? "enabled" : "disabled");
}

void HotReloadManager::unwatch(const std::string& path) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = watchedFiles_.find(path);
    if (it == watchedFiles_.end()) {
        return;
    }

    FileSystem::unwatchFile(path);
    watchedFiles_.erase(it);
}

bool HotReloadManager::isWatching(const std::string& path) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return watchedFiles_.find(path) != watchedFiles_.end();
}

void HotReloadManager::onFileChanged(const std::string& path) {
    std::lock_guard<std::mutex> lock(mutex_);
    pendingReloads_.insert(path);
}

}  // namespace esengine::resource
