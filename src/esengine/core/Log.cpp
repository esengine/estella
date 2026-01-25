#include "Log.hpp"

namespace esengine {

LogLevel Log::level_ = LogLevel::Info;

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

}  // namespace esengine
