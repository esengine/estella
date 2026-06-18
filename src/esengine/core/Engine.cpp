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
#else
    return "Web";
#endif
}

bool Engine::isWebPlatform() {
    return true;
}

bool Engine::hasWebGL2() {
    return true;  // WebGL2 is a hard requirement
}

}  // namespace esengine
