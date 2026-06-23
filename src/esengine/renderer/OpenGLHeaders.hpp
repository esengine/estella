// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    OpenGLHeaders.hpp
 * @brief   Platform-specific OpenGL header includes
 * @details Provides correct OpenGL header paths for different platforms
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
 */
#pragma once

// =============================================================================
// OpenGL Headers
// =============================================================================

// Web/wasm targets OpenGL ES 3.0 (WebGL 2.0).
#include <GLES3/gl3.h>

// GL blend equation constants not guaranteed across all GLES3/WebGL2 headers
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

// GL constants not guaranteed across all GLES3/WebGL2 headers
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
