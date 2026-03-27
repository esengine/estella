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

// GL blend equation constants/functions not present in all glad configurations
#ifndef GL_FUNC_ADD
    #define GL_FUNC_ADD 0x8006
#endif
#ifndef GL_MIN
    #define GL_MIN 0x8007
#endif
#ifndef GL_MAX
    #define GL_MAX 0x8008
#endif
#ifndef GL_BLEND_EQUATION
    #define GL_BLEND_EQUATION 0x8009
#endif

// GL constants not present in all headers / glad configurations
#ifndef GL_CONTEXT_LOST
    #define GL_CONTEXT_LOST 0x0507
#endif
#ifndef GL_CONTEXT_LOST_WEBGL
    #define GL_CONTEXT_LOST_WEBGL 0x9242
#endif
#ifndef GL_INCR
    #define GL_INCR      0x1E02
#endif
#ifndef GL_DECR
    #define GL_DECR      0x1E03
#endif
#ifndef GL_INVERT
    #define GL_INVERT    0x150A
#endif
#ifndef GL_INCR_WRAP
    #define GL_INCR_WRAP 0x8507
#endif
#ifndef GL_DECR_WRAP
    #define GL_DECR_WRAP 0x8508
#endif
