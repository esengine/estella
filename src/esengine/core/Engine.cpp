/**
 * @file    Engine.cpp
 * @brief   Engine static utility implementation
 * @details Provides platform detection and GPU capability queries.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Engine.hpp"
#include "Log.hpp"

namespace esengine {

const char* Engine::getPlatformName() {
#ifdef ES_PLATFORM_WXGAME
    return "WeChat MiniGame";
#elif defined(ES_PLATFORM_WEB)
    return "Web";
#elif defined(ES_PLATFORM_WINDOWS)
    return "Windows";
#elif defined(ES_PLATFORM_MACOS)
    return "macOS";
#elif defined(ES_PLATFORM_LINUX)
    return "Linux";
#else
    return "Unknown";
#endif
}

bool Engine::isWebPlatform() {
#ifdef ES_PLATFORM_WEB
    return true;
#else
    return false;
#endif
}

bool Engine::hasWebGL2() {
#ifdef ES_PLATFORM_WEB
    return true;  // We require WebGL2
#else
    return false;
#endif
}

}  // namespace esengine
