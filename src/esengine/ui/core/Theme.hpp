/**
 * @file    Theme.hpp
 * @brief   UI theming system for consistent visual styling
 * @details Provides theme colors, spacing constants, and widget styles
 *          for a unified visual appearance across the UI system.
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

#include "Types.hpp"

#include <glm/glm.hpp>

#include <string>

namespace esengine::ui {

// =============================================================================
// Theme Colors
// =============================================================================

/**
 * @brief Color palette for theming
 *
 * @details Contains all colors used by the UI system, organized by
 *          semantic purpose rather than specific widgets.
 */
struct ThemeColors {
    // Background colors
    glm::vec4 background{0.15f, 0.15f, 0.15f, 1.0f};
    glm::vec4 backgroundDark{0.10f, 0.10f, 0.10f, 1.0f};
    glm::vec4 backgroundLight{0.20f, 0.20f, 0.20f, 1.0f};
    glm::vec4 surface{0.18f, 0.18f, 0.18f, 1.0f};
    glm::vec4 surfaceHover{0.22f, 0.22f, 0.22f, 1.0f};

    // Text colors
    glm::vec4 textPrimary{0.95f, 0.95f, 0.95f, 1.0f};
    glm::vec4 textSecondary{0.70f, 0.70f, 0.70f, 1.0f};
    glm::vec4 textDisabled{0.45f, 0.45f, 0.45f, 1.0f};
    glm::vec4 textPlaceholder{0.50f, 0.50f, 0.50f, 1.0f};

    // Accent colors
    glm::vec4 accent{0.26f, 0.59f, 0.98f, 1.0f};
    glm::vec4 accentHover{0.35f, 0.65f, 1.0f, 1.0f};
    glm::vec4 accentPressed{0.20f, 0.50f, 0.85f, 1.0f};

    // Button colors
    glm::vec4 button{0.25f, 0.25f, 0.25f, 1.0f};
    glm::vec4 buttonHover{0.30f, 0.30f, 0.30f, 1.0f};
    glm::vec4 buttonPressed{0.20f, 0.20f, 0.20f, 1.0f};
    glm::vec4 buttonDisabled{0.18f, 0.18f, 0.18f, 1.0f};

    // Input colors
    glm::vec4 input{0.12f, 0.12f, 0.12f, 1.0f};
    glm::vec4 inputBorder{0.30f, 0.30f, 0.30f, 1.0f};
    glm::vec4 inputBorderFocused{0.26f, 0.59f, 0.98f, 1.0f};

    // Border colors
    glm::vec4 border{0.25f, 0.25f, 0.25f, 1.0f};
    glm::vec4 borderLight{0.35f, 0.35f, 0.35f, 1.0f};
    glm::vec4 separator{0.20f, 0.20f, 0.20f, 1.0f};

    // State colors
    glm::vec4 selection{0.26f, 0.59f, 0.98f, 0.30f};
    glm::vec4 highlight{1.0f, 1.0f, 1.0f, 0.05f};
    glm::vec4 error{0.90f, 0.30f, 0.30f, 1.0f};
    glm::vec4 warning{0.95f, 0.75f, 0.25f, 1.0f};
    glm::vec4 success{0.30f, 0.85f, 0.45f, 1.0f};

    // Scrollbar colors
    glm::vec4 scrollbarTrack{0.10f, 0.10f, 0.10f, 0.5f};
    glm::vec4 scrollbarThumb{0.40f, 0.40f, 0.40f, 0.7f};
    glm::vec4 scrollbarThumbHover{0.50f, 0.50f, 0.50f, 0.8f};

    // Shadow/overlay
    glm::vec4 shadow{0.0f, 0.0f, 0.0f, 0.5f};
    glm::vec4 overlay{0.0f, 0.0f, 0.0f, 0.6f};
};

// =============================================================================
// Theme Spacing
// =============================================================================

/**
 * @brief Spacing constants for consistent layout
 *
 * @details Defines standard spacing values used throughout the UI
 *          for padding, margins, and gaps.
 */
struct ThemeSpacing {
    f32 unit = 4.0f;

    f32 xs = 2.0f;
    f32 sm = 4.0f;
    f32 md = 8.0f;
    f32 lg = 12.0f;
    f32 xl = 16.0f;
    f32 xxl = 24.0f;

    f32 panelPadding = 8.0f;
    f32 itemSpacing = 4.0f;
    f32 sectionSpacing = 16.0f;

    f32 borderRadius = 4.0f;
    f32 borderRadiusLarge = 8.0f;
    f32 borderWidth = 1.0f;

    f32 scrollbarWidth = 12.0f;
    f32 scrollbarMinThumb = 32.0f;
};

// =============================================================================
// Theme Typography
// =============================================================================

/**
 * @brief Typography settings for text rendering
 */
struct ThemeTypography {
    std::string defaultFont = "default";

    f32 fontSizeSmall = 12.0f;
    f32 fontSizeNormal = 14.0f;
    f32 fontSizeMedium = 16.0f;
    f32 fontSizeLarge = 18.0f;
    f32 fontSizeTitle = 24.0f;
    f32 fontSizeHeader = 32.0f;

    f32 lineHeight = 1.4f;
    f32 letterSpacing = 0.0f;
};

// =============================================================================
// Widget Style
// =============================================================================

/**
 * @brief Style configuration for a specific widget type
 *
 * @details Contains all visual properties that can be applied to a widget,
 *          including colors, spacing, and corner radii.
 */
struct WidgetStyle {
    glm::vec4 backgroundColor{0.0f, 0.0f, 0.0f, 0.0f};
    glm::vec4 backgroundColorHover{0.0f, 0.0f, 0.0f, 0.0f};
    glm::vec4 backgroundColorPressed{0.0f, 0.0f, 0.0f, 0.0f};
    glm::vec4 backgroundColorDisabled{0.0f, 0.0f, 0.0f, 0.0f};

    glm::vec4 textColor{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec4 textColorDisabled{0.5f, 0.5f, 0.5f, 1.0f};

    glm::vec4 borderColor{0.0f, 0.0f, 0.0f, 0.0f};
    glm::vec4 borderColorFocused{0.0f, 0.0f, 0.0f, 0.0f};

    f32 borderWidth = 0.0f;
    CornerRadii cornerRadii;
    Insets padding;

    f32 fontSize = 14.0f;

    /** @brief Gets the background color based on widget state */
    glm::vec4 getBackgroundColor(const WidgetState& state) const {
        if (state.disabled) {
            return backgroundColorDisabled;
        }
        if (state.pressed) {
            return backgroundColorPressed;
        }
        if (state.hovered) {
            return backgroundColorHover;
        }
        return backgroundColor;
    }

    /** @brief Gets the text color based on widget state */
    glm::vec4 getTextColor(const WidgetState& state) const {
        return state.disabled ? textColorDisabled : textColor;
    }

    /** @brief Gets the border color based on widget state */
    glm::vec4 getBorderColor(const WidgetState& state) const {
        return state.focused ? borderColorFocused : borderColor;
    }
};

// =============================================================================
// Theme
// =============================================================================

/**
 * @brief Complete UI theme containing colors, spacing, and widget styles
 *
 * @details Provides a centralized configuration for all visual aspects
 *          of the UI system. Create custom themes by copying and modifying
 *          the default theme.
 */
class Theme {
public:
    ThemeColors colors;
    ThemeSpacing spacing;
    ThemeTypography typography;

    /** @brief Creates the default dark theme */
    static Unique<Theme> createDark() {
        auto theme = makeUnique<Theme>();
        theme->initDark();
        return theme;
    }

    /** @brief Creates a light theme */
    static Unique<Theme> createLight() {
        auto theme = makeUnique<Theme>();
        theme->initLight();
        return theme;
    }

    /** @brief Gets the style for a panel widget */
    WidgetStyle getPanelStyle() const {
        WidgetStyle style;
        style.backgroundColor = colors.surface;
        style.backgroundColorHover = colors.surface;
        style.backgroundColorPressed = colors.surface;
        style.backgroundColorDisabled = colors.surface;
        style.borderColor = colors.border;
        style.borderWidth = spacing.borderWidth;
        style.cornerRadii = CornerRadii::all(spacing.borderRadius);
        style.padding = Insets::all(spacing.panelPadding);
        return style;
    }

    /** @brief Gets the style for a button widget */
    WidgetStyle getButtonStyle() const {
        WidgetStyle style;
        style.backgroundColor = colors.button;
        style.backgroundColorHover = colors.buttonHover;
        style.backgroundColorPressed = colors.buttonPressed;
        style.backgroundColorDisabled = colors.buttonDisabled;
        style.textColor = colors.textPrimary;
        style.textColorDisabled = colors.textDisabled;
        style.cornerRadii = CornerRadii::all(spacing.borderRadius);
        style.padding = Insets::symmetric(spacing.lg, spacing.md);
        style.fontSize = typography.fontSizeNormal;
        return style;
    }

    /** @brief Gets the style for a primary (accent) button */
    WidgetStyle getPrimaryButtonStyle() const {
        WidgetStyle style = getButtonStyle();
        style.backgroundColor = colors.accent;
        style.backgroundColorHover = colors.accentHover;
        style.backgroundColorPressed = colors.accentPressed;
        return style;
    }

    /** @brief Gets the style for a label widget */
    WidgetStyle getLabelStyle() const {
        WidgetStyle style;
        style.textColor = colors.textPrimary;
        style.textColorDisabled = colors.textDisabled;
        style.fontSize = typography.fontSizeNormal;
        return style;
    }

    /** @brief Gets the style for a text input widget */
    WidgetStyle getTextInputStyle() const {
        WidgetStyle style;
        style.backgroundColor = colors.input;
        style.backgroundColorHover = colors.input;
        style.backgroundColorPressed = colors.input;
        style.backgroundColorDisabled = colors.backgroundDark;
        style.textColor = colors.textPrimary;
        style.textColorDisabled = colors.textDisabled;
        style.borderColor = colors.inputBorder;
        style.borderColorFocused = colors.inputBorderFocused;
        style.borderWidth = spacing.borderWidth;
        style.cornerRadii = CornerRadii::all(spacing.borderRadius);
        style.padding = Insets::symmetric(spacing.md, spacing.sm);
        style.fontSize = typography.fontSizeNormal;
        return style;
    }

    /** @brief Gets the style for a slider track */
    WidgetStyle getSliderTrackStyle() const {
        WidgetStyle style;
        style.backgroundColor = colors.backgroundDark;
        style.backgroundColorHover = colors.backgroundDark;
        style.cornerRadii = CornerRadii::all(2.0f);
        return style;
    }

    /** @brief Gets the style for a slider thumb */
    WidgetStyle getSliderThumbStyle() const {
        WidgetStyle style;
        style.backgroundColor = colors.accent;
        style.backgroundColorHover = colors.accentHover;
        style.backgroundColorPressed = colors.accentPressed;
        style.cornerRadii = CornerRadii::all(6.0f);
        return style;
    }

private:
    void initDark() {
        // Colors are already initialized to dark theme defaults
    }

    void initLight() {
        // Override with light theme colors
        colors.background = {0.95f, 0.95f, 0.95f, 1.0f};
        colors.backgroundDark = {0.90f, 0.90f, 0.90f, 1.0f};
        colors.backgroundLight = {1.0f, 1.0f, 1.0f, 1.0f};
        colors.surface = {1.0f, 1.0f, 1.0f, 1.0f};
        colors.surfaceHover = {0.98f, 0.98f, 0.98f, 1.0f};

        colors.textPrimary = {0.10f, 0.10f, 0.10f, 1.0f};
        colors.textSecondary = {0.40f, 0.40f, 0.40f, 1.0f};
        colors.textDisabled = {0.60f, 0.60f, 0.60f, 1.0f};
        colors.textPlaceholder = {0.55f, 0.55f, 0.55f, 1.0f};

        colors.button = {0.90f, 0.90f, 0.90f, 1.0f};
        colors.buttonHover = {0.85f, 0.85f, 0.85f, 1.0f};
        colors.buttonPressed = {0.80f, 0.80f, 0.80f, 1.0f};
        colors.buttonDisabled = {0.92f, 0.92f, 0.92f, 1.0f};

        colors.input = {1.0f, 1.0f, 1.0f, 1.0f};
        colors.inputBorder = {0.75f, 0.75f, 0.75f, 1.0f};

        colors.border = {0.80f, 0.80f, 0.80f, 1.0f};
        colors.borderLight = {0.85f, 0.85f, 0.85f, 1.0f};
        colors.separator = {0.88f, 0.88f, 0.88f, 1.0f};

        colors.selection = {0.26f, 0.59f, 0.98f, 0.20f};
        colors.highlight = {0.0f, 0.0f, 0.0f, 0.03f};

        colors.scrollbarTrack = {0.90f, 0.90f, 0.90f, 0.5f};
        colors.scrollbarThumb = {0.60f, 0.60f, 0.60f, 0.5f};
        colors.scrollbarThumbHover = {0.50f, 0.50f, 0.50f, 0.6f};

        colors.shadow = {0.0f, 0.0f, 0.0f, 0.15f};
        colors.overlay = {0.0f, 0.0f, 0.0f, 0.3f};
    }
};

}  // namespace esengine::ui
