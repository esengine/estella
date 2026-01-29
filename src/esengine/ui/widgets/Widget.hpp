/**
 * @file    Widget.hpp
 * @brief   Base widget class for the UI system
 * @details Provides the foundation for all UI widgets including hierarchy
 *          management, layout, state tracking, and event handling.
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
#include "../core/Theme.hpp"
#include "../core/Types.hpp"
#include "../events/UIEvent.hpp"
#include "../layout/SizeValue.hpp"

#include <functional>
#include <string>
#include <vector>

namespace esengine::ui {

class Layout;
class UIBatchRenderer;
class UIContext;

// =============================================================================
// Widget Class
// =============================================================================

/**
 * @brief Base class for all UI widgets
 *
 * @details Provides hierarchy management, layout integration, state tracking,
 *          event handling, and rendering for UI elements.
 *
 * @code
 * class MyButton : public Widget {
 * public:
 *     MyButton(const WidgetId& id, const std::string& text)
 *         : Widget(id), text_(text) {}
 *
 *     void render(UIBatchRenderer& renderer) override {
 *         auto style = getContext()->getTheme().getButtonStyle();
 *         renderer.drawRoundedRect(getBounds(), style.getBackgroundColor(getState()),
 *                                  style.cornerRadii);
 *         // Draw text...
 *     }
 *
 *     bool onMouseDown(const MouseButtonEvent& e) override {
 *         onClick();
 *         return true;
 *     }
 *
 *     std::function<void()> onClick;
 *
 * private:
 *     std::string text_;
 * };
 * @endcode
 */
class Widget {
public:
    explicit Widget(const WidgetId& id);
    virtual ~Widget();

    // Non-copyable
    Widget(const Widget&) = delete;
    Widget& operator=(const Widget&) = delete;

    // =========================================================================
    // Identity
    // =========================================================================

    /** @brief Gets the widget's unique identifier */
    const WidgetId& getId() const { return id_; }

    /** @brief Gets the widget's display name */
    const std::string& getName() const { return name_; }

    /** @brief Sets the widget's display name */
    void setName(const std::string& name) { name_ = name; }

    // =========================================================================
    // Hierarchy
    // =========================================================================

    /** @brief Gets the parent widget */
    Widget* getParent() const { return parent_; }

    /** @brief Gets the list of child widgets */
    const std::vector<Unique<Widget>>& getChildren() const { return children_; }

    /** @brief Gets the number of children */
    usize getChildCount() const { return children_.size(); }

    /** @brief Gets a child by index */
    Widget* getChild(usize index) const;

    /** @brief Finds a child by ID */
    Widget* findChild(const WidgetId& id) const;

    /**
     * @brief Adds a child widget
     * @param child Widget to add (ownership transferred)
     */
    void addChild(Unique<Widget> child);

    /**
     * @brief Removes a child widget
     * @param child Widget to remove
     * @return The removed widget (ownership returned)
     */
    Unique<Widget> removeChild(Widget* child);

    /**
     * @brief Removes all children
     */
    void clearChildren();

    // =========================================================================
    // Layout
    // =========================================================================

    /** @brief Sets the layout manager for children */
    void setLayout(Unique<Layout> layout);

    /** @brief Gets the current layout manager */
    Layout* getLayout() const { return layout_.get(); }

    /** @brief Sets the desired width */
    void setWidth(const SizeValue& width) { width_ = width; invalidateLayout(); }

    /** @brief Sets the desired height */
    void setHeight(const SizeValue& height) { height_ = height; invalidateLayout(); }

    /** @brief Sets both width and height */
    void setSize(const SizeValue& width, const SizeValue& height);

    /** @brief Gets the desired width */
    const SizeValue& getWidth() const { return width_; }

    /** @brief Gets the desired height */
    const SizeValue& getHeight() const { return height_; }

    /** @brief Sets the padding inside the widget */
    void setPadding(const Insets& padding) { padding_ = padding; invalidateLayout(); }

    /** @brief Gets the padding */
    const Insets& getPadding() const { return padding_; }

    /** @brief Sets the margin outside the widget */
    void setMargin(const Insets& margin) { margin_ = margin; invalidateLayout(); }

    /** @brief Gets the margin */
    const Insets& getMargin() const { return margin_; }

    /** @brief Sets the minimum size constraints */
    void setMinSize(f32 minWidth, f32 minHeight);

    /** @brief Sets the maximum size constraints */
    void setMaxSize(f32 maxWidth, f32 maxHeight);

    /** @brief Gets the size constraints */
    const SizeConstraints& getConstraints() const { return constraints_; }

    /**
     * @brief Measures the preferred size of this widget
     * @param availableWidth Available width for layout
     * @param availableHeight Available height for layout
     * @return Preferred size
     */
    virtual glm::vec2 measure(f32 availableWidth, f32 availableHeight);

    /**
     * @brief Lays out this widget and its children
     * @param bounds The assigned bounds for this widget
     */
    virtual void layout(const Rect& bounds);

    /** @brief Gets the current bounds */
    const Rect& getBounds() const { return bounds_; }

    /** @brief Gets the content bounds (bounds minus padding) */
    Rect getContentBounds() const;

    /** @brief Marks layout as needing recalculation */
    void invalidateLayout();

    /** @brief Marks measure cache as dirty (called when content changes) */
    void invalidateMeasure();

    /** @brief Returns true if layout needs recalculation */
    bool isLayoutDirty() const { return layoutDirty_; }

    /** @brief Returns true if measure cache is dirty */
    bool isMeasureDirty() const { return measureDirty_; }

    // =========================================================================
    // State
    // =========================================================================

    /** @brief Gets the current widget state */
    const WidgetState& getState() const { return state_; }

    /** @brief Returns true if the widget is visible */
    bool isVisible() const { return state_.visible; }

    /** @brief Sets visibility */
    void setVisible(bool visible);

    /** @brief Returns true if the widget is enabled */
    bool isEnabled() const { return !state_.disabled; }

    /** @brief Sets enabled state */
    void setEnabled(bool enabled);

    /** @brief Returns true if the widget is hovered */
    bool isHovered() const { return state_.hovered; }

    /** @brief Returns true if the widget is pressed */
    bool isPressed() const { return state_.pressed; }

    /** @brief Returns true if the widget is focused */
    bool isFocused() const { return state_.focused; }

    /** @brief Returns true if the widget can receive focus */
    virtual bool isFocusable() const { return false; }

    // =========================================================================
    // Rendering
    // =========================================================================

    /**
     * @brief Renders this widget
     * @param renderer The batch renderer to use
     */
    virtual void render(UIBatchRenderer& renderer);

    /**
     * @brief Renders this widget and all children
     * @param renderer The batch renderer to use
     */
    virtual void renderTree(UIBatchRenderer& renderer);

    // =========================================================================
    // Event Handling
    // =========================================================================

    /** @brief Called when mouse button is pressed */
    virtual bool onMouseDown(const MouseButtonEvent& event) { (void)event; return false; }

    /** @brief Called when mouse button is released */
    virtual bool onMouseUp(const MouseButtonEvent& event) { (void)event; return false; }

    /** @brief Called when mouse enters the widget */
    virtual bool onMouseEnter(const MouseEnterEvent& event) { (void)event; return false; }

    /** @brief Called when mouse leaves the widget */
    virtual bool onMouseLeave(const MouseLeaveEvent& event) { (void)event; return false; }

    /** @brief Called when mouse moves over the widget */
    virtual bool onMouseMove(const MouseMoveEvent& event) { (void)event; return false; }

    /** @brief Called when scroll occurs over the widget */
    virtual bool onScroll(const ScrollEvent& event) { (void)event; return false; }

    /** @brief Called when a key is pressed */
    virtual bool onKeyDown(const KeyEvent& event) { (void)event; return false; }

    /** @brief Called when a key is released */
    virtual bool onKeyUp(const KeyEvent& event) { (void)event; return false; }

    /** @brief Called when text is input */
    virtual bool onTextInput(const TextInputEvent& event) { (void)event; return false; }

    /** @brief Called when widget gains focus */
    virtual void onFocus(const FocusEvent& event) { (void)event; }

    /** @brief Called when widget loses focus */
    virtual void onBlur(const BlurEvent& event) { (void)event; }

    // =========================================================================
    // Hit Testing
    // =========================================================================

    /**
     * @brief Tests if a point hits this widget
     * @param x X coordinate
     * @param y Y coordinate
     * @return The deepest widget hit, or nullptr
     */
    virtual Widget* hitTest(f32 x, f32 y);

    /**
     * @brief Returns true if the point is within bounds
     */
    bool containsPoint(f32 x, f32 y) const;

    // =========================================================================
    // Context
    // =========================================================================

    /** @brief Gets the UI context */
    UIContext* getContext() const { return context_; }

    /** @brief Sets the UI context (called internally) */
    void setContext(UIContext* context);

protected:
    /**
     * @brief Called when state changes
     */
    virtual void onStateChanged() {}

    /**
     * @brief Updates the internal state
     */
    void setState(bool hovered, bool pressed);

    /**
     * @brief Sets focused state (called by UIContext)
     */
    void setFocused(bool focused);

    friend class UIContext;

private:
    WidgetId id_;
    std::string name_;

    Widget* parent_ = nullptr;
    std::vector<Unique<Widget>> children_;
    Unique<Layout> layout_;

    SizeValue width_ = SizeValue::autoSize();
    SizeValue height_ = SizeValue::autoSize();
    Insets padding_;
    Insets margin_;
    SizeConstraints constraints_;

    Rect bounds_;
    WidgetState state_;
    bool layoutDirty_ = true;
    bool measureDirty_ = true;

    f32 cachedMeasureWidth_ = 0.0f;
    f32 cachedMeasureHeight_ = 0.0f;
    f32 lastAvailableWidth_ = -1.0f;
    f32 lastAvailableHeight_ = -1.0f;

    UIContext* context_ = nullptr;
};

}  // namespace esengine::ui
