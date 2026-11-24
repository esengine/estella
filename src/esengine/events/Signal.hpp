// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the Apache License, Version 2.0.
 */

#pragma once

#include "Connection.hpp"

#include <algorithm>
#include <functional>
#include <optional>
#include <unordered_map>
#include <utility>
#include <vector>

namespace esengine {

template<class Signature> class Signal;
template<class SignalType> class Sink;

namespace detail {

/** Stable callback storage shared by a signal and its in-progress dispatches. Sinks and connections hold weak references. */
template<class Callback>
class SignalListeners {
public:
    CallbackId connect(Callback callback) {
        const auto id = nextId_++;
        if (depth_) pendingAdds_.emplace_back(id, std::move(callback));
        else callbacks_.emplace(id, std::move(callback));
        return id;
    }

    void disconnect(CallbackId id) {
        if (depth_) pendingRemoves_.push_back(id);
        else callbacks_.extract(id);
    }

    usize size() const { return callbacks_.size(); }

    /** Return false from visit to finish a query early. Nested publishes see the same committed listeners. */
    template<class Visitor>
    void forEach(Visitor&& visit) {
        Dispatch dispatch(*this);
        for (const auto& [id, callback] : callbacks_) {
            const bool disconnected = std::find(pendingRemoves_.begin(), pendingRemoves_.end(), id) != pendingRemoves_.end();
            if (!callback || disconnected) continue;
            if (!visit(callback)) break;
        }
    }

private:
    struct Dispatch {
        SignalListeners& listeners;
        explicit Dispatch(SignalListeners& source) : listeners(source) { ++listeners.depth_; }
        ~Dispatch() {
            if (--listeners.depth_ == 0) listeners.commit();
        }
    };

    void commit() {
        // A listener registered and disconnected in one dispatch must be gone when it returns.
        for (auto& [id, callback] : pendingAdds_) callbacks_.emplace(id, std::move(callback));
        pendingAdds_.clear();
        // Destroy each detached callback after updating the queue and the map.
        // Captured objects can themselves disconnect a listener or publish.
        while (!pendingRemoves_.empty()) {
            const auto id = pendingRemoves_.back();
            pendingRemoves_.pop_back();
            callbacks_.extract(id);
        }
    }

    std::unordered_map<CallbackId, Callback> callbacks_;
    std::vector<std::pair<CallbackId, Callback>> pendingAdds_;
    std::vector<CallbackId> pendingRemoves_;
    CallbackId nextId_ = 1;
    usize depth_ = 0;
};

template<class Signature>
class SignalStorage {
public:
    using Callback = std::function<Signature>;

    SignalStorage() = default;
    SignalStorage(const SignalStorage&) = delete;
    SignalStorage& operator=(const SignalStorage&) = delete;
    SignalStorage(SignalStorage&&) noexcept = default;
    SignalStorage& operator=(SignalStorage&&) noexcept = default;

    [[nodiscard]] usize size() const { return listeners_ ? listeners_->size() : 0; }
    [[nodiscard]] bool empty() const { return size() == 0; }

protected:
    template<class Visitor>
    void visit(Visitor&& visitor) {
        // The publishing callback can move or release the signal.
        if (auto listeners = listeners_) listeners->forEach(std::forward<Visitor>(visitor));
    }

private:
    friend class esengine::Sink<Signal<Signature>>;
    using Listeners = SignalListeners<Callback>;

    const Shared<Listeners>& listenersForSink() {
        if (!listeners_) listeners_ = makeShared<Listeners>();
        return listeners_;
    }
    Shared<Listeners> listeners_;
};

}  // namespace detail

/** Publish a notification to every connected callback. */
template<class... Args>
class Signal<void(Args...)> : public detail::SignalStorage<void(Args...)> {
public:
    /** Stop dispatch if a callback invalidates the event being delivered. */
    template<class Predicate>
    void publishWhile(Predicate stillCurrent, Args... args) {
        this->visit([&](const auto& callback) {
            callback(args...);
            return stillCurrent();
        });
    }

    void publish(Args... args) {
        this->visit([&](const auto& callback) {
            callback(args...);
            return true;
        });
    }
};

/** Collect query results or stop at the first non-default answer. */
template<class Ret, class... Args>
class Signal<Ret(Args...)> : public detail::SignalStorage<Ret(Args...)> {
public:
    std::vector<Ret> publish(Args... args) {
        std::vector<Ret> results;
        results.reserve(this->size());
        this->visit([&](const auto& callback) {
            results.push_back(callback(args...));
            return true;
        });
        return results;
    }

    Ret publishFirst(Ret defaultValue, Args... args) {
        std::optional<Ret> first;
        this->visit([&](const auto& callback) {
            Ret result = callback(args...);
            if (result != defaultValue) {
                first.emplace(std::move(result));
                return false;
            }
            return true;
        });
        return first ? std::move(*first) : std::move(defaultValue);
    }
};

}  // namespace esengine
