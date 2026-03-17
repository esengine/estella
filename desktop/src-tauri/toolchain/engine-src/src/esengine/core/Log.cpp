/**
 * @file    Log.cpp
 * @brief   Logging system implementation
 * @details Provides multi-level logging output to console.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Log.hpp"

#include <algorithm>
#include <chrono>

namespace esengine {

LogLevel Log::level_ = LogLevel::Info;
std::vector<std::pair<u32, LogSink>> Log::sinks_;
#ifndef ES_PLATFORM_WEB
std::mutex Log::sinkMutex_;
#endif
u32 Log::nextSinkId_ = 1;

void Log::init() {
#ifdef ES_DEBUG
    level_ = LogLevel::Trace;
#else
    level_ = LogLevel::Info;
#endif
    info("ESEngine Log initialized");
}

void Log::shutdown() {
    info("ESEngine Log shutdown");
}

void Log::setLevel(LogLevel level) {
    level_ = level;
}

LogLevel Log::getLevel() {
    return level_;
}

const char* Log::levelToString(LogLevel level) {
    switch (level) {
    case LogLevel::Trace: return "TRACE";
    case LogLevel::Debug: return "DEBUG";
    case LogLevel::Info:  return "INFO ";
    case LogLevel::Warn:  return "WARN ";
    case LogLevel::Error: return "ERROR";
    case LogLevel::Fatal: return "FATAL";
    default: return "UNKNOWN";
    }
}

u32 Log::addSink(LogSink sink) {
#ifndef ES_PLATFORM_WEB
    std::lock_guard<std::mutex> lock(sinkMutex_);
#endif
    u32 id = nextSinkId_++;
    sinks_.emplace_back(id, std::move(sink));
    return id;
}

void Log::removeSink(u32 sinkId) {
#ifndef ES_PLATFORM_WEB
    std::lock_guard<std::mutex> lock(sinkMutex_);
#endif
    sinks_.erase(
        std::remove_if(sinks_.begin(), sinks_.end(),
                       [sinkId](const auto& pair) { return pair.first == sinkId; }),
        sinks_.end());
}

void Log::notifySinks(LogLevel level, const std::string& message) {
#ifndef ES_PLATFORM_WEB
    std::lock_guard<std::mutex> lock(sinkMutex_);
#endif

    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();

    LogEntry entry{level, message, static_cast<u64>(millis)};

    for (const auto& [id, sink] : sinks_) {
        sink(entry);
    }
}

}  // namespace esengine
