#pragma once

#include "Types.hpp"
#include <iostream>
#include <sstream>
#include <string>

namespace esengine {

enum class LogLevel : u8 {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
    Fatal = 5
};

class Log {
public:
    static void init();
    static void shutdown();

    static void setLevel(LogLevel level);
    static LogLevel getLevel();

    template<typename... Args>
    static void trace(const char* fmt, Args&&... args) {
        log(LogLevel::Trace, fmt, std::forward<Args>(args)...);
    }

    template<typename... Args>
    static void debug(const char* fmt, Args&&... args) {
        log(LogLevel::Debug, fmt, std::forward<Args>(args)...);
    }

    template<typename... Args>
    static void info(const char* fmt, Args&&... args) {
        log(LogLevel::Info, fmt, std::forward<Args>(args)...);
    }

    template<typename... Args>
    static void warn(const char* fmt, Args&&... args) {
        log(LogLevel::Warn, fmt, std::forward<Args>(args)...);
    }

    template<typename... Args>
    static void error(const char* fmt, Args&&... args) {
        log(LogLevel::Error, fmt, std::forward<Args>(args)...);
    }

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

    // Simple format implementation
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

// Convenience macros
#ifdef ES_DEBUG
    #define ES_LOG_TRACE(...) ::esengine::Log::trace(__VA_ARGS__)
    #define ES_LOG_DEBUG(...) ::esengine::Log::debug(__VA_ARGS__)
#else
    #define ES_LOG_TRACE(...) ((void)0)
    #define ES_LOG_DEBUG(...) ((void)0)
#endif

#define ES_LOG_INFO(...)  ::esengine::Log::info(__VA_ARGS__)
#define ES_LOG_WARN(...)  ::esengine::Log::warn(__VA_ARGS__)
#define ES_LOG_ERROR(...) ::esengine::Log::error(__VA_ARGS__)
#define ES_LOG_FATAL(...) ::esengine::Log::fatal(__VA_ARGS__)

// Assert macro
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
