/**
 * @file    SizeValue.hpp
 * @brief   Flexible size value types for UI layout
 * @details Provides size values that can be expressed in pixels, percentages,
 *          flex units, or auto-sizing for flexible layout systems.
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

#include <limits>

namespace esengine::ui {

// =============================================================================
// Size Unit
// =============================================================================

/**
 * @brief Units for expressing size values
 */
enum class SizeUnit : u8 {
    Pixels,
    Percent,
    Flex,
    Auto,
    FitContent
};

// =============================================================================
// Size Value
// =============================================================================

/**
 * @brief A size value with unit for flexible layout
 *
 * @details Represents a dimension that can be expressed in different units:
 *          - Pixels: Absolute size in pixels
 *          - Percent: Percentage of parent's available space
 *          - Flex: Flexible space that grows/shrinks relative to siblings
 *          - Auto: Size determined by content
 *          - FitContent: Shrink to fit content, up to available space
 */
struct SizeValue {
    f32 value = 0.0f;
    SizeUnit unit = SizeUnit::Auto;

    constexpr SizeValue() = default;
    constexpr SizeValue(f32 v, SizeUnit u) : value(v), unit(u) {}

    /** @brief Creates an absolute pixel size */
    static constexpr SizeValue px(f32 pixels) { return SizeValue(pixels, SizeUnit::Pixels); }

    /** @brief Creates a percentage size (0-100) */
    static constexpr SizeValue percent(f32 pct) { return SizeValue(pct, SizeUnit::Percent); }

    /** @brief Creates a flex size (relative weight) */
    static constexpr SizeValue flex(f32 weight = 1.0f) { return SizeValue(weight, SizeUnit::Flex); }

    /** @brief Creates an auto size (determined by content) */
    static constexpr SizeValue autoSize() { return SizeValue(0.0f, SizeUnit::Auto); }

    /** @brief Creates a fit-content size */
    static constexpr SizeValue fitContent() { return SizeValue(0.0f, SizeUnit::FitContent); }

    /** @brief Returns true if this is an absolute pixel value */
    constexpr bool isPixels() const { return unit == SizeUnit::Pixels; }

    /** @brief Returns true if this is a percentage value */
    constexpr bool isPercent() const { return unit == SizeUnit::Percent; }

    /** @brief Returns true if this is a flex value */
    constexpr bool isFlex() const { return unit == SizeUnit::Flex; }

    /** @brief Returns true if this is an auto value */
    constexpr bool isAuto() const { return unit == SizeUnit::Auto; }

    /** @brief Returns true if this is a fit-content value */
    constexpr bool isFitContent() const { return unit == SizeUnit::FitContent; }

    /**
     * @brief Resolves the size to pixels given available space
     *
     * @param available The available space in pixels
     * @param contentSize The intrinsic content size (for auto/fit-content)
     * @return The resolved size in pixels
     */
    constexpr f32 resolve(f32 available, f32 contentSize = 0.0f) const {
        switch (unit) {
            case SizeUnit::Pixels:
                return value;
            case SizeUnit::Percent:
                return available * (value / 100.0f);
            case SizeUnit::Flex:
                return available;
            case SizeUnit::Auto:
                return contentSize;
            case SizeUnit::FitContent:
                return (contentSize < available) ? contentSize : available;
        }
        return 0.0f;
    }

    /**
     * @brief Returns true if this size needs content measurement to resolve
     */
    constexpr bool needsContentSize() const {
        return unit == SizeUnit::Auto || unit == SizeUnit::FitContent;
    }

    constexpr bool operator==(const SizeValue& other) const {
        return unit == other.unit && (unit == SizeUnit::Auto || value == other.value);
    }

    constexpr bool operator!=(const SizeValue& other) const { return !(*this == other); }
};

// =============================================================================
// Size Constraints
// =============================================================================

/**
 * @brief Size constraints for layout (min/max bounds)
 *
 * @details Defines minimum and maximum size constraints that can be applied
 *          during layout calculation.
 */
struct SizeConstraints {
    f32 minWidth = 0.0f;
    f32 minHeight = 0.0f;
    f32 maxWidth = std::numeric_limits<f32>::max();
    f32 maxHeight = std::numeric_limits<f32>::max();

    constexpr SizeConstraints() = default;

    constexpr SizeConstraints(f32 minW, f32 minH, f32 maxW, f32 maxH)
        : minWidth(minW), minHeight(minH), maxWidth(maxW), maxHeight(maxH) {}

    /** @brief Creates constraints with no limits */
    static constexpr SizeConstraints unconstrained() { return SizeConstraints(); }

    /** @brief Creates tight constraints (exact size) */
    static constexpr SizeConstraints exact(f32 width, f32 height) {
        return SizeConstraints(width, height, width, height);
    }

    /** @brief Creates constraints with maximum size only */
    static constexpr SizeConstraints maxSize(f32 width, f32 height) {
        return SizeConstraints(0.0f, 0.0f, width, height);
    }

    /** @brief Creates constraints with minimum size only */
    static constexpr SizeConstraints minSize(f32 width, f32 height) {
        return SizeConstraints(width, height, std::numeric_limits<f32>::max(),
                               std::numeric_limits<f32>::max());
    }

    /** @brief Constrains a width value to these constraints */
    constexpr f32 constrainWidth(f32 width) const {
        if (width < minWidth) return minWidth;
        if (width > maxWidth) return maxWidth;
        return width;
    }

    /** @brief Constrains a height value to these constraints */
    constexpr f32 constrainHeight(f32 height) const {
        if (height < minHeight) return minHeight;
        if (height > maxHeight) return maxHeight;
        return height;
    }

    /** @brief Returns true if these constraints allow any size */
    constexpr bool isUnconstrained() const {
        return minWidth == 0.0f && minHeight == 0.0f &&
               maxWidth == std::numeric_limits<f32>::max() &&
               maxHeight == std::numeric_limits<f32>::max();
    }

    /** @brief Returns true if these constraints require an exact size */
    constexpr bool isTight() const {
        return minWidth == maxWidth && minHeight == maxHeight;
    }
};

// =============================================================================
// Alignment
// =============================================================================

/**
 * @brief Horizontal alignment options
 */
enum class HAlign : u8 {
    Left,
    Center,
    Right,
    Stretch
};

/**
 * @brief Vertical alignment options
 */
enum class VAlign : u8 {
    Top,
    Center,
    Bottom,
    Stretch
};

/**
 * @brief Combined alignment for both axes
 */
struct Alignment {
    HAlign horizontal = HAlign::Left;
    VAlign vertical = VAlign::Top;

    constexpr Alignment() = default;
    constexpr Alignment(HAlign h, VAlign v) : horizontal(h), vertical(v) {}

    static constexpr Alignment topLeft() { return {HAlign::Left, VAlign::Top}; }
    static constexpr Alignment topCenter() { return {HAlign::Center, VAlign::Top}; }
    static constexpr Alignment topRight() { return {HAlign::Right, VAlign::Top}; }
    static constexpr Alignment centerLeft() { return {HAlign::Left, VAlign::Center}; }
    static constexpr Alignment center() { return {HAlign::Center, VAlign::Center}; }
    static constexpr Alignment centerRight() { return {HAlign::Right, VAlign::Center}; }
    static constexpr Alignment bottomLeft() { return {HAlign::Left, VAlign::Bottom}; }
    static constexpr Alignment bottomCenter() { return {HAlign::Center, VAlign::Bottom}; }
    static constexpr Alignment bottomRight() { return {HAlign::Right, VAlign::Bottom}; }
    static constexpr Alignment stretch() { return {HAlign::Stretch, VAlign::Stretch}; }

    /**
     * @brief Calculates the X offset for aligning content within a container
     *
     * @param containerWidth Width of the container
     * @param contentWidth Width of the content to align
     * @return X offset from container left edge
     */
    constexpr f32 alignX(f32 containerWidth, f32 contentWidth) const {
        switch (horizontal) {
            case HAlign::Left:
                return 0.0f;
            case HAlign::Center:
                return (containerWidth - contentWidth) * 0.5f;
            case HAlign::Right:
                return containerWidth - contentWidth;
            case HAlign::Stretch:
                return 0.0f;
        }
        return 0.0f;
    }

    /**
     * @brief Calculates the Y offset for aligning content within a container
     *
     * @param containerHeight Height of the container
     * @param contentHeight Height of the content to align
     * @return Y offset from container top edge
     */
    constexpr f32 alignY(f32 containerHeight, f32 contentHeight) const {
        switch (vertical) {
            case VAlign::Top:
                return 0.0f;
            case VAlign::Center:
                return (containerHeight - contentHeight) * 0.5f;
            case VAlign::Bottom:
                return containerHeight - contentHeight;
            case VAlign::Stretch:
                return 0.0f;
        }
        return 0.0f;
    }
};

}  // namespace esengine::ui
