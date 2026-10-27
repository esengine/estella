// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Log.hpp
 * @brief   Logging utilities for ESEngine
 * @details Provides a lightweight logging system with multiple severity levels,
 *          format string support, and convenience macros.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "Types.hpp"

// Standard library
#include <cstdlib>
#include <functional>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace esengine {

// =============================================================================
// Log Level
// =============================================================================

/**
 * @brief Logging severity levels
 *
 * @details Messages with a level below the current threshold are filtered out.
 *          Levels are ordered from most verbose (Trace) to most severe (Fatal).
 */
enum class LogLevel : u8 {
    Trace = 0,  ///< Detailed debugging information
    Debug = 1,  ///< Debug information
    Info = 2,   ///< General information
    Warn = 3,   ///< Warning messages
    Error = 4,  ///< Error messages
    Fatal = 5   ///< Fatal errors (application cannot continue)
};

struct LogEntry {
    LogLevel level;
    std::string message;
    u64 timestamp;
};

using LogSink = std::function<void(const LogEntry&)>;

// =============================================================================
// Log Class
// =============================================================================

/**
 * @brief Static logging interface
 *
 * @details Provides formatted logging with severity levels. Uses a simple
 *          `{}` placeholder syntax for formatting arguments.
 *
 * @code
 * Log::info("Player {} scored {} points", playerName, score);
 * Log::error("Failed to load: {}", filename);
 * @endcode
 *
 * @note For convenience, use the ES_LOG_* macros which provide the same
 *       functionality with automatic debug stripping.
 */
class Log {
public:
    /**
     * @brief Initializes the logging system
     */
    static void init();

    /**
     * @brief Shuts down the logging system
     */
    static void shutdown();

    /**
     * @brief Sets the minimum log level
     * @param level Messages below this level are filtered
     */
    static void setLevel(LogLevel level);

    /**
     * @brief Gets the current minimum log level
     * @return The current log level threshold
     */
    static LogLevel getLevel();

    /**
     * @brief Registers a log sink to receive log entries
     * @param sink Callback function to receive log entries
     * @return Sink ID for unregistration
     */
    static u32 addSink(LogSink sink);

    /**
     * @brief Unregisters a log sink
     * @param sinkId ID returned from addSink
     */
    static void removeSink(u32 sinkId);

    // =========================================================================
    // Logging Methods
    // =========================================================================

    /**
     * @brief Logs a trace message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void trace(const char* fmt, Args&&... args) {
        log(LogLevel::Trace, fmt, std::forward<Args>(args)...);
    }

    /**
     * @brief Logs a debug message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void debug(const char* fmt, Args&&... args) {
        log(LogLevel::Debug, fmt, std::forward<Args>(args)...);
    }

    /**
     * @brief Logs an info message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void info(const char* fmt, Args&&... args) {
        log(LogLevel::Info, fmt, std::forward<Args>(args)...);
    }

    /**
     * @brief Logs a warning message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void warn(const char* fmt, Args&&... args) {
        log(LogLevel::Warn, fmt, std::forward<Args>(args)...);
    }

    /**
     * @brief Logs an error message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void error(const char* fmt, Args&&... args) {
        log(LogLevel::Error, fmt, std::forward<Args>(args)...);
    }

    /**
     * @brief Logs a fatal error message
     * @tparam Args Format argument types
     * @param fmt Format string with {} placeholders
     * @param args Format arguments
     */
    template<typename... Args>
    static void fatal(const char* fmt, Args&&... args) {
        log(LogLevel::Fatal, fmt, std::forward<Args>(args)...);
    }

private:
    static LogLevel level_;
    static std::vector<std::pair<u32, LogSink>> sinks_;
    static u32 nextSinkId_;

    template<typename... Args>
    static void log(LogLevel level, const char* fmt, Args&&... args) {
        if (level < level_) return;

        std::string message;
        formatTo(message, fmt, std::forward<Args>(args)...);
        emit(level, message);
    }

    // Writes the line to stdout or stderr and hands it to the sinks. Not a template, and not a stream: a stream here pulled the whole of libc++'s
    // iostream and locale machinery into every build for the sake of printing a line.
    static void emit(LogLevel level, const std::string& message);
    static void notifySinks(LogLevel level, const std::string& message);
    static const char* levelToString(LogLevel level);

    // The value formatters, kept out of the template so each argument type costs a call and not a copy of the formatting.
    static void appendSigned(std::string& out, i64 value);
    static void appendUnsigned(std::string& out, u64 value);
    static void appendFloat(std::string& out, double value, int precision);
    static void appendPointer(std::string& out, const void* value);
    /// The digits of a "{:.Nf}" spec, or -1 when the spec asks for none. Never throws: a malformed spec is a plain value.
    static int precisionOf(const char* spec, const char* end);

    static void formatTo(std::string& out, const char* fmt) {
        out += fmt;
    }

    template<typename T, typename... Args>
    static void formatTo(std::string& out, const char* fmt, T&& value, Args&&... args) {
        while (*fmt) {
            if (*fmt == '{') {
                const char* start = fmt + 1;
                const char* end = start;
                while (*end && *end != '}') ++end;

                if (*end == '}') {
                    appendValue(out, value, precisionOf(start, end));
                    formatTo(out, end + 1, std::forward<Args>(args)...);
                    return;
                }
            }
            out.push_back(*fmt++);
        }
    }

    template<typename T>
    static void appendValue(std::string& out, const T& value, int precision) {
        using D = std::remove_cv_t<std::remove_reference_t<T>>;
        if constexpr (std::is_same_v<D, bool>) {
            out.push_back(value ? '1' : '0');
        } else if constexpr (std::is_same_v<D, char> || std::is_same_v<D, signed char> || std::is_same_v<D, unsigned char>) {
            out.push_back(static_cast<char>(value));
        } else if constexpr (std::is_enum_v<D>) {
            appendValue(out, static_cast<std::conditional_t<std::is_signed_v<std::underlying_type_t<D>>, i64, u64>>(value), precision);
        } else if constexpr (std::is_integral_v<D>) {
            if constexpr (std::is_signed_v<D>) appendSigned(out, static_cast<i64>(value));
            else appendUnsigned(out, static_cast<u64>(value));
        } else if constexpr (std::is_floating_point_v<D>) {
            appendFloat(out, static_cast<double>(value), precision);
        } else if constexpr (std::is_same_v<D, const char*> || std::is_same_v<D, char*>) {
            if (value) out += value;
        } else if constexpr (std::is_convertible_v<const D&, std::string_view>) {
            out += std::string_view(value);
        } else {
            static_assert(std::is_pointer_v<D>, "Log cannot format this argument type");
            appendPointer(out, static_cast<const void*>(value));
        }
    }
};

// =============================================================================
// Logging Macros
// =============================================================================

/**
 * @name Debug Logging Macros
 * @brief Macros that are stripped in release builds
 * @{
 */
#ifdef ES_DEBUG
    /** @brief Logs a trace message (debug builds only) */
    #define ES_LOG_TRACE(...) ::esengine::Log::trace(__VA_ARGS__)
    /** @brief Logs a debug message (debug builds only) */
    #define ES_LOG_DEBUG(...) ::esengine::Log::debug(__VA_ARGS__)
#else
    #define ES_LOG_TRACE(...) ((void)0)
    #define ES_LOG_DEBUG(...) ((void)0)
#endif
/** @} */

/**
 * @name Release Logging Macros
 * @brief Macros that are always active
 * @{
 */
/** @brief Logs an info message */
#define ES_LOG_INFO(...)  ::esengine::Log::info(__VA_ARGS__)
/** @brief Logs a warning message */
#define ES_LOG_WARN(...)  ::esengine::Log::warn(__VA_ARGS__)
/** @brief Logs an error message */
#define ES_LOG_ERROR(...) ::esengine::Log::error(__VA_ARGS__)
/** @brief Logs a fatal error message */
#define ES_LOG_FATAL(...) ::esengine::Log::fatal(__VA_ARGS__)
/** @} */

// =============================================================================
// Assert Macro
// =============================================================================

/**
 * @brief Assert macro (debug builds only)
 *
 * @details Checks a condition and aborts with a message if it fails.
 *          Stripped in release builds for performance.
 *
 * @param condition Boolean expression to test
 * @param message Error message if assertion fails
 *
 * @code
 * ES_ASSERT(ptr != nullptr, "Pointer must not be null");
 * ES_ASSERT(index < size, "Index out of bounds");
 * @endcode
 */
#ifdef ES_DEBUG
    #define ES_ASSERT(condition, message)                                           \
        do {                                                                        \
            if (!(condition)) {                                                     \
                ES_LOG_FATAL("Assertion failed: {} at {}:{}", message, __FILE__, __LINE__); \
                std::abort();                                                       \
            }                                                                       \
        } while (false)
#else
    #define ES_ASSERT(condition, message) ((void)0)
#endif

// =============================================================================
// Verify Macro (always-on boundary guard)
// =============================================================================

namespace detail {

/**
 * @brief Optional sink invoked whenever an ES_VERIFY condition fails.
 *
 * @details ES_VERIFY always logs + recovers (in both debug and release). This
 *          hook makes a failure *observable*: release-mode safety tests install
 *          a counter to assert "the guard fired and we degraded gracefully",
 *          and a dev build can install an aborting hook to fail loudly. Default
 *          is null (log + recover only). Not thread-safe to set — install once
 *          at startup or from a single-threaded test.
 */
using VerifyHook = void (*)(const char* cond, const char* file, int line);

inline VerifyHook& verifyHook() {
    static VerifyHook hook = nullptr;
    return hook;
}

}  // namespace detail

/**
 * @brief Always-on boundary guard — the release-safe counterpart to ES_ASSERT.
 *
 * @details Unlike ES_ASSERT, which is stripped in release builds (leaving
 *          boundary checks absent in shipped wasm), ES_VERIFY is compiled into
 *          *every* build. On failure it logs an error, fires the optional
 *          detail::verifyHook(), then runs the recovery statement(s) so the
 *          caller degrades gracefully instead of falling through into an OOB
 *          write / integer overflow / UB.
 *
 * @param cond  Boolean expression that must hold.
 * @param ...   Recovery statement(s) run on failure (e.g. `return`,
 *              `return fallback`, `continue`). Variadic so the recovery may
 *              itself contain commas (e.g. brace-enclosed multi-statements).
 *
 * @par Discipline
 * Use ES_VERIFY for any check that prevents OOB / overflow / UB on values
 * derived from runtime data or external input (entity handles, deserialized
 * indices, container subscripts). Reserve ES_ASSERT for pure-logic invariants
 * that cannot happen if the surrounding code is correct.
 *
 * @par Choosing between ES_VERIFY and ES_VERIFY_FATAL
 * ES_VERIFY needs a recovery that is TRUE — an existing element, a sentinel the
 * caller handles, a skipped iteration. Where the only "recovery" would be a
 * stand-in object the caller writes through, use ES_VERIFY_FATAL.
 *
 * @code
 * bool remove(u32 i) {
 *     ES_VERIFY(i < size_, return false);
 *     ...
 * }
 * @endcode
 */
#define ES_VERIFY(cond, ...)                                                    \
    do {                                                                        \
        if (!(cond)) [[unlikely]] {                                             \
            ES_LOG_ERROR("Verify failed: ({}) at {}:{}", #cond, __FILE__, __LINE__); \
            if (auto _es_vh = ::esengine::detail::verifyHook()) {              \
                _es_vh(#cond, __FILE__, __LINE__);                              \
            }                                                                   \
            __VA_ARGS__;                                                        \
        }                                                                       \
    } while (false)

/**
 * @brief Always-on **fatal** guard for invariants with no safe recovery.
 *
 * @details Use when a violated precondition leaves no valid value to return and
 *          continuing would be UB (e.g. returning `*nullptr` from a `T&`
 *          accessor). Unlike ES_ASSERT this is kept in release, so instead of a
 *          message-less SEGV the build aborts with a clear diagnostic. Prefer
 *          the recoverable ES_VERIFY whenever a sane fallback exists; reach for
 *          this only when there genuinely isn't one.
 *
 * @param cond    Boolean expression that must hold.
 * @param message Human-readable description of the invariant.
 */
#define ES_VERIFY_FATAL(cond, message)                                          \
    do {                                                                        \
        if (!(cond)) [[unlikely]] {                                             \
            ES_LOG_FATAL("Fatal: {} ({}) at {}:{}", message, #cond, __FILE__, __LINE__); \
            if (auto _es_vh = ::esengine::detail::verifyHook()) {              \
                _es_vh(#cond, __FILE__, __LINE__);                              \
            }                                                                   \
            std::abort();                                                       \
        }                                                                       \
    } while (false)

}  // namespace esengine
