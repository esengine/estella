/**
 * @file    Layout.hpp
 * @brief   Layout interface for widget arrangement
 * @details Defines the interface for layout managers that arrange child
 *          widgets within a container.
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

#include "../../core/Types.hpp"
#include "../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine::ui {

class Widget;

// =============================================================================
// Layout Interface
// =============================================================================

/**
 * @brief Interface for layout managers
 *
 * @details Layout managers determine how child widgets are positioned and
 *          sized within their parent container.
 */
class Layout {
public:
    virtual ~Layout() = default;

    /**
     * @brief Measures the preferred size for the layout
     * @param container The container widget
     * @param availableWidth Available width
     * @param availableHeight Available height
     * @return Preferred size for the content
     */
    virtual glm::vec2 measure(Widget& container, f32 availableWidth, f32 availableHeight) = 0;

    /**
     * @brief Lays out children within the given bounds
     * @param container The container widget
     * @param bounds Available bounds for children
     */
    virtual void layout(Widget& container, const Rect& bounds) = 0;
};

}  // namespace esengine::ui
