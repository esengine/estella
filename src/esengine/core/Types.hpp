/**
 * @file    Types.hpp
 * @brief   Core type definitions and utilities for ESEngine
 * @details Provides standardized type aliases, smart pointer helpers,
 *          entity types, type ID generation, and a Result type for
 *          error handling.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Standard library
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace esengine {

// =============================================================================
// Integer Types
// =============================================================================

/** @brief Unsigned 8-bit integer */
using u8 = std::uint8_t;
/** @brief Unsigned 16-bit integer */
using u16 = std::uint16_t;
/** @brief Unsigned 32-bit integer */
using u32 = std::uint32_t;
/** @brief Unsigned 64-bit integer */
using u64 = std::uint64_t;

/** @brief Signed 8-bit integer */
using i8 = std::int8_t;
/** @brief Signed 16-bit integer */
using i16 = std::int16_t;
/** @brief Signed 32-bit integer */
using i32 = std::int32_t;
/** @brief Signed 64-bit integer */
using i64 = std::int64_t;

/** @brief 32-bit floating point */
using f32 = float;
/** @brief 64-bit floating point */
using f64 = double;

/** @brief Size type for indexing and sizes */
using usize = std::size_t;

// =============================================================================
// Smart Pointer Aliases
// =============================================================================

/**
 * @brief Unique ownership smart pointer
 * @tparam T The managed object type
 */
template<typename T>
using Unique = std::unique_ptr<T>;

/**
 * @brief Shared ownership smart pointer
 * @tparam T The managed object type
 */
template<typename T>
using Shared = std::shared_ptr<T>;

/**
 * @brief Weak reference smart pointer
 * @tparam T The managed object type
 */
template<typename T>
using Weak = std::weak_ptr<T>;

/**
 * @brief Creates a Unique pointer with the given arguments
 * @tparam T The type to construct
 * @tparam Args Constructor argument types
 * @param args Arguments forwarded to T's constructor
 * @return A Unique<T> owning the new object
 */
template<typename T, typename... Args>
constexpr Unique<T> makeUnique(Args&&... args) {
    return std::make_unique<T>(std::forward<Args>(args)...);
}

/**
 * @brief Creates a Shared pointer with the given arguments
 * @tparam T The type to construct
 * @tparam Args Constructor argument types
 * @param args Arguments forwarded to T's constructor
 * @return A Shared<T> owning the new object
 */
template<typename T, typename... Args>
constexpr Shared<T> makeShared(Args&&... args) {
    return std::make_shared<T>(std::forward<Args>(args)...);
}

// =============================================================================
// Entity Types (ECS Core)
// =============================================================================

/**
 * @brief Entity identifier type
 * @details Entities are simple integer IDs used as keys in the ECS system.
 *          Components are associated with entities via the Registry.
 */
using Entity = u32;

/**
 * @brief Invalid entity sentinel value
 * @details Used to represent null/invalid entity references
 */
constexpr Entity INVALID_ENTITY = std::numeric_limits<Entity>::max();

// =============================================================================
// Type ID System
// =============================================================================

/**
 * @brief Runtime type identifier
 * @details Used internally by the ECS to identify component types
 */
using TypeId = u32;

namespace detail {
    /**
     * @brief Generates sequential type IDs
     * @return The next available TypeId
     * @note Internal use only
     */
    inline TypeId nextTypeId() {
        static TypeId counter = 0;
        return counter++;
    }
}  // namespace detail

/**
 * @brief Gets the unique runtime TypeId for a type
 * @tparam T The type to get an ID for
 * @return The TypeId associated with type T
 *
 * @details Each unique type T receives a unique ID on first call.
 *          Subsequent calls return the same ID.
 *
 * @code
 * TypeId posId = getTypeId<Position>();
 * TypeId velId = getTypeId<Velocity>();
 * assert(posId != velId);
 * @endcode
 */
template<typename T>
inline TypeId getTypeId() {
    static const TypeId id = detail::nextTypeId();
    return id;
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * @brief Result type for operations that can fail
 *
 * @tparam T The success value type
 * @tparam E The error type (defaults to std::string)
 *
 * @details Provides a type-safe way to return either a success value
 *          or an error without using exceptions.
 *
 * @code
 * Result<int> divide(int a, int b) {
 *     if (b == 0) return Result<int>::err("Division by zero");
 *     return Result<int>::ok(a / b);
 * }
 *
 * auto result = divide(10, 2);
 * if (result.isOk()) {
 *     std::cout << result.value() << std::endl;
 * }
 * @endcode
 */
template<typename T, typename E = std::string>
class Result {
public:
    /**
     * @brief Creates a successful result
     * @param value The success value
     * @return Result containing the value
     */
    static Result ok(T value) { return Result(std::move(value), {}, true); }

    /**
     * @brief Creates an error result
     * @param error The error value
     * @return Result containing the error
     */
    static Result err(E error) { return Result({}, std::move(error), false); }

    /** @brief Returns true if the result is successful */
    bool isOk() const { return success_; }

    /** @brief Returns true if the result is an error */
    bool isErr() const { return !success_; }

    /** @brief Gets the success value (undefined if isErr()) */
    T& value() { return value_; }
    /** @brief Gets the success value (undefined if isErr()) */
    const T& value() const { return value_; }

    /** @brief Gets the error value (undefined if isOk()) */
    E& error() { return error_; }
    /** @brief Gets the error value (undefined if isOk()) */
    const E& error() const { return error_; }

private:
    Result(T value, E error, bool success)
        : value_(std::move(value)), error_(std::move(error)), success_(success) {}

    T value_;
    E error_;
    bool success_;
};

}  // namespace esengine
