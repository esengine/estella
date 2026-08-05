// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BlendMode.hpp
 * @brief   Blend mode enumeration for custom rendering
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"

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
    Lighten = 6,    // GL_MAX blend equation (take brighter pixel)
    Darken = 7,     // GL_MIN blend equation (take darker pixel)
    Overlay = 8,    // Screen on light, Multiply on dark (requires shader)
    // No blending: the source replaces the destination. Every other mode reads the
    // destination for each fragment, which an opaque sprite pays for nothing, and
    // — the reason this exists — an opaque draw is the only kind that may WRITE
    // depth, since a blended one has to stay behind the painter's order. Last in
    // the list rather than first because these values are serialized into material
    // assets; Normal must stay 0.
    None = 9,
};

}  // namespace esengine
