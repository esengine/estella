/**
 * @file    TextureMetadata.hpp
 * @brief   Texture metadata structures for nine-slice and other settings
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

namespace esengine::resource {

// =============================================================================
// SliceBorder
// =============================================================================

/**
 * @brief Nine-slice border definition for UI sprites
 *
 * @details Defines the border widths in pixels for nine-slice rendering.
 *          When a texture has non-zero slice borders, sprites using it
 *          will be rendered as 9 quads, preserving corner regions.
 */
struct SliceBorder {
    f32 left = 0.0f;    ///< Left border width in pixels
    f32 right = 0.0f;   ///< Right border width in pixels
    f32 top = 0.0f;     ///< Top border height in pixels
    f32 bottom = 0.0f;  ///< Bottom border height in pixels

    /** @brief Checks if any slicing is defined */
    bool hasSlicing() const {
        return left > 0 || right > 0 || top > 0 || bottom > 0;
    }

    /** @brief Checks if all borders are zero */
    bool isZero() const {
        return left == 0 && right == 0 && top == 0 && bottom == 0;
    }
};

// =============================================================================
// TextureMetadata
// =============================================================================

/**
 * @brief Metadata associated with a texture resource
 *
 * @details Stores additional settings for textures that affect rendering,
 *          such as nine-slice borders. This data is typically loaded from
 *          .meta sidecar files in the editor.
 */
struct TextureMetadata {
    SliceBorder sliceBorder;  ///< Nine-slice border configuration
};

}  // namespace esengine::resource
