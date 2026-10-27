// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Log.cpp
 * @brief   Logging system implementation
 * @details Provides multi-level logging output to console.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "Log.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdio>

namespace esengine {

LogLevel Log::level_ = LogLevel::Info;
std::vector<std::pair<u32, LogSink>> Log::sinks_;
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
    u32 id = nextSinkId_++;
    sinks_.emplace_back(id, std::move(sink));
    return id;
}

void Log::removeSink(u32 sinkId) {
    sinks_.erase(
        std::remove_if(sinks_.begin(), sinks_.end(),
                       [sinkId](const auto& pair) { return pair.first == sinkId; }),
        sinks_.end());
}

void Log::emit(LogLevel level, const std::string& message) {
    std::string line;
    line.reserve(message.size() + 10);
    line += '[';
    line += levelToString(level);
    line += "] ";
    line += message;
    line += '\n';
    std::fputs(line.c_str(), level >= LogLevel::Error ? stderr : stdout);
    notifySinks(level, message);
}

void Log::appendSigned(std::string& out, i64 value) {
    char buf[24];
    auto res = std::to_chars(buf, buf + sizeof buf, value);
    out.append(buf, res.ptr);
}

void Log::appendUnsigned(std::string& out, u64 value) {
    char buf[24];
    auto res = std::to_chars(buf, buf + sizeof buf, value);
    out.append(buf, res.ptr);
}

void Log::appendFloat(std::string& out, double value, int precision) {
    char buf[400];
    // What a stream prints by default is %g at six digits; "{:.Nf}" is %f at N.
    int n = precision < 0 ? std::snprintf(buf, sizeof buf, "%g", value)
                          : std::snprintf(buf, sizeof buf, "%.*f", precision > 99 ? 99 : precision, value);
    if (n > 0) out.append(buf, static_cast<usize>(n < static_cast<int>(sizeof buf) ? n : static_cast<int>(sizeof buf) - 1));
}

void Log::appendPointer(std::string& out, const void* value) {
    char buf[32];
    int n = std::snprintf(buf, sizeof buf, "%p", value);
    if (n > 0) out.append(buf, static_cast<usize>(n));
}

int Log::precisionOf(const char* spec, const char* end) {
    if (spec == end || spec[0] != ':' || end[-1] != 'f') return -1;
    const char* dot = std::find(spec + 1, end, '.');
    if (dot == end) return -1;
    // Digits between '.' and the trailing 'f'. from_chars never throws; std::stoi would abort the whole module under -fno-exceptions on
    // malformed specs like "{:.f}".
    int precision = 0;
    const char* begin = dot + 1;
    auto res = std::from_chars(begin, end - 1, precision);
    return res.ptr != begin ? precision : -1;
}

void Log::notifySinks(LogLevel level, const std::string& message) {
    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();

    LogEntry entry{level, message, static_cast<u64>(millis)};

    for (const auto& [id, sink] : sinks_) {
        sink(entry);
    }
}

}  // namespace esengine
