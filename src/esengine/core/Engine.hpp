#pragma once

#include "Types.hpp"
#include <string>

namespace esengine {

// Engine version info
struct EngineVersion {
    static constexpr u32 MAJOR = 0;
    static constexpr u32 MINOR = 1;
    static constexpr u32 PATCH = 0;

    static std::string toString() {
        return std::to_string(MAJOR) + "." +
               std::to_string(MINOR) + "." +
               std::to_string(PATCH);
    }
};

// Engine singleton - manages global engine state
class Engine {
public:
    // Get engine instance
    static Engine& get();

    // Engine info
    static const char* getName() { return "ESEngine"; }
    static std::string getVersion() { return EngineVersion::toString(); }

    // Platform info
    static const char* getPlatformName();
    static bool isWebPlatform();

    // Feature queries
    static bool hasWebGL2();
    static u32 getMaxTextureSize();

private:
    Engine() = default;
    ~Engine() = default;

    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;
};

}  // namespace esengine
