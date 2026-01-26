/**
 * @file    Checkbox.hpp
 * @brief   Checkbox widget for boolean input
 * @details Provides a clickable checkbox with optional label text.
 *          Emits onChanged signal when the checked state toggles.
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

#include "Widget.hpp"
#include "../../events/Signal.hpp"

#include <string>

namespace esengine::ui {

// =============================================================================
// Checkbox Class
// =============================================================================

/**
 * @brief Checkbox widget for boolean selection
 *
 * @details Renders a checkbox with optional label. Clicking toggles the
 *          checked state and emits the onChanged signal.
 *
 * @code
 * auto checkbox = makeUnique<Checkbox>(WidgetId("show_grid"));
 * checkbox->setLabel("Show Grid");
 * checkbox->setChecked(true);
 * checkbox->onChanged.connect([](bool checked) {
 *     ES_LOG_INFO("Grid visibility: {}", checked);
 * });
 * @endcode
 */
class Checkbox : public Widget {
public:
    /**
     * @brief Constructs a checkbox widget
     * @param id Unique widget identifier
     */
    explicit Checkbox(const WidgetId& id);

    ~Checkbox() override = default;

    // =========================================================================
    // State Management
    // =========================================================================

    /**
     * @brief Sets the checked state
     * @param checked True to check, false to uncheck
     */
    void setChecked(bool checked);

    /**
     * @brief Gets the checked state
     * @return True if checked
     */
    bool isChecked() const { return checked_; }

    /**
     * @brief Toggles the checked state
     */
    void toggle();

    // =========================================================================
    // Label
    // =========================================================================

    /**
     * @brief Sets the label text
     * @param label Text to display next to checkbox
     */
    void setLabel(const std::string& label);

    /**
     * @brief Gets the label text
     * @return Current label text
     */
    const std::string& getLabel() const { return label_; }

    // =========================================================================
    // Appearance
    // =========================================================================

    /**
     * @brief Sets the checkbox size
     * @param size Size in pixels (default 16.0f)
     */
    void setCheckboxSize(f32 size);

    /**
     * @brief Gets the checkbox size
     * @return Checkbox size in pixels
     */
    f32 getCheckboxSize() const { return checkboxSize_; }

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(class UIBatchRenderer& renderer) override;

    bool onMouseDown(const MouseButtonEvent& event) override;

    // =========================================================================
    // Signals
    // =========================================================================

    /**
     * @brief Emitted when the checked state changes
     * @param checked New checked state
     */
    Signal<void(bool)> onChanged;

private:
    bool checked_ = false;
    std::string label_;
    f32 checkboxSize_ = 16.0f;
    static constexpr f32 LABEL_SPACING = 8.0f;
};

}  // namespace esengine::ui
