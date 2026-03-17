/**
 * @file    Connection.hpp
 * @brief   RAII connection handle for event system
 * @details Manages the lifetime of signal connections. When destroyed,
 *          automatically disconnects from the signal to prevent dangling
 *          callbacks.
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

#include <functional>

namespace esengine {

// =============================================================================
// Type Definitions
// =============================================================================

using CallbackId = u64;
constexpr CallbackId INVALID_CALLBACK_ID = 0;

// =============================================================================
// Connection Class
// =============================================================================

/**
 * @brief RAII handle for signal connections
 *
 * @details Connection manages the lifetime of a callback registration.
 *          When the Connection object is destroyed, it automatically
 *          disconnects from the signal, preventing memory leaks and
 *          dangling callback issues.
 *
 * @note Connection is move-only to prevent accidental disconnection
 *       through copies.
 *
 * @code
 * auto conn = signal.connect([](int x) { ... });
 * // Connection is active
 * conn.disconnect();  // Or let conn go out of scope
 * @endcode
 */
class Connection {
public:
    using DisconnectFunc = std::function<void(CallbackId)>;

    /**
     * @brief Default constructor creates an empty connection
     */
    Connection() = default;

    /**
     * @brief Constructs a connection with disconnect callback
     * @param id The callback identifier
     * @param disconnectFunc Function to call when disconnecting
     */
    Connection(CallbackId id, DisconnectFunc disconnectFunc)
        : id_(id), disconnectFunc_(std::move(disconnectFunc)) {}

    /**
     * @brief Destructor automatically disconnects
     */
    ~Connection() {
        disconnect();
    }

    /**
     * @brief Move constructor transfers ownership
     * @param other Connection to move from
     */
    Connection(Connection&& other) noexcept
        : id_(other.id_), disconnectFunc_(std::move(other.disconnectFunc_)) {
        other.id_ = INVALID_CALLBACK_ID;
        other.disconnectFunc_ = nullptr;
    }

    /**
     * @brief Move assignment transfers ownership
     * @param other Connection to move from
     * @return Reference to this
     */
    Connection& operator=(Connection&& other) noexcept {
        if (this != &other) {
            disconnect();
            id_ = other.id_;
            disconnectFunc_ = std::move(other.disconnectFunc_);
            other.id_ = INVALID_CALLBACK_ID;
            other.disconnectFunc_ = nullptr;
        }
        return *this;
    }

    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    /**
     * @brief Manually disconnect from the signal
     */
    void disconnect() {
        if (isConnected() && disconnectFunc_) {
            disconnectFunc_(id_);
            id_ = INVALID_CALLBACK_ID;
            disconnectFunc_ = nullptr;
        }
    }

    /**
     * @brief Check if still connected
     * @return true if connected, false otherwise
     */
    [[nodiscard]] bool isConnected() const {
        return id_ != INVALID_CALLBACK_ID;
    }

    /**
     * @brief Get the callback ID
     * @return The callback identifier
     */
    [[nodiscard]] CallbackId getId() const {
        return id_;
    }

    /**
     * @brief Release ownership without disconnecting
     * @return The callback ID
     */
    CallbackId release() {
        CallbackId id = id_;
        id_ = INVALID_CALLBACK_ID;
        disconnectFunc_ = nullptr;
        return id;
    }

private:
    CallbackId id_ = INVALID_CALLBACK_ID;
    DisconnectFunc disconnectFunc_ = nullptr;
};

/**
 * @brief Scoped connection that auto-disconnects in a specific scope
 *
 * @details ScopedConnection is similar to Connection but provides
 *          explicit scope-based lifetime management.
 */
class ScopedConnection {
public:
    ScopedConnection() = default;

    explicit ScopedConnection(Connection&& conn)
        : connection_(std::move(conn)) {}

    ScopedConnection(ScopedConnection&&) noexcept = default;
    ScopedConnection& operator=(ScopedConnection&&) noexcept = default;

    ScopedConnection(const ScopedConnection&) = delete;
    ScopedConnection& operator=(const ScopedConnection&) = delete;

    [[nodiscard]] bool isConnected() const {
        return connection_.isConnected();
    }

    void disconnect() {
        connection_.disconnect();
    }

    Connection& get() {
        return connection_;
    }

private:
    Connection connection_;
};

/**
 * @brief Container for managing multiple connections
 *
 * @details ConnectionHolder manages a group of connections that should
 *          be disconnected together, typically when an object is destroyed.
 */
class ConnectionHolder {
public:
    ConnectionHolder() = default;
    ~ConnectionHolder() = default;

    ConnectionHolder(ConnectionHolder&&) noexcept = default;
    ConnectionHolder& operator=(ConnectionHolder&&) noexcept = default;

    ConnectionHolder(const ConnectionHolder&) = delete;
    ConnectionHolder& operator=(const ConnectionHolder&) = delete;

    /**
     * @brief Add a connection to manage
     * @param conn Connection to add
     */
    void add(Connection&& conn) {
        connections_.push_back(std::move(conn));
    }

    /**
     * @brief Disconnect all managed connections
     */
    void disconnectAll() {
        connections_.clear();
    }

    /**
     * @brief Get the number of active connections
     * @return Number of connections
     */
    [[nodiscard]] usize size() const {
        return connections_.size();
    }

    /**
     * @brief Check if there are any connections
     * @return true if empty
     */
    [[nodiscard]] bool empty() const {
        return connections_.empty();
    }

private:
    std::vector<Connection> connections_;
};

}  // namespace esengine
