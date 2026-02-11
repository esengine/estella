/**
 * @file    BlendMode.hpp
 * @brief   Blend mode enumeration for custom rendering
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"

namespace esengine {

/**
 * @brief Predefined blend modes for rendering
 */
enum class BlendMode : u8 {
    Normal = 0,     // SrcAlpha, OneMinusSrcAlpha (default alpha blending)
    Additive = 1,   // SrcAlpha, One (glow, particles)
    Multiply = 2,   // DstColor, OneMinusSrcAlpha (shadows, multiply)
    Screen = 3,     // One, OneMinusSrcColor (lighten)
    PremultipliedAlpha = 4,  // One, OneMinusSrcAlpha (premultiplied alpha)
    PmaAdditive = 5, // One, One (additive with premultiplied alpha source)
};

}  // namespace esengine
