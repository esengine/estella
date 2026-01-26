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
    // Windows/Linux use standard OpenGL headers
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>

    // Define missing OpenGL constants for native build stubs
    #ifndef GL_MAX_TEXTURE_SIZE
        #define GL_MAX_TEXTURE_SIZE 0x0D33
    #endif

    #ifndef GL_VERTEX_SHADER
        #define GL_VERTEX_SHADER 0x8B31
        #define GL_FRAGMENT_SHADER 0x8B30
        #define GL_COMPILE_STATUS 0x8B81
        #define GL_LINK_STATUS 0x8B82
        #define GL_INFO_LOG_LENGTH 0x8B84
    #endif

    #ifndef GL_TEXTURE_2D
        #define GL_TEXTURE_2D 0x0DE1
        #define GL_TEXTURE_MIN_FILTER 0x2801
        #define GL_TEXTURE_MAG_FILTER 0x2800
        #define GL_TEXTURE_WRAP_S 0x2802
        #define GL_TEXTURE_WRAP_T 0x2803
        #define GL_LINEAR 0x2601
        #define GL_NEAREST 0x2600
        #define GL_REPEAT 0x2901
        #define GL_CLAMP_TO_EDGE 0x812F
        #define GL_MIRRORED_REPEAT 0x8370
        #define GL_RGB 0x1907
        #define GL_RGBA 0x1908
        #define GL_RGB8 0x8051
        #define GL_RGBA8 0x8058
        #define GL_UNSIGNED_BYTE 0x1401
    #endif

    #ifndef GL_ARRAY_BUFFER
        #define GL_ARRAY_BUFFER 0x8892
        #define GL_ELEMENT_ARRAY_BUFFER 0x8893
        #define GL_STATIC_DRAW 0x88E4
        #define GL_DYNAMIC_DRAW 0x88E8
    #endif

    #ifndef GL_TRIANGLES
        #define GL_TRIANGLES 0x0004
        #define GL_UNSIGNED_INT 0x1405
        #define GL_UNSIGNED_SHORT 0x1403
        #define GL_COLOR_BUFFER_BIT 0x00004000
        #define GL_DEPTH_BUFFER_BIT 0x00000100
        #define GL_DEPTH_TEST 0x0B71
        #define GL_BLEND 0x0BE2
        #define GL_SRC_ALPHA 0x0302
        #define GL_ONE_MINUS_SRC_ALPHA 0x0303
        #define GL_CULL_FACE 0x0B44
        #define GL_BACK 0x0405
        #define GL_FRONT 0x0404
        #define GL_BOOL 0x8B56
        #define GL_INT 0x1404
        #define GL_FLOAT 0x1406
        #define GL_TRUE 1
        #define GL_FALSE 0
    #endif

    #ifndef GL_TEXTURE0
        #define GL_TEXTURE0 0x84C0
    #endif
#endif
