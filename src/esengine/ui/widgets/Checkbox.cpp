/**
 * @file    Checkbox.cpp
 * @brief   Checkbox widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Checkbox.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../math/Math.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Checkbox::Checkbox(const WidgetId& id) : Widget(id) {}

// =============================================================================
// State Management
// =============================================================================

void Checkbox::setChecked(bool checked) {
    if (checked_ == checked) {
        return;
    }

    checked_ = checked;
    onChanged.publish(checked_);
}

void Checkbox::toggle() {
    setChecked(!checked_);
}

// =============================================================================
// Label
// =============================================================================

void Checkbox::setLabel(const std::string& label) {
    if (label_ == label) {
        return;
    }

    label_ = label;
    invalidateLayout();
}

// =============================================================================
// Appearance
// =============================================================================

void Checkbox::setCheckboxSize(f32 size) {
    if (checkboxSize_ == size) {
        return;
    }

    checkboxSize_ = size;
    invalidateLayout();
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 Checkbox::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    f32 width = checkboxSize_;
    f32 height = checkboxSize_;

    if (!label_.empty() && getContext()) {
        f32 fontSize = getContext()->getTheme().typography.fontSizeNormal;
        f32 labelWidth = static_cast<f32>(label_.length()) * fontSize * 0.6f;

#if ES_FEATURE_SDF_FONT
        MSDFFont* font = getContext()->getDefaultMSDFFont();
        if (font) {
            labelWidth = font->measureText(label_, fontSize).x;
        }
#elif ES_FEATURE_BITMAP_FONT
        BitmapFont* font = getContext()->getDefaultBitmapFont();
        if (font) {
            labelWidth = font->measureText(label_, fontSize).x;
        }
#endif

        width += LABEL_SPACING + labelWidth;
        height = glm::max(height, fontSize);
    }

    const SizeConstraints& constraints = getConstraints();
    width = glm::clamp(width, constraints.minWidth, constraints.maxWidth);
    height = glm::clamp(height, constraints.minHeight, constraints.maxHeight);

    return glm::vec2(width, height);
}

void Checkbox::render(UIBatchRenderer& renderer) {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getButtonStyle();
    }

    WidgetState state{
        .hovered = isHovered(),
        .pressed = isPressed(),
        .focused = false,
        .disabled = !isEnabled(),
        .visible = true
    };

    f32 checkboxX = bounds.x + padding.left;
    f32 checkboxY = bounds.y + (bounds.height - checkboxSize_) * 0.5f;

    Rect checkboxBounds{checkboxX, checkboxY, checkboxSize_, checkboxSize_};

    glm::vec4 bgColor = checked_ ? style.getBackgroundColor(state) : glm::vec4(0.12f, 0.12f, 0.12f, 1.0f);
    glm::vec4 borderColor = state.hovered ? glm::vec4(0.4f, 0.4f, 0.4f, 1.0f) : glm::vec4(0.3f, 0.3f, 0.3f, 1.0f);

    if (getContext()) {
        if (checked_) {
            bgColor = getContext()->getTheme().colors.accent;
        } else {
            bgColor = getContext()->getTheme().colors.input;
        }
        borderColor = state.hovered
            ? getContext()->getTheme().colors.inputBorderFocused
            : getContext()->getTheme().colors.inputBorder;
    }

    CornerRadii radii = CornerRadii::all(4.0f);
    renderer.drawRoundedRect(checkboxBounds, bgColor, radii);
    renderer.drawRoundedRectOutline(checkboxBounds, borderColor, radii, 1.0f);

    if (checked_) {
        glm::vec4 checkColor = glm::vec4(1.0f, 1.0f, 1.0f, 1.0f);
        if (getContext()) {
            checkColor = getContext()->getTheme().colors.textPrimary;
        }

        f32 checkSize = checkboxSize_ * 0.6f;
        f32 checkX = checkboxX + (checkboxSize_ - checkSize) * 0.5f;
        f32 checkY = checkboxY + (checkboxSize_ - checkSize) * 0.5f;

        f32 x1 = checkX + checkSize * 0.2f;
        f32 y1 = checkY + checkSize * 0.5f;
        f32 x2 = checkX + checkSize * 0.45f;
        f32 y2 = checkY + checkSize * 0.8f;
        f32 x3 = checkX + checkSize * 0.9f;
        f32 y3 = checkY + checkSize * 0.2f;

        renderer.drawLine(glm::vec2(x1, y1), glm::vec2(x2, y2), checkColor, 2.0f);
        renderer.drawLine(glm::vec2(x2, y2), glm::vec2(x3, y3), checkColor, 2.0f);
    }

    if (!label_.empty()) {
        f32 fontSize = 14.0f;
        glm::vec4 textColor = glm::vec4(0.95f, 0.95f, 0.95f, 1.0f);

        if (getContext()) {
            fontSize = getContext()->getTheme().typography.fontSizeNormal;
            textColor = state.disabled
                ? getContext()->getTheme().colors.textDisabled
                : getContext()->getTheme().colors.textPrimary;
        }

        f32 labelX = checkboxX + checkboxSize_ + LABEL_SPACING;
        f32 labelY = bounds.y + (bounds.height - fontSize) * 0.5f;

#if ES_FEATURE_SDF_FONT
        if (getContext() && getContext()->getDefaultMSDFFont()) {
            renderer.drawText(label_, glm::vec2(labelX, labelY),
                            *getContext()->getDefaultMSDFFont(), fontSize, textColor);
        }
#elif ES_FEATURE_BITMAP_FONT
        if (getContext() && getContext()->getDefaultBitmapFont()) {
            renderer.drawText(label_, glm::vec2(labelX, labelY),
                            *getContext()->getDefaultBitmapFont(), fontSize, textColor);
        }
#endif
    }
}

bool Checkbox::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    const Rect& bounds = getBounds();
    if (!bounds.contains(event.x, event.y)) {
        return false;
    }

    toggle();
    return true;
}

}  // namespace esengine::ui
