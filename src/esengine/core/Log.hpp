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
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "Types.hpp"

// Standard library
#include <iostream>
#include <sstream>
#include <string>

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

    template<typename... Args>
    static void log(LogLevel level, const char* fmt, Args&&... args) {
        if (level < level_) return;

        std::ostringstream oss;
        oss << "[" << levelToString(level) << "] ";
        formatTo(oss, fmt, std::forward<Args>(args)...);
        oss << "\n";

        if (level >= LogLevel::Error) {
            std::cerr << oss.str();
        } else {
            std::cout << oss.str();
        }
    }

    static const char* levelToString(LogLevel level);

    // Simple format implementation with {} placeholders
    static void formatTo(std::ostringstream& oss, const char* fmt) {
        oss << fmt;
    }

    template<typename T, typename... Args>
    static void formatTo(std::ostringstream& oss, const char* fmt, T&& value, Args&&... args) {
        while (*fmt) {
            if (*fmt == '{' && *(fmt + 1) == '}') {
                oss << std::forward<T>(value);
                formatTo(oss, fmt + 2, std::forward<Args>(args)...);
                return;
            }
            oss << *fmt++;
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

}  // namespace esengine
