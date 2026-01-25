/**
 * @file    Types.hpp
 * @brief   Core UI type definitions for the ESEngine UI system
 * @details Provides fundamental types for UI layout and rendering including
 *          rectangles, insets, widget state, widget identification, and
 *          corner radii for rounded rectangles.
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

#include <glm/glm.hpp>

#include <functional>
#include <string>

namespace esengine::ui {

// =============================================================================
// Rect
// =============================================================================

/**
 * @brief Axis-aligned rectangle defined by position and size
 *
 * @details Used for widget bounds, clip regions, and hit testing.
 *          Origin is top-left corner with Y increasing downward.
 */
struct Rect {
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 width = 0.0f;
    f32 height = 0.0f;

    constexpr Rect() = default;
    constexpr Rect(f32 x, f32 y, f32 w, f32 h) : x(x), y(y), width(w), height(h) {}

    /** @brief Creates a rect from position and size vectors */
    static constexpr Rect fromPosSize(const glm::vec2& pos, const glm::vec2& size) {
        return Rect(pos.x, pos.y, size.x, size.y);
    }

    /** @brief Creates a rect from min/max corners */
    static constexpr Rect fromMinMax(const glm::vec2& min, const glm::vec2& max) {
        return Rect(min.x, min.y, max.x - min.x, max.y - min.y);
    }

    /** @brief Returns the left edge X coordinate */
    constexpr f32 left() const { return x; }

    /** @brief Returns the top edge Y coordinate */
    constexpr f32 top() const { return y; }

    /** @brief Returns the right edge X coordinate */
    constexpr f32 right() const { return x + width; }

    /** @brief Returns the bottom edge Y coordinate */
    constexpr f32 bottom() const { return y + height; }

    /** @brief Returns the top-left corner position */
    constexpr glm::vec2 position() const { return {x, y}; }

    /** @brief Returns the size as a vector */
    constexpr glm::vec2 size() const { return {width, height}; }

    /** @brief Returns the center point */
    constexpr glm::vec2 center() const { return {x + width * 0.5f, y + height * 0.5f}; }

    /** @brief Returns the top-left corner */
    constexpr glm::vec2 topLeft() const { return {x, y}; }

    /** @brief Returns the top-right corner */
    constexpr glm::vec2 topRight() const { return {x + width, y}; }

    /** @brief Returns the bottom-left corner */
    constexpr glm::vec2 bottomLeft() const { return {x, y + height}; }

    /** @brief Returns the bottom-right corner */
    constexpr glm::vec2 bottomRight() const { return {x + width, y + height}; }

    /** @brief Tests if a point is inside the rectangle */
    constexpr bool contains(const glm::vec2& point) const {
        return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
    }

    /** @brief Tests if a point (separate coords) is inside the rectangle */
    constexpr bool contains(f32 px, f32 py) const {
        return px >= x && px < x + width && py >= y && py < y + height;
    }

    /** @brief Tests if another rectangle is fully contained */
    constexpr bool contains(const Rect& other) const {
        return other.x >= x && other.right() <= right() && other.y >= y && other.bottom() <= bottom();
    }

    /** @brief Tests if this rectangle intersects with another */
    constexpr bool intersects(const Rect& other) const {
        return x < other.right() && right() > other.x && y < other.bottom() && bottom() > other.y;
    }

    /** @brief Returns the intersection of two rectangles (may be empty) */
    constexpr Rect intersect(const Rect& other) const {
        f32 l = (x > other.x) ? x : other.x;
        f32 t = (y > other.y) ? y : other.y;
        f32 r = (right() < other.right()) ? right() : other.right();
        f32 b = (bottom() < other.bottom()) ? bottom() : other.bottom();

        if (r <= l || b <= t) {
            return Rect();
        }
        return Rect(l, t, r - l, b - t);
    }

    /** @brief Returns true if the rectangle has zero or negative area */
    constexpr bool isEmpty() const { return width <= 0.0f || height <= 0.0f; }

    /** @brief Returns true if the rectangle is valid (positive size) */
    constexpr bool isValid() const { return width > 0.0f && height > 0.0f; }

    constexpr bool operator==(const Rect& other) const {
        return x == other.x && y == other.y && width == other.width && height == other.height;
    }

    constexpr bool operator!=(const Rect& other) const { return !(*this == other); }
};

// =============================================================================
// Insets
// =============================================================================

/**
 * @brief Edge insets for padding and margins
 *
 * @details Represents spacing on all four sides of a rectangle.
 *          Used for widget padding, margins, and borders.
 */
struct Insets {
    f32 top = 0.0f;
    f32 right = 0.0f;
    f32 bottom = 0.0f;
    f32 left = 0.0f;

    constexpr Insets() = default;
    constexpr Insets(f32 t, f32 r, f32 b, f32 l) : top(t), right(r), bottom(b), left(l) {}

    /** @brief Creates insets with the same value on all sides */
    static constexpr Insets all(f32 value) { return Insets(value, value, value, value); }

    /** @brief Creates insets with symmetric horizontal and vertical values */
    static constexpr Insets symmetric(f32 horizontal, f32 vertical) {
        return Insets(vertical, horizontal, vertical, horizontal);
    }

    /** @brief Creates insets with only horizontal values */
    static constexpr Insets horizontal(f32 value) { return Insets(0.0f, value, 0.0f, value); }

    /** @brief Creates insets with only vertical values */
    static constexpr Insets vertical(f32 value) { return Insets(value, 0.0f, value, 0.0f); }

    /** @brief Returns the total horizontal inset (left + right) */
    constexpr f32 totalHorizontal() const { return left + right; }

    /** @brief Returns the total vertical inset (top + bottom) */
    constexpr f32 totalVertical() const { return top + bottom; }

    /** @brief Returns the total size as a vector */
    constexpr glm::vec2 total() const { return {totalHorizontal(), totalVertical()}; }

    /** @brief Expands a rectangle by these insets */
    constexpr Rect expand(const Rect& rect) const {
        return Rect(rect.x - left, rect.y - top, rect.width + totalHorizontal(),
                    rect.height + totalVertical());
    }

    /** @brief Shrinks a rectangle by these insets */
    constexpr Rect shrink(const Rect& rect) const {
        return Rect(rect.x + left, rect.y + top, rect.width - totalHorizontal(),
                    rect.height - totalVertical());
    }

    constexpr Insets operator+(const Insets& other) const {
        return Insets(top + other.top, right + other.right, bottom + other.bottom,
                      left + other.left);
    }

    constexpr Insets operator*(f32 scale) const {
        return Insets(top * scale, right * scale, bottom * scale, left * scale);
    }

    constexpr bool operator==(const Insets& other) const {
        return top == other.top && right == other.right && bottom == other.bottom &&
               left == other.left;
    }

    constexpr bool operator!=(const Insets& other) const { return !(*this == other); }
};

// =============================================================================
// CornerRadii
// =============================================================================

/**
 * @brief Corner radii for rounded rectangles
 *
 * @details Specifies the radius for each corner of a rounded rectangle.
 *          Used by the UI renderer for SDF rounded rect drawing.
 */
struct CornerRadii {
    f32 topLeft = 0.0f;
    f32 topRight = 0.0f;
    f32 bottomRight = 0.0f;
    f32 bottomLeft = 0.0f;

    constexpr CornerRadii() = default;
    constexpr CornerRadii(f32 tl, f32 tr, f32 br, f32 bl)
        : topLeft(tl), topRight(tr), bottomRight(br), bottomLeft(bl) {}

    /** @brief Creates radii with the same value for all corners */
    static constexpr CornerRadii all(f32 radius) {
        return CornerRadii(radius, radius, radius, radius);
    }

    /** @brief Creates radii with top corners only */
    static constexpr CornerRadii top(f32 radius) { return CornerRadii(radius, radius, 0.0f, 0.0f); }

    /** @brief Creates radii with bottom corners only */
    static constexpr CornerRadii bottom(f32 radius) {
        return CornerRadii(0.0f, 0.0f, radius, radius);
    }

    /** @brief Creates radii with left corners only */
    static constexpr CornerRadii leftSide(f32 radius) {
        return CornerRadii(radius, 0.0f, 0.0f, radius);
    }

    /** @brief Creates radii with right corners only */
    static constexpr CornerRadii rightSide(f32 radius) {
        return CornerRadii(0.0f, radius, radius, 0.0f);
    }

    /** @brief Returns true if all corners have zero radius */
    constexpr bool isZero() const {
        return topLeft == 0.0f && topRight == 0.0f && bottomRight == 0.0f && bottomLeft == 0.0f;
    }

    /** @brief Returns true if all corners have the same radius */
    constexpr bool isUniform() const {
        return topLeft == topRight && topRight == bottomRight && bottomRight == bottomLeft;
    }

    /** @brief Returns the maximum corner radius */
    constexpr f32 maxRadius() const {
        f32 m1 = (topLeft > topRight) ? topLeft : topRight;
        f32 m2 = (bottomRight > bottomLeft) ? bottomRight : bottomLeft;
        return (m1 > m2) ? m1 : m2;
    }

    /** @brief Returns radii as vec4 (topLeft, topRight, bottomRight, bottomLeft) */
    constexpr glm::vec4 toVec4() const { return {topLeft, topRight, bottomRight, bottomLeft}; }

    constexpr bool operator==(const CornerRadii& other) const {
        return topLeft == other.topLeft && topRight == other.topRight &&
               bottomRight == other.bottomRight && bottomLeft == other.bottomLeft;
    }

    constexpr bool operator!=(const CornerRadii& other) const { return !(*this == other); }
};

// =============================================================================
// WidgetState
// =============================================================================

/**
 * @brief Interactive state flags for a widget
 *
 * @details Tracks the current interaction state of a widget for
 *          visual feedback and input handling.
 */
struct WidgetState {
    bool hovered = false;
    bool pressed = false;
    bool focused = false;
    bool disabled = false;
    bool visible = true;

    /** @brief Returns true if the widget can receive input */
    constexpr bool isInteractive() const { return !disabled && visible; }

    /** @brief Returns true if the widget should render as active (pressed or focused) */
    constexpr bool isActive() const { return (pressed || focused) && isInteractive(); }

    /** @brief Resets all interaction states (keeps disabled and visible) */
    void resetInteraction() {
        hovered = false;
        pressed = false;
    }
};

// =============================================================================
// WidgetId
// =============================================================================

/**
 * @brief Unique identifier for a widget in the UI hierarchy
 *
 * @details Uses a hierarchical string path and precomputed hash for
 *          efficient comparison and lookup.
 */
struct WidgetId {
    std::string path;
    u64 hash = 0;

    WidgetId() = default;

    explicit WidgetId(const std::string& p) : path(p), hash(computeHash(p)) {}

    /** @brief Creates a child ID by appending a name to a parent path */
    static WidgetId from(const std::string& parent, const std::string& name) {
        if (parent.empty()) {
            return WidgetId(name);
        }
        return WidgetId(parent + "." + name);
    }

    /** @brief Creates an indexed child ID (for list items) */
    static WidgetId indexed(const std::string& parent, const std::string& name, u32 index) {
        if (parent.empty()) {
            return WidgetId(name + "[" + std::to_string(index) + "]");
        }
        return WidgetId(parent + "." + name + "[" + std::to_string(index) + "]");
    }

    /** @brief Returns the last component of the path (the widget's own name) */
    std::string name() const {
        auto pos = path.rfind('.');
        if (pos == std::string::npos) {
            return path;
        }
        return path.substr(pos + 1);
    }

    /** @brief Returns the parent path (empty if root) */
    std::string parentPath() const {
        auto pos = path.rfind('.');
        if (pos == std::string::npos) {
            return "";
        }
        return path.substr(0, pos);
    }

    bool operator==(const WidgetId& other) const { return hash == other.hash && path == other.path; }

    bool operator!=(const WidgetId& other) const { return !(*this == other); }

    bool operator<(const WidgetId& other) const {
        if (hash != other.hash) {
            return hash < other.hash;
        }
        return path < other.path;
    }

private:
    static u64 computeHash(const std::string& str) {
        return std::hash<std::string>{}(str);
    }
};

// =============================================================================
// Mouse Button
// =============================================================================

/**
 * @brief Mouse button identifiers
 */
enum class MouseButton : u8 {
    Left = 0,
    Right = 1,
    Middle = 2,
    Button4 = 3,
    Button5 = 4,
    Count = 5
};

// =============================================================================
// Cursor Type
// =============================================================================

/**
 * @brief Standard cursor types for UI feedback
 */
enum class CursorType : u8 {
    Arrow,
    IBeam,
    Crosshair,
    Hand,
    ResizeH,
    ResizeV,
    ResizeNESW,
    ResizeNWSE,
    Move,
    NotAllowed
};

}  // namespace esengine::ui

// =============================================================================
// Hash Specialization
// =============================================================================

namespace std {

template<>
struct hash<esengine::ui::WidgetId> {
    size_t operator()(const esengine::ui::WidgetId& id) const noexcept {
        return static_cast<size_t>(id.hash);
    }
};

}  // namespace std
