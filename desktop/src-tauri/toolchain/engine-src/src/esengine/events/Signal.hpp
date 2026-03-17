/**
 * @file    Signal.hpp
 * @brief   Type-safe signal implementation for event system
 * @details Provides a publish-subscribe mechanism with type safety at
 *          compile time. Signals can have multiple subscribers and
 *          support both free functions and member functions.
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

#include "Connection.hpp"
#include "../core/Types.hpp"

#include <functional>
#include <unordered_map>
#include <vector>
#include <algorithm>

namespace esengine {

// Forward declaration
template<typename Signature>
class Signal;

template<typename Signature>
class Sink;

// =============================================================================
// Signal Class (void return)
// =============================================================================

/**
 * @brief Type-safe signal for event publishing
 *
 * @details Signal<void(Args...)> allows publishing events to multiple
 *          subscribers. Connections are managed through the Sink interface
 *          which returns RAII Connection handles.
 *
 * @tparam Args The argument types for the callback
 *
 * @code
 * Signal<void(int, float)> signal;
 * auto conn = Sink(signal).connect([](int a, float b) {
 *     // Handle event
 * });
 * signal.publish(42, 3.14f);
 * @endcode
 */
template<typename... Args>
class Signal<void(Args...)> {
public:
    using Callback = std::function<void(Args...)>;

    Signal() = default;
    ~Signal() = default;

    Signal(Signal&&) noexcept = default;
    Signal& operator=(Signal&&) noexcept = default;

    Signal(const Signal&) = delete;
    Signal& operator=(const Signal&) = delete;

    /**
     * @brief Publish an event to all subscribers
     * @param args Arguments to pass to callbacks
     */
    void publish(Args... args) {
        if (publishing_) {
            for (const auto& [id, callback] : callbacks_) {
                if (callback) {
                    callback(args...);
                }
            }
        } else {
            publishing_ = true;
            for (const auto& [id, callback] : callbacks_) {
                if (callback) {
                    callback(args...);
                }
            }
            publishing_ = false;
            processPendingOperations();
        }
    }

    /**
     * @brief Get the number of active subscribers
     * @return Number of subscribers
     */
    [[nodiscard]] usize size() const {
        return callbacks_.size();
    }

    /**
     * @brief Check if there are any subscribers
     * @return true if no subscribers
     */
    [[nodiscard]] bool empty() const {
        return callbacks_.empty();
    }

private:
    friend class Sink<Signal<void(Args...)>>;

    /**
     * @brief Connect a callback (called by Sink)
     * @param callback The callback to connect
     * @return Callback ID for disconnection
     */
    CallbackId connect(Callback callback) {
        CallbackId id = nextId_++;
        if (publishing_) {
            pendingAdds_.emplace_back(id, std::move(callback));
        } else {
            callbacks_.emplace(id, std::move(callback));
        }
        return id;
    }

    /**
     * @brief Disconnect a callback (called by Connection)
     * @param id The callback ID to disconnect
     */
    void disconnect(CallbackId id) {
        if (publishing_) {
            pendingRemoves_.push_back(id);
        } else {
            callbacks_.erase(id);
        }
    }

    /**
     * @brief Process pending add/remove operations after publishing
     */
    void processPendingOperations() {
        for (auto id : pendingRemoves_) {
            callbacks_.erase(id);
        }
        pendingRemoves_.clear();

        for (auto& [id, callback] : pendingAdds_) {
            callbacks_.emplace(id, std::move(callback));
        }
        pendingAdds_.clear();
    }

    std::unordered_map<CallbackId, Callback> callbacks_;
    std::vector<std::pair<CallbackId, Callback>> pendingAdds_;
    std::vector<CallbackId> pendingRemoves_;
    CallbackId nextId_ = 1;
    bool publishing_ = false;
};

/**
 * @brief Specialization for signals with return values
 *
 * @details This specialization collects return values from all callbacks.
 *          Useful for query-style events where multiple handlers can
 *          contribute results.
 *
 * @tparam Ret The return type
 * @tparam Args The argument types
 */
template<typename Ret, typename... Args>
class Signal<Ret(Args...)> {
public:
    using Callback = std::function<Ret(Args...)>;

    Signal() = default;
    ~Signal() = default;

    Signal(Signal&&) noexcept = default;
    Signal& operator=(Signal&&) noexcept = default;

    Signal(const Signal&) = delete;
    Signal& operator=(const Signal&) = delete;

    /**
     * @brief Publish an event and collect results
     * @param args Arguments to pass to callbacks
     * @return Vector of results from all callbacks
     */
    std::vector<Ret> publish(Args... args) {
        std::vector<Ret> results;
        results.reserve(callbacks_.size());

        publishing_ = true;
        for (const auto& [id, callback] : callbacks_) {
            if (callback) {
                results.push_back(callback(args...));
            }
        }
        publishing_ = false;
        processPendingOperations();

        return results;
    }

    /**
     * @brief Publish and return first non-default result
     * @param defaultValue Value to return if no results
     * @param args Arguments to pass to callbacks
     * @return First result or default
     */
    Ret publishFirst(Ret defaultValue, Args... args) {
        publishing_ = true;
        for (const auto& [id, callback] : callbacks_) {
            if (callback) {
                Ret result = callback(args...);
                if (result != defaultValue) {
                    publishing_ = false;
                    processPendingOperations();
                    return result;
                }
            }
        }
        publishing_ = false;
        processPendingOperations();
        return defaultValue;
    }

    [[nodiscard]] usize size() const {
        return callbacks_.size();
    }

    [[nodiscard]] bool empty() const {
        return callbacks_.empty();
    }

private:
    friend class Sink<Signal<Ret(Args...)>>;

    CallbackId connect(Callback callback) {
        CallbackId id = nextId_++;
        if (publishing_) {
            pendingAdds_.emplace_back(id, std::move(callback));
        } else {
            callbacks_.emplace(id, std::move(callback));
        }
        return id;
    }

    void disconnect(CallbackId id) {
        if (publishing_) {
            pendingRemoves_.push_back(id);
        } else {
            callbacks_.erase(id);
        }
    }

    void processPendingOperations() {
        for (auto id : pendingRemoves_) {
            callbacks_.erase(id);
        }
        pendingRemoves_.clear();

        for (auto& [id, callback] : pendingAdds_) {
            callbacks_.emplace(id, std::move(callback));
        }
        pendingAdds_.clear();
    }

    std::unordered_map<CallbackId, Callback> callbacks_;
    std::vector<std::pair<CallbackId, Callback>> pendingAdds_;
    std::vector<CallbackId> pendingRemoves_;
    CallbackId nextId_ = 1;
    bool publishing_ = false;
};

}  // namespace esengine
