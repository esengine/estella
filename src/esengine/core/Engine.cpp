/**
 * @file    Engine.cpp
 * @brief   Engine singleton implementation
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

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    #ifndef GL_MAX_TEXTURE_SIZE
        #define GL_MAX_TEXTURE_SIZE 0x0D33
    #endif
#endif

namespace esengine {

Engine& Engine::get() {
    static Engine instance;
    return instance;
}

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

u32 Engine::getMaxTextureSize() {
#ifdef ES_PLATFORM_WEB
    GLint maxSize = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &maxSize);
    return static_cast<u32>(maxSize);
#else
    return 2048;  // Default fallback
#endif
}

}  // namespace esengine
