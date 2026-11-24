// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Sink.hpp
 * @brief   Connection interface for signals
 * @details Provides a safe interface for connecting callbacks to signals.
 *          Returns RAII Connection handles that automatically disconnect
 *          when destroyed.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#pragma once

#include "Signal.hpp"

#include <type_traits>

namespace esengine {

/** Connect a function or a member to a signal. Connections follow the signal's listeners when the signal moves. */
template<class Ret, class... Args>
class Sink<Signal<Ret(Args...)>> {
public:
    using SignalType = Signal<Ret(Args...)>;
    using Callback = typename SignalType::Callback;

    explicit Sink(SignalType& signal) : listeners_(signal.listenersForSink()) {}

    [[nodiscard]] Connection connect(Callback callback) {
        auto listeners = listeners_.lock();
        if (!listeners) return {};
        const auto id = listeners->connect(std::move(callback));
        return Connection(id, [weak = listeners_](CallbackId key) {
            if (auto active = weak.lock()) active->disconnect(key);
        });
    }

    template<auto Func, class T>
    [[nodiscard]] Connection connect(T& instance) {
        return connect<Func>(&instance);
    }

    template<auto Func, class T>
    [[nodiscard]] Connection connect(T* instance) {
        return connect([instance](Args... args) -> Ret {
            if constexpr (std::is_void_v<Ret>) {
                (instance->*Func)(args...);
            } else {
                return (instance->*Func)(args...);
            }
        });
    }

private:
    Weak<typename SignalType::Listeners> listeners_;
};

template<class SignalType>
auto sink(SignalType& signal) {
    return Sink<SignalType>(signal);
}

}  // namespace esengine
