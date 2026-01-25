#pragma once

#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace esengine {

// Integer types
using u8 = std::uint8_t;
using u16 = std::uint16_t;
using u32 = std::uint32_t;
using u64 = std::uint64_t;

using i8 = std::int8_t;
using i16 = std::int16_t;
using i32 = std::int32_t;
using i64 = std::int64_t;

using f32 = float;
using f64 = double;

// Size type
using usize = std::size_t;

// Smart pointer aliases
template<typename T>
using Unique = std::unique_ptr<T>;

template<typename T>
using Shared = std::shared_ptr<T>;

template<typename T>
using Weak = std::weak_ptr<T>;

// Helper functions for creating smart pointers
template<typename T, typename... Args>
constexpr Unique<T> makeUnique(Args&&... args) {
    return std::make_unique<T>(std::forward<Args>(args)...);
}

template<typename T, typename... Args>
constexpr Shared<T> makeShared(Args&&... args) {
    return std::make_shared<T>(std::forward<Args>(args)...);
}

// Entity type (ECS core)
using Entity = u32;
constexpr Entity INVALID_ENTITY = std::numeric_limits<Entity>::max();

// Type ID generation
using TypeId = u32;

namespace detail {
    inline TypeId nextTypeId() {
        static TypeId counter = 0;
        return counter++;
    }
}  // namespace detail

template<typename T>
inline TypeId getTypeId() {
    static const TypeId id = detail::nextTypeId();
    return id;
}

// Result type for operations that can fail
template<typename T, typename E = std::string>
class Result {
public:
    static Result ok(T value) { return Result(std::move(value), {}, true); }
    static Result err(E error) { return Result({}, std::move(error), false); }

    bool isOk() const { return success_; }
    bool isErr() const { return !success_; }

    T& value() { return value_; }
    const T& value() const { return value_; }

    E& error() { return error_; }
    const E& error() const { return error_; }

private:
    Result(T value, E error, bool success)
        : value_(std::move(value)), error_(std::move(error)), success_(success) {}

    T value_;
    E error_;
    bool success_;
};

}  // namespace esengine
