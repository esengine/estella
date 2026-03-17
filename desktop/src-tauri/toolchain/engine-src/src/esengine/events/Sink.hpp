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
 *            Licensed under the MIT License.
 */

#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "Connection.hpp"
#include "Signal.hpp"

#include <type_traits>

namespace esengine {

// =============================================================================
// Sink Class for void(Args...)
// =============================================================================

/**
 * @brief Connection interface for Signal<void(Args...)>
 *
 * @details Sink provides a safe way to connect callbacks to signals.
 *          All connect methods return Connection objects that manage
 *          the callback lifetime.
 *
 * @tparam Args The signal's argument types
 *
 * @code
 * Signal<void(int)> signal;
 * Sink sink(signal);
 *
 * // Lambda
 * auto conn1 = sink.connect([](int x) { ... });
 *
 * // Member function
 * auto conn2 = sink.connect<&MyClass::onEvent>(instance);
 * @endcode
 */
template<typename... Args>
class Sink<Signal<void(Args...)>> {
public:
    using SignalType = Signal<void(Args...)>;
    using Callback = typename SignalType::Callback;

    /**
     * @brief Construct a sink for the given signal
     * @param signal The signal to connect to
     */
    explicit Sink(SignalType& signal) : signal_(&signal) {}

    /**
     * @brief Connect a callback function
     * @param callback The callback to connect
     * @return RAII Connection handle
     */
    [[nodiscard]] Connection connect(Callback callback) {
        CallbackId id = signal_->connect(std::move(callback));
        return Connection(id, [signal = signal_](CallbackId callbackId) {
            signal->disconnect(callbackId);
        });
    }

    /**
     * @brief Connect a member function
     *
     * @tparam Func Pointer to member function
     * @tparam T Instance type
     * @param instance The object instance
     * @return RAII Connection handle
     *
     * @code
     * sink.connect<&MyClass::onEvent>(myInstance);
     * @endcode
     */
    template<auto Func, typename T>
    [[nodiscard]] Connection connect(T& instance) {
        return connect([&instance](Args... args) {
            (instance.*Func)(args...);
        });
    }

    /**
     * @brief Connect a member function with pointer
     *
     * @tparam Func Pointer to member function
     * @tparam T Instance type
     * @param instance Pointer to the object
     * @return RAII Connection handle
     */
    template<auto Func, typename T>
    [[nodiscard]] Connection connect(T* instance) {
        return connect([instance](Args... args) {
            (instance->*Func)(args...);
        });
    }

private:
    SignalType* signal_;
};

// =============================================================================
// Sink Class for Ret(Args...)
// =============================================================================

/**
 * @brief Connection interface for Signal<Ret(Args...)>
 *
 * @tparam Ret The return type
 * @tparam Args The argument types
 */
template<typename Ret, typename... Args>
class Sink<Signal<Ret(Args...)>> {
public:
    using SignalType = Signal<Ret(Args...)>;
    using Callback = typename SignalType::Callback;

    explicit Sink(SignalType& signal) : signal_(&signal) {}

    [[nodiscard]] Connection connect(Callback callback) {
        CallbackId id = signal_->connect(std::move(callback));
        return Connection(id, [signal = signal_](CallbackId callbackId) {
            signal->disconnect(callbackId);
        });
    }

    template<auto Func, typename T>
    [[nodiscard]] Connection connect(T& instance) {
        return connect([&instance](Args... args) -> Ret {
            return (instance.*Func)(args...);
        });
    }

    template<auto Func, typename T>
    [[nodiscard]] Connection connect(T* instance) {
        return connect([instance](Args... args) -> Ret {
            return (instance->*Func)(args...);
        });
    }

private:
    SignalType* signal_;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * @brief Create a sink for a signal
 * @param signal The signal to create a sink for
 * @return Sink object
 */
template<typename SignalType>
auto sink(SignalType& signal) {
    return Sink<SignalType>(signal);
}

}  // namespace esengine
