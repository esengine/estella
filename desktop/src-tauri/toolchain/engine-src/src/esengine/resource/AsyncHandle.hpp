/**
 * @file    AsyncHandle.hpp
 * @brief   Asynchronous resource handle
 * @details Tracks the loading state of an async resource request and provides
 *          access to the loaded resource once complete.
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
#include "Handle.hpp"

#include <functional>
#include <atomic>
#include <mutex>
#include <vector>

namespace esengine::resource {

// =============================================================================
// Load State
// =============================================================================

enum class LoadState : u8 {
    NotStarted,   ///< Loading has not begun
    Loading,      ///< Resource is being loaded
    Ready,        ///< Resource loaded successfully
    Failed        ///< Loading failed
};

// =============================================================================
// AsyncHandle Class
// =============================================================================

/**
 * @brief Handle for tracking async resource loading
 *
 * @details Wraps a Handle<T> with loading state tracking and completion
 *          callbacks. Use with ResourceManager::loadAsync<T>().
 *
 * @tparam T The resource type being loaded
 *
 * @code
 * auto asyncTex = rm.loadAsync<Texture>("large_texture.png");
 *
 * asyncTex.onComplete([](TextureHandle h, bool success) {
 *     if (success) {
 *         // Use the texture
 *     }
 * });
 *
 * // Later in update loop
 * if (asyncTex.isReady()) {
 *     TextureHandle handle = asyncTex.handle();
 * }
 * @endcode
 */
template<typename T>
class AsyncHandle {
public:
    AsyncHandle() = default;

    /**
     * @brief Constructs an AsyncHandle with a job ID
     * @param jobId The job ID from LoaderJobQueue
     */
    explicit AsyncHandle(u64 jobId) : jobId_(jobId), state_(LoadState::Loading) {}

    /** @brief Gets the underlying resource handle (valid only when ready) */
    Handle<T> handle() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return handle_;
    }

    /** @brief Gets the current loading state */
    LoadState state() const { return state_.load(); }

    /** @brief Checks if the resource is ready to use */
    bool isReady() const { return state_.load() == LoadState::Ready; }

    /** @brief Checks if the resource is currently loading */
    bool isLoading() const { return state_.load() == LoadState::Loading; }

    /** @brief Checks if loading failed */
    bool isFailed() const { return state_.load() == LoadState::Failed; }

    /** @brief Gets the job ID for this async operation */
    u64 jobId() const { return jobId_; }

    /** @brief Gets the error message if loading failed */
    const std::string& errorMessage() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return errorMessage_;
    }

    /**
     * @brief Registers a completion callback
     * @param callback Function called when loading completes (handle, success)
     */
    void onComplete(std::function<void(Handle<T>, bool)> callback) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (state_.load() == LoadState::Ready || state_.load() == LoadState::Failed) {
            callback(handle_, state_.load() == LoadState::Ready);
        } else {
            callbacks_.push_back(std::move(callback));
        }
    }

    /**
     * @brief Sets the result (called internally by ResourceManager)
     * @param h The loaded handle
     * @param success Whether loading succeeded
     * @param error Error message if failed
     */
    void setResult(Handle<T> h, bool success, const std::string& error = "") {
        std::vector<std::function<void(Handle<T>, bool)>> callbacksCopy;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            handle_ = h;
            errorMessage_ = error;
            state_.store(success ? LoadState::Ready : LoadState::Failed);
            callbacksCopy = std::move(callbacks_);
        }

        for (auto& cb : callbacksCopy) {
            cb(h, success);
        }
    }

    /** @brief Explicit bool conversion (true if ready with valid handle) */
    explicit operator bool() const {
        return isReady() && handle().isValid();
    }

private:
    u64 jobId_ = 0;
    std::atomic<LoadState> state_{LoadState::NotStarted};
    mutable std::mutex mutex_;
    Handle<T> handle_;
    std::string errorMessage_;
    std::vector<std::function<void(Handle<T>, bool)>> callbacks_;
};

// =============================================================================
// Type Aliases
// =============================================================================

class Shader;
class Texture;

using AsyncShaderHandle = AsyncHandle<Shader>;
using AsyncTextureHandle = AsyncHandle<Texture>;

}  // namespace esengine::resource
