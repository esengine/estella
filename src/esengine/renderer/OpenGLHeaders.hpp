/**
 * @file    OpenGLHeaders.hpp
 * @brief   Platform-specific OpenGL header includes
 * @details Provides correct OpenGL header paths for different platforms
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Platform-specific OpenGL Headers
// =============================================================================

#ifdef ES_PLATFORM_WEB
    // Web platform uses OpenGL ES 3.0
    #include <GLES3/gl3.h>
#elif defined(__APPLE__)
    // macOS uses OpenGL framework
    #include <OpenGL/gl3.h>
#else
    // Windows/Linux use GLAD for modern OpenGL
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif
