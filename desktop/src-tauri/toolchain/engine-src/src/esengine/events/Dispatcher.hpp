/**
 * @file    Dispatcher.hpp
 * @brief   Central event dispatcher using type-indexed signals
 * @details Provides a type-safe event bus that routes events to
 *          registered handlers based on event type. Supports both
 *          immediate triggering and queued event processing.
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
#include "Sink.hpp"
#include "../core/Types.hpp"

#include <functional>
#include <memory>
#include <queue>
#include <unordered_map>

namespace esengine {

// =============================================================================
// Dispatcher Class
// =============================================================================

/**
 * @brief Central event dispatcher for the application
 *
 * @details Dispatcher manages signals for different event types and provides
 *          a unified interface for event subscription and publication.
 *          Events are identified by their C++ type, providing compile-time
 *          type safety.
 *
 * @code
 * struct PlayerDied { Entity player; };
 * struct ScoreChanged { int newScore; };
 *
 * Dispatcher dispatcher;
 *
 * // Subscribe
 * auto conn = dispatcher.sink<PlayerDied>().connect(
 *     [](const PlayerDied& e) { handlePlayerDeath(e); });
 *
 * // Trigger immediately
 * dispatcher.trigger(PlayerDied{playerEntity});
 *
 * // Queue for later
 * dispatcher.enqueue(ScoreChanged{100});
 * dispatcher.update();
 * @endcode
 */
class Dispatcher {
public:
    Dispatcher() = default;
    ~Dispatcher() = default;

    Dispatcher(Dispatcher&&) = default;
    Dispatcher& operator=(Dispatcher&&) = default;

    Dispatcher(const Dispatcher&) = delete;
    Dispatcher& operator=(const Dispatcher&) = delete;

    /**
     * @brief Get a sink for subscribing to an event type
     *
     * @tparam Event The event type to subscribe to
     * @return Sink for connecting callbacks
     *
     * @code
     * auto conn = dispatcher.sink<MyEvent>().connect(handler);
     * @endcode
     */
    template<typename Event>
    auto sink() -> Sink<Signal<void(const Event&)>> {
        return Sink<Signal<void(const Event&)>>(assure<Event>());
    }

    /**
     * @brief Trigger an event immediately
     *
     * @tparam Event The event type
     * @param event The event to trigger
     *
     * @details All registered handlers are called synchronously
     *          in the order they were registered.
     */
    template<typename Event>
    void trigger(const Event& event) {
        auto* signal = find<Event>();
        if (signal) {
            signal->publish(event);
        }
    }

    /**
     * @brief Trigger an event constructed in-place
     *
     * @tparam Event The event type
     * @tparam Args Constructor argument types
     * @param args Arguments to construct the event
     */
    template<typename Event, typename... Args>
    void trigger(Args&&... args) {
        trigger(Event{std::forward<Args>(args)...});
    }

    /**
     * @brief Queue an event for later processing
     *
     * @tparam Event The event type
     * @param event The event to queue
     *
     * @details Events are processed when update() is called.
     */
    template<typename Event>
    void enqueue(const Event& event) {
        auto* signal = &assure<Event>();
        eventQueue_.push({[signal, event]() {
            signal->publish(event);
        }});
    }

    /**
     * @brief Queue an event constructed in-place
     *
     * @tparam Event The event type
     * @tparam Args Constructor argument types
     * @param args Arguments to construct the event
     */
    template<typename Event, typename... Args>
    void enqueue(Args&&... args) {
        enqueue(Event{std::forward<Args>(args)...});
    }

    /**
     * @brief Process all queued events
     *
     * @details Call this once per frame to process queued events.
     *          Events are processed in FIFO order.
     */
    void update() {
        while (!eventQueue_.empty()) {
            eventQueue_.front().dispatch();
            eventQueue_.pop();
        }
    }

    /**
     * @brief Clear all queued events without processing
     */
    void clearQueue() {
        std::queue<QueuedEvent> empty;
        std::swap(eventQueue_, empty);
    }

    /**
     * @brief Check if there are queued events
     * @return true if the queue is not empty
     */
    [[nodiscard]] bool hasQueuedEvents() const {
        return !eventQueue_.empty();
    }

    /**
     * @brief Get the number of queued events
     * @return Number of events in queue
     */
    [[nodiscard]] usize queueSize() const {
        return eventQueue_.size();
    }

    /**
     * @brief Clear all signals and handlers
     */
    void clear() {
        signals_.clear();
        clearQueue();
    }

    /**
     * @brief Check if there are subscribers for an event type
     *
     * @tparam Event The event type
     * @return true if there are subscribers
     */
    template<typename Event>
    [[nodiscard]] bool hasSubscribers() const {
        auto* signal = find<Event>();
        return signal && !signal->empty();
    }

    /**
     * @brief Get the number of subscribers for an event type
     *
     * @tparam Event The event type
     * @return Number of subscribers
     */
    template<typename Event>
    [[nodiscard]] usize subscriberCount() const {
        auto* signal = find<Event>();
        return signal ? signal->size() : 0;
    }

private:
    struct QueuedEvent {
        std::function<void()> dispatch;
    };

    struct SignalWrapperBase {
        virtual ~SignalWrapperBase() = default;
    };

    template<typename Event>
    struct SignalWrapperTyped : SignalWrapperBase {
        Signal<void(const Event&)> signal;
    };

    template<typename Event>
    Signal<void(const Event&)>& assure() {
        auto typeId = getTypeId<Event>();
        auto it = signals_.find(typeId);

        if (it == signals_.end()) {
            auto wrapper = makeUnique<SignalWrapperTyped<Event>>();
            auto* ptr = &wrapper->signal;
            signals_.emplace(typeId, std::move(wrapper));
            return *ptr;
        }

        return static_cast<SignalWrapperTyped<Event>*>(it->second.get())->signal;
    }

    template<typename Event>
    Signal<void(const Event&)>* find() {
        auto typeId = getTypeId<Event>();
        auto it = signals_.find(typeId);
        if (it != signals_.end()) {
            return &static_cast<SignalWrapperTyped<Event>*>(it->second.get())->signal;
        }
        return nullptr;
    }

    template<typename Event>
    const Signal<void(const Event&)>* find() const {
        auto typeId = getTypeId<Event>();
        auto it = signals_.find(typeId);
        if (it != signals_.end()) {
            return &static_cast<const SignalWrapperTyped<Event>*>(it->second.get())->signal;
        }
        return nullptr;
    }

    std::unordered_map<TypeId, Unique<SignalWrapperBase>> signals_;
    std::queue<QueuedEvent> eventQueue_;
};

}  // namespace esengine
